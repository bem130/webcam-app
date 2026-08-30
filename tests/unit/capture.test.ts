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

  it("measures frame validation, raster, and PNG encoding as separate durations", async () => {
    const encoder = new CanvasCaptureEncoder(
      fakeCanvas((callback) => callback(new Blob(["png"]))),
      fakeCanvas(),
    );
    let tick = 0;
    const result = await encoder.encodeVideoFramePng(fakeVideo(3000, 4000), () => ++tick);

    expect(result.durations).toEqual({
      videoFrameAcquire: 1,
      videoFrameTransfer: { tag: "none" },
      videoFrameRaster: 1,
      videoFramePngEncode: 1,
    });
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

  it("maps a high-resolution backing-store allocation failure and still attempts cleanup", async () => {
    const frameCanvas = allocationFailingCanvas();
    const encoder = new CanvasCaptureEncoder(frameCanvas, fakeCanvas());

    await expect(encoder.encodeVideoFramePng(fakeVideo(8160, 6120))).rejects.toThrow(
      "memoryAllocationFailed",
    );
    expect(frameCanvas.width).toBe(1);
    expect(frameCanvas.height).toBe(1);
  });

  it("does not retain previous full-resolution canvas dimensions across captures", async () => {
    const assignments: number[] = [];
    const frameCanvas = trackedCanvas(assignments);
    const encoder = new CanvasCaptureEncoder(frameCanvas, fakeCanvas());

    await encoder.encodeVideoFramePng(fakeVideo(7680, 4320));
    await encoder.encodeVideoFramePng(fakeVideo(3840, 2160));

    expect(assignments).toEqual([7680, 1, 3840, 1]);
    expect(frameCanvas.width).toBe(1);
    expect(frameCanvas.height).toBe(1);
  });

  it("does not let a cleanup failure mask the original encode failure", async () => {
    const frameCanvas = cleanupFailingCanvas((callback) => callback(null));
    const encoder = new CanvasCaptureEncoder(frameCanvas, fakeCanvas());

    await expect(encoder.encodeVideoFramePng(fakeVideo(7680, 4320))).rejects.toThrow(
      "pngEncodingFailed",
    );
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

function allocationFailingCanvas(): HTMLCanvasElement {
  let width = 0;
  let height = 0;
  return {
    get width() {
      return width;
    },
    set width(value: number) {
      if (value > 1) throw new DOMException("", "QuotaExceededError");
      width = value;
    },
    get height() {
      return height;
    },
    set height(value: number) {
      height = value;
    },
    getContext: () => ({ drawImage: () => undefined }),
    toBlob: (callback: BlobCallback) => callback(new Blob()),
  } as unknown as HTMLCanvasElement;
}

function trackedCanvas(widthAssignments: number[]): HTMLCanvasElement {
  let width = 0;
  let height = 0;
  return {
    get width() {
      return width;
    },
    set width(value: number) {
      widthAssignments.push(value);
      width = value;
    },
    get height() {
      return height;
    },
    set height(value: number) {
      height = value;
    },
    getContext: () => ({ drawImage: () => undefined }),
    toBlob: (callback: BlobCallback) => callback(new Blob()),
  } as unknown as HTMLCanvasElement;
}

function cleanupFailingCanvas(encode: (callback: BlobCallback) => void): HTMLCanvasElement {
  let width = 0;
  return {
    get width() {
      return width;
    },
    set width(value: number) {
      if (value === 1) throw new Error("cleanup failed");
      width = value;
    },
    height: 0,
    getContext: () => ({ drawImage: () => undefined }),
    toBlob: encode,
  } as unknown as HTMLCanvasElement;
}
