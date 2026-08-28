import { describe, expect, it } from "vitest";
import {
  calculateContainedDimensions,
  CanvasCaptureEncoder,
  sourceDimensions,
} from "../../src/platform/capture";

describe("capture dimensions", () => {
  it("preserves full-resolution landscape and portrait frames", () => {
    expect(sourceDimensions(7680, 4320)).toEqual({ width: 7680, height: 4320 });
    expect(sourceDimensions(4320, 7680)).toEqual({ width: 4320, height: 7680 });
  });

  it("limits only contained derivatives such as thumbnails", () => {
    expect(calculateContainedDimensions(3840, 2160, 320)).toEqual({ width: 320, height: 180 });
    expect(calculateContainedDimensions(2160, 3840, 320)).toEqual({ width: 180, height: 320 });
  });

  it("rejects non-positive source dimensions", () => {
    expect(sourceDimensions(0, 1080)).toEqual({ width: 0, height: 0 });
    expect(calculateContainedDimensions(0, 1080, 320)).toEqual({ width: 0, height: 0 });
  });

  it("releases a full-resolution canvas after successful encoding", async () => {
    const frameCanvas = fakeCanvas((callback) => callback(new Blob(["png"])));
    const encoder = new CanvasCaptureEncoder(frameCanvas, fakeCanvas());

    await expect(encoder.encodeVideoFramePng(fakeVideo(7680, 4320))).resolves.toMatchObject({
      width: 7680,
      height: 4320,
    });
    expect(frameCanvas.width).toBe(1);
    expect(frameCanvas.height).toBe(1);
  });

  it("releases a full-resolution canvas after failed encoding", async () => {
    const frameCanvas = fakeCanvas((callback) => callback(null));
    const encoder = new CanvasCaptureEncoder(frameCanvas, fakeCanvas());

    await expect(encoder.encodeVideoFramePng(fakeVideo(7680, 4320))).rejects.toThrow(
      "pngEncodingFailed",
    );
    expect(frameCanvas.width).toBe(1);
    expect(frameCanvas.height).toBe(1);
  });
});

function fakeVideo(width: number, height: number): HTMLVideoElement {
  return { videoWidth: width, videoHeight: height } as HTMLVideoElement;
}

function fakeCanvas(
  encode: (callback: BlobCallback) => void = (callback) => callback(new Blob()),
): HTMLCanvasElement {
  return {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage: () => undefined }),
    toBlob: encode,
  } as unknown as HTMLCanvasElement;
}
