import { afterEach, describe, expect, it, vi } from "vitest";
import {
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
  vi.unstubAllGlobals();
});

describe("Canvas image processing fallback", () => {
  it("decodes once and shares the bitmap between dimensions, PNG, and thumbnail raster", async () => {
    const close = vi.fn();
    const createImageBitmap = vi.fn(() =>
      Promise.resolve({ width: 4000, height: 3000, close } as unknown as ImageBitmap),
    );
    vi.stubGlobal("createImageBitmap", createImageBitmap);
    const canvases = [fakeCanvas(), fakeCanvas()];
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
  });
});

describe("Worker image processing adapter", () => {
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
  #messageHandler: ((message: ImageProcessingResponse) => void) | undefined;
  #errorHandler: (() => void) | undefined;

  postMessage(message: ImageProcessingRequest): void {
    this.messages.push(message);
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
  return { prepare, dispose: vi.fn() };
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
