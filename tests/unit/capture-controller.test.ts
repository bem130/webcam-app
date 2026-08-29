import { describe, expect, it } from "vitest";
import { observeCaptureOperation } from "../../src/application/capture-controller";
import type { ClipboardError } from "../../src/core/errors";
import { captureId } from "../../src/core/model";
import { err, ok, type Result } from "../../src/core/result";
import type { CapturedImage, CaptureOperation } from "../../src/platform/capture";

describe("capture controller", () => {
  it("publishes the capture artifact before thumbnail and Clipboard settlement", async () => {
    const captured = deferred<Result<CapturedImage, never>>();
    const cameraSource = deferred<void>();
    const thumbnail = deferred<Result<Blob, never>>();
    const clipboard = deferred<Result<void, ClipboardError>>();
    const events: string[] = [];
    const id = captureId("independent");

    observeCaptureOperation(
      id,
      {
        cameraSourceSettled: cameraSource.promise,
        captured: captured.promise,
        thumbnail: thumbnail.promise,
        clipboard: clipboard.promise,
      },
      (event) => events.push(event.type),
    );

    cameraSource.resolve(undefined);
    await flushMicrotasks();
    expect(events).toEqual(["cameraSourceSettled"]);

    captured.resolve(
      ok({
        blob: new Blob(["png"], { type: "image/png" }),
        mimeType: "image/png",
        width: 640,
        height: 480,
        route: "videoFrame",
      }),
    );
    await flushMicrotasks();
    expect(events).toEqual(["cameraSourceSettled", "captureSucceeded"]);

    thumbnail.resolve(ok(new Blob(["thumbnail"])));
    await flushMicrotasks();
    expect(events).toEqual(["cameraSourceSettled", "captureSucceeded", "thumbnailSucceeded"]);

    clipboard.resolve(err({ tag: "notAllowed" }));
    await flushMicrotasks();
    expect(events).toEqual([
      "cameraSourceSettled",
      "captureSucceeded",
      "thumbnailSucceeded",
      "clipboardFailed",
    ]);
  });

  it("does not let a Clipboard result overwrite a later capture failure", async () => {
    const captured = deferred<CaptureOperation["captured"] extends Promise<infer T> ? T : never>();
    const events: string[] = [];

    observeCaptureOperation(
      captureId("failed"),
      {
        cameraSourceSettled: new Promise(() => undefined),
        captured: captured.promise,
        thumbnail: new Promise(() => undefined),
        clipboard: Promise.resolve(ok(undefined)),
      },
      (event) => events.push(event.type),
    );

    await flushMicrotasks();
    expect(events).toEqual([]);
    captured.resolve(err({ tag: "pngEncodingFailed" }));
    await flushMicrotasks();
    expect(events).toEqual(["captureFailed"]);
  });
});

function deferred<T>(): Readonly<{
  promise: Promise<T>;
  resolve: (value: T) => void;
}> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
