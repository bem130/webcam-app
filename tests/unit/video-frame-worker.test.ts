import { describe, expect, it, vi } from "vitest";
import {
  encodeWorkerVideoFrame,
  VideoFrameWorkerFailure,
} from "../../src/platform/video-frame-worker";

describe("Worker video-frame encoder", () => {
  it("encodes an opaque transferred bitmap and releases source and canvas", async () => {
    const close = vi.fn();
    const bitmap = fakeBitmap(3000, 4000, close);
    const target = fakeOffscreenCanvas();
    let tick = 0;

    const result = await encodeWorkerVideoFrame(
      bitmap,
      () => target.canvas,
      () => ++tick,
    );

    expect(result).toMatchObject({
      blob: { type: "image/png" },
      width: 3000,
      height: 4000,
      rasterDurationMs: 1,
      pngEncodeDurationMs: 1,
    });
    expect(target.getContext).toHaveBeenCalledWith("2d", { alpha: false });
    expect(target.drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 3000, 4000);
    expect(close).toHaveBeenCalledOnce();
    expect(target.canvas.width).toBe(1);
    expect(target.canvas.height).toBe(1);
  });

  it("releases the bitmap and full canvas when PNG encoding fails", async () => {
    const close = vi.fn();
    const bitmap = fakeBitmap(3000, 4000, close);
    const target = fakeOffscreenCanvas(Promise.reject(new Error("encode failed")));

    await expect(encodeWorkerVideoFrame(bitmap, () => target.canvas)).rejects.toMatchObject({
      error: { tag: "pngEncodingFailed" },
    });
    expect(close).toHaveBeenCalledOnce();
    expect(target.canvas.width).toBe(1);
    expect(target.canvas.height).toBe(1);
  });

  it("maps allocation failures without retaining the transferred bitmap", async () => {
    const close = vi.fn();
    const bitmap = fakeBitmap(3000, 4000, close);
    const failure = new DOMException("", "QuotaExceededError");

    await expect(
      encodeWorkerVideoFrame(bitmap, () => {
        throw failure;
      }),
    ).rejects.toEqual(new VideoFrameWorkerFailure({ tag: "memoryAllocationFailed" }));
    expect(close).toHaveBeenCalledOnce();
  });
});

function fakeBitmap(width: number, height: number, close: () => void): ImageBitmap {
  return { width, height, close };
}

function fakeOffscreenCanvas(
  encoded: Promise<Blob> = Promise.resolve(new Blob(["png"], { type: "image/png" })),
) {
  const drawImage = vi.fn();
  const getContext = vi.fn(() => ({ drawImage }));
  const canvas = {
    width: 0,
    height: 0,
    getContext,
    convertToBlob: vi.fn(() => encoded),
  } as unknown as OffscreenCanvas;
  return { canvas, drawImage, getContext };
}
