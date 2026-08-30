import { afterEach, describe, expect, it, vi } from "vitest";
import {
  browserImageProcessingPort,
  CanvasImageProcessingPort,
  WorkerImageProcessingPort,
  type ImageProcessingPort,
  type ImageProcessingWorker,
  type PreparedImage,
} from "../../src/platform/image-processing";
import type {
  ImageProcessingRequest,
  ImageProcessingResponse,
} from "../../src/platform/image-processing-protocol";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Canvas image processing fallback", () => {
  it("decodes once and shares the bitmap between dimensions, PNG, and thumbnail raster", async () => {
    const close = vi.fn();
    const createImageBitmap = vi.fn(() =>
      Promise.resolve({ width: 4000, height: 3000, close } as unknown as ImageBitmap),
    );
    vi.stubGlobal("createImageBitmap", createImageBitmap);
    const thumbnailCanvas = fakeCanvas();
    const fullCanvas = fakeCanvas();
    const canvases = [thumbnailCanvas, fullCanvas];
    const port = new CanvasImageProcessingPort(() => canvases.shift()!.canvas);
    const image = new Blob(["jpeg"], { type: "image/jpeg" });

    const prepared = await port.prepare(image, true);
    expect(prepared.dimensions).toEqual({ width: 4000, height: 3000 });
    await expect(prepared.clipboardPng).resolves.toMatchObject({
      blob: { type: "image/png" },
    });
    await expect(prepared.encodeThumbnail()).resolves.toMatchObject({ type: "image/jpeg" });

    expect(createImageBitmap).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(canvases).toHaveLength(0);
    expect(thumbnailCanvas.canvas).toMatchObject({ width: 1, height: 1 });
    expect(fullCanvas.canvas).toMatchObject({ width: 1, height: 1 });
  });

  it("maps native-image allocation failure and releases every acquired resource", async () => {
    const close = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() =>
        Promise.resolve({ width: 8_160, height: 6_120, close } as unknown as ImageBitmap),
      ),
    );
    const thumbnailCanvas = fakeCanvas();
    const fullCanvas = allocationFailingCanvas();
    const canvases = [thumbnailCanvas.canvas, fullCanvas];
    const port = new CanvasImageProcessingPort(() => canvases.shift()!);

    await expect(port.prepare(new Blob(["jpeg"], { type: "image/jpeg" }), true)).rejects.toThrow(
      "memoryAllocationFailed",
    );
    expect(close).toHaveBeenCalledOnce();
    expect(thumbnailCanvas.canvas).toMatchObject({ width: 1, height: 1 });
    expect(fullCanvas).toMatchObject({ width: 1, height: 1 });
  });

  it("uses the Canvas video baseline when Worker initialization fails", async () => {
    vi.stubGlobal("OffscreenCanvas", class {});
    vi.stubGlobal("createImageBitmap", vi.fn());
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          throw new Error("worker blocked");
        }
      },
    );
    const port = browserImageProcessingPort();
    const fallbackResult = fakeEncodedVideoFrame();
    const fallback = vi.fn(() => Promise.resolve(fallbackResult));

    await expect(
      port.processVideoFrame({} as HTMLVideoElement, fallback, () => performance.now()),
    ).resolves.toBe(fallbackResult);
    expect(fallback).toHaveBeenCalledOnce();
    port.dispose();
  });

  it("keeps the measured main-thread encoder as the video-frame fallback", async () => {
    const port = new CanvasImageProcessingPort();
    const encoded = Promise.resolve(fakeEncodedVideoFrame());
    const fallback = vi.fn(() => encoded);

    await expect(
      port.processVideoFrame({} as HTMLVideoElement, fallback, () => performance.now()),
    ).resolves.toEqual(await encoded);
    expect(fallback).toHaveBeenCalledOnce();
  });
});

describe("Worker image processing adapter", () => {
  it("transfers a current video bitmap and reports acquisition, handoff, raster, and encode", async () => {
    const close = vi.fn();
    const bitmap = { width: 3000, height: 4000, close } as unknown as ImageBitmap;
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(bitmap)),
    );
    const worker = new FakeWorker();
    const fallback = vi.fn(() => Promise.resolve(fakeEncodedVideoFrame()));
    const port = new WorkerImageProcessingPort(worker, fakeFallback());
    let tick = 0;
    const result = port.processVideoFrame(
      { videoWidth: 3000, videoHeight: 4000 } as HTMLVideoElement,
      fallback,
      () => ++tick,
    );

    await vi.waitFor(() => expect(worker.videoFrameJobIds()).toHaveLength(1));
    const jobId = worker.videoFrameJobIds()[0]!;
    expect(worker.transfers).toEqual([[bitmap]]);
    worker.emit({ type: "videoFrameAccepted", jobId });
    const png = new Blob(["png"], { type: "image/png" });
    worker.emit({
      type: "videoFrameReady",
      jobId,
      blob: png,
      width: 3000,
      height: 4000,
      rasterDurationMs: 62,
      pngEncodeDurationMs: 558,
    });

    await expect(result).resolves.toEqual({
      blob: png,
      width: 3000,
      height: 4000,
      durations: {
        videoFrameAcquire: 1,
        videoFrameTransfer: { tag: "some", value: 1 },
        videoFrameRaster: 62,
        videoFramePngEncode: 558,
      },
    });
    expect(fallback).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    port.dispose();
  });

  it("isolates concurrent video jobs and ignores stale responses", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValueOnce(fakeBitmap(1, 1)).mockResolvedValueOnce(fakeBitmap(2, 2)),
    );
    const worker = new FakeWorker();
    const port = new WorkerImageProcessingPort(worker, fakeFallback());
    const fallback = () => Promise.resolve(fakeEncodedVideoFrame());
    const first = port.processVideoFrame({} as HTMLVideoElement, fallback, () => performance.now());
    const second = port.processVideoFrame({} as HTMLVideoElement, fallback, () =>
      performance.now(),
    );
    await vi.waitFor(() => expect(worker.videoFrameJobIds()).toHaveLength(2));
    const [firstId, secondId] = worker.videoFrameJobIds();
    if (firstId === undefined || secondId === undefined) throw new Error("expected video jobs");

    worker.emit({ type: "videoFrameAccepted", jobId: 999_999 });
    worker.emit({ type: "videoFrameAccepted", jobId: secondId });
    worker.emit(videoFrameReady(secondId, 2, 2));
    worker.emit({ type: "videoFrameAccepted", jobId: firstId });
    worker.emit(videoFrameReady(firstId, 1, 1));

    await expect(first).resolves.toMatchObject({ width: 1, height: 1 });
    await expect(second).resolves.toMatchObject({ width: 2, height: 2 });
    port.dispose();
  });

  it("falls back when the Worker fails after accepting a transferred frame", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap(3000, 4000))),
    );
    const worker = new FakeWorker();
    const fallbackResult = fakeEncodedVideoFrame();
    const fallback = vi.fn(() => Promise.resolve(fallbackResult));
    const port = new WorkerImageProcessingPort(worker, fakeFallback());
    const result = port.processVideoFrame({} as HTMLVideoElement, fallback, () =>
      performance.now(),
    );
    await vi.waitFor(() => expect(worker.videoFrameJobIds()).toHaveLength(1));
    worker.fail();

    await expect(result).resolves.toBe(fallbackResult);
    expect(fallback).toHaveBeenCalledOnce();
    port.dispose();
  });

  it("does not repeat a video-frame allocation failure on the main thread", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap(8_160, 6_120))),
    );
    const worker = new FakeWorker();
    const fallback = vi.fn(() => Promise.resolve(fakeEncodedVideoFrame()));
    const port = new WorkerImageProcessingPort(worker, fakeFallback());
    const result = port.processVideoFrame({} as HTMLVideoElement, fallback, () =>
      performance.now(),
    );
    await vi.waitFor(() => expect(worker.videoFrameJobIds()).toHaveLength(1));
    const jobId = worker.videoFrameJobIds()[0]!;
    worker.emit({ type: "videoFrameAccepted", jobId });
    worker.emit({ type: "videoFrameFailed", jobId, error: { tag: "memoryAllocationFailed" } });

    await expect(result).rejects.toThrow("memoryAllocationFailed");
    expect(fallback).not.toHaveBeenCalled();
    port.dispose();
  });

  it("keeps the Worker alive for native images while selecting the video Canvas baseline", async () => {
    const createBitmap = vi.fn(() => Promise.resolve(fakeBitmap(3000, 4000)));
    vi.stubGlobal("createImageBitmap", createBitmap);
    const worker = new FakeWorker();
    const fallbackResult = fakeEncodedVideoFrame();
    const fallback = vi.fn(() => Promise.resolve(fallbackResult));
    const port = new WorkerImageProcessingPort(worker, fakeFallback(), "mainThreadCanvas");

    await expect(
      port.processVideoFrame({} as HTMLVideoElement, fallback, () => performance.now()),
    ).resolves.toBe(fallbackResult);
    expect(fallback).toHaveBeenCalledOnce();
    expect(createBitmap).not.toHaveBeenCalled();
    expect(worker.videoFrameJobIds()).toEqual([]);
    port.dispose();
  });

  it("falls back and closes an untransferred bitmap when postMessage throws", async () => {
    const close = vi.fn();
    const bitmap = fakeBitmap(3000, 4000, close);
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(bitmap)),
    );
    const worker = new FakeWorker();
    worker.throwOnPost = true;
    const fallbackResult = fakeEncodedVideoFrame();
    const fallback = vi.fn(() => Promise.resolve(fallbackResult));
    const port = new WorkerImageProcessingPort(worker, fakeFallback());

    await expect(
      port.processVideoFrame({} as HTMLVideoElement, fallback, () => performance.now()),
    ).resolves.toBe(fallbackResult);
    expect(close).toHaveBeenCalledOnce();
    port.dispose();
  });

  it("times out a silent video-frame job and falls back", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap(3000, 4000))),
    );
    const worker = new FakeWorker();
    const fallback = vi.fn(() => Promise.resolve(fakeEncodedVideoFrame()));
    const port = new WorkerImageProcessingPort(worker, fakeFallback());
    const result = port.processVideoFrame({} as HTMLVideoElement, fallback, () =>
      performance.now(),
    );
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(60_000);

    await expect(result).resolves.toEqual(fakeEncodedVideoFrame());
    expect(fallback).toHaveBeenCalledOnce();
    port.dispose();
  });

  it("rejects an active video-frame job on dispose without starting fallback work", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap(3000, 4000))),
    );
    const worker = new FakeWorker();
    const fallback = vi.fn(() => Promise.resolve(fakeEncodedVideoFrame()));
    const port = new WorkerImageProcessingPort(worker, fakeFallback());
    const result = port.processVideoFrame({} as HTMLVideoElement, fallback, () =>
      performance.now(),
    );
    await vi.waitFor(() => expect(worker.videoFrameJobIds()).toHaveLength(1));
    port.dispose();

    await expect(result).rejects.toThrow("pngEncodingFailed");
    expect(fallback).not.toHaveBeenCalled();
  });

  it("uses typed job messages and keeps thumbnail encoding deferred", async () => {
    const worker = new FakeWorker();
    const fallback = fakeFallback();
    const port = new WorkerImageProcessingPort(worker, fallback);
    const image = new Blob(["jpeg"], { type: "image/jpeg" });
    const preparation = port.prepare(image, true);
    const jobId = worker.singleJobId();

    worker.emit({ type: "prepared", jobId, width: 4000, height: 3000 });
    const prepared = await preparation;
    expect(prepared.dimensions).toEqual({ width: 4000, height: 3000 });
    expect(worker.messages).not.toContainEqual({ type: "encodeThumbnail", jobId });

    const png = new Blob(["png"], { type: "image/png" });
    worker.emit({ type: "clipboardPngReady", jobId, blob: png, durationMs: 250 });
    await expect(prepared.clipboardPng).resolves.toEqual({ blob: png, durationMs: 250 });

    const thumbnailResult = prepared.encodeThumbnail();
    expect(worker.messages).toContainEqual({ type: "encodeThumbnail", jobId });
    const thumbnail = new Blob(["thumbnail"], { type: "image/jpeg" });
    worker.emit({ type: "thumbnailReady", jobId, blob: thumbnail });
    await expect(thumbnailResult).resolves.toBe(thumbnail);
    expect(fallback.prepare).not.toHaveBeenCalled();
    port.dispose();
  });

  it("isolates concurrent jobs and ignores stale responses", async () => {
    const worker = new FakeWorker();
    const port = new WorkerImageProcessingPort(worker, fakeFallback());
    const first = port.prepare(new Blob(["one"]), false);
    const second = port.prepare(new Blob(["two"]), false);
    const [firstId, secondId] = worker.jobIds();
    expect(firstId).not.toBe(secondId);

    worker.emit({ type: "prepared", jobId: secondId, width: 2, height: 2 });
    worker.emit({ type: "prepared", jobId: firstId, width: 1, height: 1 });
    await expect(first).resolves.toMatchObject({ dimensions: { width: 1, height: 1 } });
    await expect(second).resolves.toMatchObject({ dimensions: { width: 2, height: 2 } });
    worker.emit({ type: "prepared", jobId: 999_999, width: 9, height: 9 });
    (await first).dispose();
    (await second).dispose();
    port.dispose();
  });

  it("falls back when worker preparation fails", async () => {
    const worker = new FakeWorker();
    const fallback = fakeFallback({ dimensions: { width: 12, height: 8 } });
    const port = new WorkerImageProcessingPort(worker, fallback);
    const image = new Blob(["jpeg"], { type: "image/jpeg" });
    const preparation = port.prepare(image, true);
    worker.emit({
      type: "preparationFailed",
      jobId: worker.singleJobId(),
      error: { tag: "imageDecodeFailed" },
    });

    await expect(preparation).resolves.toMatchObject({ dimensions: { width: 12, height: 8 } });
    expect(fallback.prepare).toHaveBeenCalledWith(image, true);
    port.dispose();
  });

  it("does not repeat a native-image allocation failure in the Canvas fallback", async () => {
    const worker = new FakeWorker();
    const fallback = fakeFallback();
    const port = new WorkerImageProcessingPort(worker, fallback);
    const preparation = port.prepare(new Blob(["jpeg"], { type: "image/jpeg" }), true);
    worker.emit({
      type: "preparationFailed",
      jobId: worker.singleJobId(),
      error: { tag: "memoryAllocationFailed" },
    });

    await expect(preparation).rejects.toThrow("memoryAllocationFailed");
    expect(fallback.prepare).not.toHaveBeenCalled();
    port.dispose();
  });

  it("does not repeat an asynchronous Clipboard PNG allocation failure", async () => {
    const worker = new FakeWorker();
    const fallback = fakeFallback();
    const port = new WorkerImageProcessingPort(worker, fallback);
    const preparation = port.prepare(new Blob(["jpeg"], { type: "image/jpeg" }), true);
    const jobId = worker.singleJobId();
    worker.emit({ type: "prepared", jobId, width: 8_160, height: 6_120 });
    const prepared = await preparation;
    worker.emit({
      type: "clipboardPngFailed",
      jobId,
      error: { tag: "memoryAllocationFailed" },
    });

    await expect(prepared.clipboardPng).rejects.toThrow("memoryAllocationFailed");
    expect(fallback.prepare).not.toHaveBeenCalled();
    prepared.dispose();
    port.dispose();
  });

  it("falls back after an asynchronous worker failure without re-preparing twice", async () => {
    const worker = new FakeWorker();
    const fallback = fakeFallback();
    const port = new WorkerImageProcessingPort(worker, fallback);
    const image = new Blob(["jpeg"], { type: "image/jpeg" });
    const preparation = port.prepare(image, true);
    const jobId = worker.singleJobId();
    worker.emit({ type: "prepared", jobId, width: 10, height: 10 });
    const prepared = await preparation;
    worker.fail();

    await expect(prepared.clipboardPng).resolves.toMatchObject({
      blob: { type: "image/png" },
    });
    await expect(prepared.encodeThumbnail()).resolves.toMatchObject({ type: "image/jpeg" });
    expect(fallback.prepare).toHaveBeenCalledOnce();
    port.dispose();
  });
});

class FakeWorker implements ImageProcessingWorker {
  readonly messages: ImageProcessingRequest[] = [];
  readonly transfers: Transferable[][] = [];
  throwOnPost = false;
  #messageHandler: ((message: ImageProcessingResponse) => void) | undefined;
  #errorHandler: (() => void) | undefined;

  postMessage(message: ImageProcessingRequest, transfer: Transferable[] = []): void {
    if (this.throwOnPost) throw new DOMException("", "DataCloneError");
    this.messages.push(message);
    this.transfers.push(transfer);
  }

  terminate(): void {}

  setMessageHandler(handler: (message: ImageProcessingResponse) => void): void {
    this.#messageHandler = handler;
  }

  setErrorHandler(handler: () => void): void {
    this.#errorHandler = handler;
  }

  emit(message: ImageProcessingResponse): void {
    this.#messageHandler?.(message);
  }

  fail(): void {
    this.#errorHandler?.();
  }

  jobIds(): [number, number] {
    const ids = this.messages.flatMap((message) =>
      message.type === "prepare" ? [message.jobId] : [],
    );
    if (ids[0] === undefined || ids[1] === undefined) throw new Error("expected two jobs");
    return [ids[0], ids[1]];
  }

  singleJobId(): number {
    const request = this.messages.find((message) => message.type === "prepare");
    if (request === undefined) throw new Error("expected a preparation job");
    return request.jobId;
  }

  videoFrameJobIds(): number[] {
    return this.messages.flatMap((message) =>
      message.type === "prepareVideoFrame" ? [message.jobId] : [],
    );
  }
}

function fakeFallback(
  options: Readonly<{ dimensions?: PreparedImage["dimensions"] }> = {},
): ImageProcessingPort &
  Readonly<{ prepare: ReturnType<typeof vi.fn<ImageProcessingPort["prepare"]>> }> {
  const prepare = vi.fn(() =>
    Promise.resolve<PreparedImage>({
      dimensions: options.dimensions ?? { width: 10, height: 10 },
      clipboardPng: Promise.resolve({
        blob: new Blob(["png"], { type: "image/png" }),
        durationMs: 1,
      }),
      encodeThumbnail: () => Promise.resolve(new Blob(["thumbnail"], { type: "image/jpeg" })),
      dispose: vi.fn(),
    }),
  );
  return {
    prepare,
    processVideoFrame: vi.fn<ImageProcessingPort["processVideoFrame"]>((_video, fallback) =>
      fallback(),
    ),
    dispose: vi.fn(),
  };
}

function fakeEncodedVideoFrame() {
  return {
    blob: new Blob(["png"], { type: "image/png" }),
    width: 640,
    height: 480,
    durations: {
      videoFrameAcquire: 1,
      videoFrameTransfer: { tag: "none" } as const,
      videoFrameRaster: 2,
      videoFramePngEncode: 3,
    },
  };
}

function fakeBitmap(width: number, height: number, close: () => void = vi.fn()): ImageBitmap {
  return { width, height, close };
}

function videoFrameReady(
  jobId: number,
  width: number,
  height: number,
): Extract<ImageProcessingResponse, { type: "videoFrameReady" }> {
  return {
    type: "videoFrameReady",
    jobId,
    blob: new Blob(["png"], { type: "image/png" }),
    width,
    height,
    rasterDurationMs: 2,
    pngEncodeDurationMs: 3,
  };
}

function fakeCanvas(): Readonly<{ canvas: HTMLCanvasElement }> {
  const context = { drawImage: vi.fn() };
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn((_kind: string, options?: CanvasRenderingContext2DSettings) => {
      expect(options).toEqual({ alpha: false });
      return context;
    }),
    toBlob: vi.fn((callback: BlobCallback, type?: string) => {
      callback(new Blob([type ?? "image/png"], { type: type ?? "image/png" }));
    }),
  } as unknown as HTMLCanvasElement;
  return { canvas };
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
    getContext: vi.fn(() => ({ drawImage: vi.fn() })),
    toBlob: vi.fn(),
  } as unknown as HTMLCanvasElement;
}
