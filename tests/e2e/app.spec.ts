import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

declare global {
  interface Window {
    __clipboardWriteCount: number;
    __cameraRequestCount: number;
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
  await installClipboardMock(page);
  const requestsAfterLoad: string[] = [];
  await page.goto("./");
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) requestsAfterLoad.push(request.url());
  });

  await page.getByRole("button", { name: "カメラを開始" }).click();
  const shutter = page.getByRole("button", { name: "撮影してClipboardへコピー" });
  await expect(shutter).toBeVisible({ timeout: 10_000 });
  await shutter.click();
  await expect(
    page.getByRole("status").filter({ hasText: "Clipboardにコピーしました。" }),
  ).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__clipboardWriteCount)).toBe(1);
  const cameraAccessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(cameraAccessibility.violations).toEqual([]);

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

async function installPlatformSpies(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__cameraRequestCount = 0;
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
