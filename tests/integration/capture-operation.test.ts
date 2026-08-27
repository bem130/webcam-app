import { describe, expect, it, vi } from "vitest";
import { beginCaptureAndCopy, type CaptureEncoder } from "../../src/platform/capture";
import type { ClipboardPort } from "../../src/platform/clipboard";

const video = { videoWidth: 640, videoHeight: 480 } as HTMLVideoElement;

describe("capture operation", () => {
  it("keeps a successful encode separate from a failed Clipboard write", async () => {
    const png = new Blob(["png"], { type: "image/png" });
    const thumbnail = new Blob(["thumbnail"], { type: "image/jpeg" });
    const encoder: CaptureEncoder = {
      encodePng: vi.fn(() => Promise.resolve(png)),
      encodeThumbnail: vi.fn(() => Promise.resolve(thumbnail)),
    };
    const clipboard: ClipboardPort = {
      createItem: vi.fn(() => ({}) as ClipboardItem),
      write: vi.fn(() => Promise.reject(new DOMException("", "NotAllowedError"))),
    };

    const operation = beginCaptureAndCopy(video, encoder, clipboard);
    await expect(operation.encoded).resolves.toEqual({
      tag: "ok",
      value: { png, thumbnail, width: 640, height: 480 },
    });
    await expect(operation.clipboard).resolves.toEqual({
      tag: "err",
      error: { tag: "notAllowed" },
    });
  });

  it("returns a typed capture failure without creating a history-ready value", async () => {
    const encoder: CaptureEncoder = {
      encodePng: vi.fn(() => Promise.reject(new Error("encode failed"))),
      encodeThumbnail: vi.fn(() => Promise.resolve(new Blob())),
    };
    const clipboard: ClipboardPort = {
      createItem: vi.fn(() => ({}) as ClipboardItem),
      write: vi.fn(() => Promise.resolve()),
    };

    const operation = beginCaptureAndCopy(video, encoder, clipboard);
    await expect(operation.encoded).resolves.toEqual({
      tag: "err",
      error: { tag: "pngEncodingFailed" },
    });
    expect(encoder.encodeThumbnail).not.toHaveBeenCalled();
  });
});
