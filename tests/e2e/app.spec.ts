import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

declare global {
  interface Window {
    __clipboardWriteCount: number;
    __cameraRequestCount: number;
    __photoTakeCount: number;
    __cameraTrackStopCount: number;
    __objectUrlCreateCount: number;
    __objectUrlRevokeCount: number;
  }
}

test.beforeEach(async ({ page }) => {
  await installPlatformSpies(page);
});

test("does not request camera permission before the start action", async ({ page }) => {
  await page.goto("./");

  await expect(page.getByRole("heading", { name: "Camera Clipboard" })).toBeVisible();
  await expect(page.getByRole("button", { name: "カメラを開始" })).toBeVisible();
  await expect(
    page.getByText("画像はサーバーや端末の写真ライブラリへ保存しません。", { exact: false }),
  ).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__cameraRequestCount)).toBe(0);
});

test("initial screen has no automatically detectable WCAG A/AA violations", async ({ page }) => {
  await page.goto("./");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("serves the install manifest and icons from the GitHub Pages scope", async ({
  page,
  request,
}) => {
  await page.goto("./");
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(manifestHref).toBe("/webcam-app/manifest.webmanifest");

  const manifestResponse = await request.get(new URL(manifestHref!, page.url()).toString());
  expect(manifestResponse.ok()).toBe(true);
  const manifest = (await manifestResponse.json()) as {
    start_url: string;
    scope: string;
    display: string;
    icons: { src: string }[];
  };
  expect(manifest).toMatchObject({
    start_url: "/webcam-app/",
    scope: "/webcam-app/",
    display: "standalone",
  });

  for (const icon of manifest.icons) {
    const iconResponse = await request.get(new URL(icon.src, page.url()).toString());
    expect(iconResponse.ok()).toBe(true);
    expect(iconResponse.headers()["content-type"]).toBe("image/png");
  }
});

test("has no Chromium installability errors", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Installability diagnostics use Chromium CDP.");
  await page.goto("./");
  const session = await page.context().newCDPSession(page);
  const manifest = await session.send("Page.getAppManifest");
  const installability = await session.send("Page.getInstallabilityErrors");

  expect(manifest.url).toBe("http://127.0.0.1:4173/webcam-app/manifest.webmanifest");
  expect(manifest.errors).toEqual([]);
  expect(installability.installabilityErrors).toEqual([]);
});

test("fits the primary action in a 320 by 568 viewport at 200 percent-equivalent width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("./");
  const button = page.getByRole("button", { name: "カメラを開始" });
  const box = await button.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.x).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
  expect(box?.height).toBeGreaterThanOrEqual(44);
});

test("captures, copies, retains history in memory, and clears it on reload", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "The deterministic fake camera is configured for Chromium.",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await installClipboardMock(page);
  const requestsAfterLoad: string[] = [];
  await page.goto("./");
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) requestsAfterLoad.push(request.url());
  });

  await page.getByRole("button", { name: "カメラを開始" }).click();
  const shutter = page.getByRole("button", { name: "撮影してClipboardへコピー" });
  await expect(shutter).toBeVisible({ timeout: 10_000 });
  await expect(page.getByLabel(/プレビューの解像度 \d+ × \d+/)).toBeVisible();
  await shutter.click();
  await expect(
    page.getByRole("status").filter({ hasText: "Clipboardにコピーしました。" }),
  ).toBeVisible();
  const status = page.getByRole("status").filter({ hasText: "Clipboardにコピーしました。" });
  const [statusBox, shutterBox] = await Promise.all([status.boundingBox(), shutter.boundingBox()]);
  expect(statusBox).not.toBeNull();
  expect(shutterBox).not.toBeNull();
  if (statusBox === null || shutterBox === null) throw new Error("expected visible controls");
  expect(rectanglesOverlap(statusBox, shutterBox)).toBe(false);
  await expect.poll(() => page.evaluate(() => window.__clipboardWriteCount)).toBe(1);
  const cameraAccessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(cameraAccessibility.violations).toEqual([]);

  await expect(status).toBeHidden({ timeout: 4_000 });

  await page.getByRole("button", { name: "履歴を開く（1件）" }).click();
  await expect(page.getByRole("heading", { name: "撮影履歴" })).toBeVisible();
  const historyItem = page.getByRole("button", { name: /に撮影した画像/ });
  await expect(historyItem).toHaveCount(1);
  await historyItem.click();
  await expect(page.getByRole("img", { name: "撮影画像のプレビュー" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__objectUrlCreateCount)).toBe(2);
  await page.getByRole("button", { name: "削除", exact: true }).click();
  await expect(page.getByText("このタブで撮影した画像がここに表示されます。")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__objectUrlRevokeCount)).toBe(2);

  await page.getByRole("button", { name: "履歴を閉じる" }).click();
  await shutter.click();
  await expect(page.getByRole("button", { name: "履歴を開く（1件）" })).toBeVisible();
  await page.getByRole("button", { name: "履歴を開く（1件）" }).click();
  await page.getByRole("button", { name: "すべて消去" }).click();
  const confirm = page.getByRole("dialog", { name: "すべての履歴を消去しますか？" });
  await confirm.getByRole("button", { name: "すべて消去" }).click();
  await expect.poll(() => page.evaluate(() => window.__objectUrlRevokeCount)).toBe(3);

  expect(requestsAfterLoad).toEqual([]);
  await expect.poll(() => storageIsEmpty(page)).toBe(true);

  await page.reload();
  await expect(page.getByRole("button", { name: "カメラを開始" })).toBeVisible();
  await expect(page.getByRole("button", { name: /履歴を開く/ })).toHaveCount(0);
});

test("keeps the captured image in history when Clipboard write fails", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "The deterministic fake camera is configured for Chromium.",
  );
  await installClipboardMock(page, false);
  await page.goto("./");
  await page.getByRole("button", { name: "カメラを開始" }).click();
  const shutter = page.getByRole("button", { name: "撮影してClipboardへコピー" });
  await expect(shutter).toBeVisible({ timeout: 10_000 });
  await shutter.click();

  await expect(
    page.getByRole("status").filter({ hasText: "Clipboardへの書込みが許可されませんでした。" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "履歴を開く（1件）" })).toBeVisible();
});

test("prefers native still capture and allows an explicit video-frame choice", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "The native still adapter is deterministic in Chromium.");
  await installImageCaptureMock(page);
  await installClipboardMock(page);
  await page.goto("./");
  await page.getByRole("button", { name: "カメラを開始" }).click();

  const preference = page.getByRole("combobox", { name: "撮影方式" });
  await expect(preference).toHaveValue("photoPreferred");
  await expect(page.getByText("撮影 最大", { exact: true })).toBeVisible();
  const shutter = page.getByRole("button", { name: "撮影してClipboardへコピー" });
  await shutter.click();
  await expect.poll(() => page.evaluate(() => window.__photoTakeCount)).toBe(1);
  await page.getByRole("button", { name: "履歴を開く（1件）" }).click();
  await page.getByRole("button", { name: /に撮影した画像/ }).click();
  await expect(page.getByText("写真API", { exact: true })).toBeVisible();
  await expect(page.getByText("image/png", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("端末内の処理時間", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "履歴を閉じる" }).click();
  await preference.selectOption("videoFrame");
  await shutter.click();
  await expect(page.getByRole("button", { name: "履歴を開く（2件）" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__photoTakeCount)).toBe(1);
});

test("disables the photo option and uses video frame when unsupported", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "The deterministic fake camera is configured for Chromium.",
  );
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, "ImageCapture", {
      configurable: true,
      value: undefined,
    });
  });
  await installClipboardMock(page);
  await page.goto("./?videoFramePipeline=canvas");
  await page.getByRole("button", { name: "カメラを開始" }).click();

  const preference = page.getByRole("combobox", { name: "撮影方式" });
  await expect(preference).toHaveValue("videoFrame");
  await expect
    .poll(() =>
      preference
        .locator('option[value="photoPreferred"]')
        .evaluate((option: HTMLOptionElement) => option.disabled),
    )
    .toBe(true);
  await expect(page.getByText("このカメラでは写真APIを利用できません")).toBeVisible();
  await page.getByRole("button", { name: "撮影してClipboardへコピー" }).click();
  await page.getByRole("button", { name: "履歴を開く（1件）" }).click();
  await page.getByRole("button", { name: /に撮影した画像/ }).click();
  await expect(page.getByText("動画フレーム", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("main-thread Canvas", { exact: true })).toBeVisible();
  await page.getByText("端末内の処理時間", { exact: true }).click();
  await expect(page.getByText("動画フレーム取得", { exact: true })).toBeVisible();
  await expect(page.getByText("動画フレームWorker handoff", { exact: true })).toBeVisible();
  await expect(page.getByText("動画フレームraster準備", { exact: true })).toBeVisible();
  await expect(page.getByText("動画フレームPNG encode", { exact: true })).toBeVisible();
});

test("covers the idle camera with a resume-only screensaver", async ({ page, browserName }) => {
  test.skip(
    browserName !== "chromium",
    "The deterministic fake camera is configured for Chromium.",
  );
  await page.setViewportSize({ width: 320, height: 568 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install();
  await installClipboardMock(page);
  await installImageCaptureMock(page);
  await page.goto("./");
  await page.getByRole("button", { name: "カメラを開始" }).click();
  const shutter = page.getByRole("button", { name: "撮影してClipboardへコピー" });
  await expect(shutter).toBeVisible({ timeout: 10_000 });
  const shutterBox = await shutter.boundingBox();
  if (shutterBox === null) throw new Error("expected a visible shutter");
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now);
  await page.evaluate(() => {
    document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });

  await page.clock.runFor(9_999);
  await expect(page.getByRole("heading", { name: "カメラを停止しました" })).toHaveCount(0);
  await page.clock.runFor(1);
  await expect(page.getByRole("heading", { name: "カメラを停止しました" })).toBeVisible();
  const screensaver = page.getByRole("button", { name: "カメラを再開" });
  await expect(screensaver).toBeFocused();
  const screensaverBox = await screensaver.boundingBox();
  expect(screensaverBox).toEqual({ x: 0, y: 0, width: 320, height: 568 });
  expect(
    await screensaver.evaluate((element) => ({
      animationName: getComputedStyle(element).animationName,
      transitionProperty: getComputedStyle(element).transitionProperty,
    })),
  ).toEqual({ animationName: "none", transitionProperty: "none" });
  await expect.poll(() => page.evaluate(() => window.__cameraTrackStopCount)).toBe(1);
  expect(
    await page.locator("video").evaluate((video) => (video as HTMLVideoElement).srcObject === null),
  ).toBe(true);

  await page.mouse.move(1, 1);
  await expect(screensaver).toBeVisible();
  expect(await page.evaluate(() => window.__cameraRequestCount)).toBe(1);

  await page.mouse.click(shutterBox.x + shutterBox.width / 2, shutterBox.y + shutterBox.height / 2);
  await expect(shutter).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => page.evaluate(() => window.__cameraRequestCount)).toBe(2);
  await expect(shutter).toBeFocused();
  expect(await page.evaluate(() => window.__clipboardWriteCount)).toBe(0);
  expect(await page.evaluate(() => window.__photoTakeCount)).toBe(0);

  await page.clock.runFor(10_000);
  await expect(screensaver).toBeVisible();
  await screensaver.dispatchEvent("keydown", { key: "Enter", code: "Enter", bubbles: true });
  await expect.poll(() => page.evaluate(() => window.__cameraRequestCount)).toBe(3);
  await expect(shutter).toBeFocused();

  await page.clock.runFor(10_000);
  await expect(screensaver).toBeVisible();
  await screensaver.dispatchEvent("wheel", { deltaY: 1, bubbles: true });
  await expect.poll(() => page.evaluate(() => window.__cameraRequestCount)).toBe(4);
  await expect(shutter).toBeFocused();
});

test("shows a recoverable error when screensaver resume fails", async ({ page, browserName }) => {
  test.skip(
    browserName !== "chromium",
    "The deterministic fake camera is configured for Chromium.",
  );
  await page.clock.install();
  await page.goto("./");
  await page.getByRole("button", { name: "カメラを開始" }).click();
  await expect(page.getByRole("button", { name: "撮影してClipboardへコピー" })).toBeVisible({
    timeout: 10_000,
  });
  await page.evaluate(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: () => {
        window.__cameraRequestCount += 1;
        return Promise.reject(new DOMException("Denied", "NotAllowedError"));
      },
    });
  });

  await page.clock.runFor(10_000);
  await page.getByRole("button", { name: "カメラを再開" }).click();
  await expect(page.getByRole("heading", { name: "カメラを利用できません" })).toBeVisible();
  await expect(page.getByRole("button", { name: "カメラを再開" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__cameraRequestCount)).toBe(2);
});

test("keeps background suspension distinct and does not auto-resume on visibility", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "The deterministic fake camera is configured for Chromium.",
  );
  await page.goto("./");
  await page.getByRole("button", { name: "カメラを開始" }).click();
  await expect(page.getByRole("button", { name: "撮影してClipboardへコピー" })).toBeVisible({
    timeout: 10_000,
  });

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByRole("heading", { name: "カメラを停止しました" })).toBeVisible();
  await expect(
    page.getByText("アプリがバックグラウンドになったため、カメラを解放しました。"),
  ).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__cameraTrackStopCount)).toBe(1);

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(await page.evaluate(() => window.__cameraRequestCount)).toBe(1);

  await page.getByRole("button", { name: "カメラを再開" }).click();
  await expect.poll(() => page.evaluate(() => window.__cameraRequestCount)).toBe(2);
});

function rectanglesOverlap(
  left: Readonly<{ x: number; y: number; width: number; height: number }>,
  right: Readonly<{ x: number; y: number; width: number; height: number }>,
): boolean {
  return !(
    left.x + left.width <= right.x ||
    right.x + right.width <= left.x ||
    left.y + left.height <= right.y ||
    right.y + right.height <= left.y
  );
}

async function installPlatformSpies(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__cameraRequestCount = 0;
    window.__cameraTrackStopCount = 0;
    window.__objectUrlCreateCount = 0;
    window.__objectUrlRevokeCount = 0;
    const createObjectUrl = URL.createObjectURL.bind(URL);
    const revokeObjectUrl = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (object: Blob | MediaSource) => {
      window.__objectUrlCreateCount += 1;
      return createObjectUrl(object);
    };
    URL.revokeObjectURL = (url: string) => {
      window.__objectUrlRevokeCount += 1;
      revokeObjectUrl(url);
    };
    const mediaDevices = navigator.mediaDevices;
    // Preserve the native implementation before installing the counting spy.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalStop = MediaStreamTrack.prototype.stop;
    MediaStreamTrack.prototype.stop = function () {
      window.__cameraTrackStopCount += 1;
      return originalStop.call(this);
    };
    if (mediaDevices?.getUserMedia !== undefined) {
      const original = mediaDevices.getUserMedia.bind(mediaDevices);
      Object.defineProperty(mediaDevices, "getUserMedia", {
        configurable: true,
        value: (constraints: MediaStreamConstraints) => {
          window.__cameraRequestCount += 1;
          return original(constraints);
        },
      });
    }
  });
}

async function installClipboardMock(page: Page, writeSucceeds = true): Promise<void> {
  await page.addInitScript((succeeds) => {
    class FakeClipboardItem {
      static supports(type: string): boolean {
        return type === "image/png";
      }

      readonly types: string[];
      readonly presentationStyle = "unspecified";

      constructor(items: Record<string, Blob | Promise<Blob>>) {
        this.types = Object.keys(items);
      }
    }

    window.__clipboardWriteCount = 0;
    Object.defineProperty(globalThis, "ClipboardItem", {
      configurable: true,
      value: FakeClipboardItem,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: (items: FakeClipboardItem[]) => {
          if (items.some((item) => !item.types.includes("image/png"))) {
            return Promise.reject(new DOMException("Unsupported type", "NotSupportedError"));
          }
          if (!succeeds) {
            return Promise.reject(new DOMException("Denied", "NotAllowedError"));
          }
          window.__clipboardWriteCount += 1;
          return Promise.resolve();
        },
      },
    });
  }, writeSucceeds);
}

async function installImageCaptureMock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__photoTakeCount = 0;
    class FakeImageCapture {
      getPhotoCapabilities() {
        return Promise.resolve({
          imageWidth: { min: 1, max: 4, step: 1 },
          imageHeight: { min: 1, max: 3, step: 1 },
        });
      }

      takePhoto() {
        window.__photoTakeCount += 1;
        const canvas = document.createElement("canvas");
        canvas.width = 4;
        canvas.height = 3;
        const context = canvas.getContext("2d");
        if (context === null) return Promise.reject(new Error("canvas unavailable"));
        context.fillStyle = "#4a90e2";
        context.fillRect(0, 0, canvas.width, canvas.height);
        return new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((blob) => {
            if (blob === null) reject(new Error("photo encode failed"));
            else resolve(blob);
          }, "image/png");
        });
      }
    }
    Object.defineProperty(globalThis, "ImageCapture", {
      configurable: true,
      value: FakeImageCapture,
    });
  });
}

async function storageIsEmpty(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const indexedDatabaseNames =
      indexedDB.databases === undefined
        ? []
        : (await indexedDB.databases()).map((database) => database.name);
    const cacheKeys = "caches" in globalThis ? await caches.keys() : [];
    return (
      localStorage.length === 0 &&
      sessionStorage.length === 0 &&
      indexedDatabaseNames.length === 0 &&
      cacheKeys.length === 0
    );
  });
}
