import type { CaptureError } from "../core/errors";
import { causeName } from "../core/errors";
import { some } from "../core/result";
import type { Dimensions, EncodedVideoFrame } from "./capture";
import { releaseCanvasBackingStore } from "./canvas-memory";
import type { ImageProcessingRequest, ImageProcessingResponse } from "./image-processing-protocol";

export type PreparedImage = Readonly<{
  dimensions: Dimensions;
  clipboardPng: Promise<EncodedClipboardPng>;
  encodeThumbnail: () => Promise<Blob>;
  dispose: () => void;
}>;

export type EncodedClipboardPng = Readonly<{ blob: Blob; durationMs: number }>;

export type ImageProcessingPort = Readonly<{
  prepare: (image: Blob, needsClipboardPng: boolean) => Promise<PreparedImage>;
  processVideoFrame: (
    video: HTMLVideoElement,
    fallback: () => Promise<EncodedVideoFrame>,
    clock: () => number,
  ) => Promise<EncodedVideoFrame>;
  dispose: () => void;
}>;

export type VideoFramePipeline = "workerOffscreen2d" | "mainThreadCanvas";

export type ImageProcessingWorker = Readonly<{
  postMessage: (message: ImageProcessingRequest, transfer?: Transferable[]) => void;
  terminate: () => void;
  setMessageHandler: (handler: (message: ImageProcessingResponse) => void) => void;
  setErrorHandler: (handler: () => void) => void;
}>;

type CanvasFactory = () => HTMLCanvasElement;
type Deferred<T> = Readonly<{
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (cause: unknown) => void;
}>;

type WorkerJob = Readonly<{
  jobId: number;
  image: Blob;
  needsClipboardPng: boolean;
  prepared: Deferred<PreparedImage>;
  clipboardPng: Deferred<EncodedClipboardPng>;
  thumbnail: Deferred<Blob>;
}> & {
  cleanupTimer: ReturnType<typeof setTimeout>;
};

type VideoFrameWorkerJob = Readonly<{
  jobId: number;
  acquiredDurationMs: number;
  transferStartedAt: number;
  clock: () => number;
  result: Deferred<EncodedVideoFrame>;
}> & {
  transferDurationMs: number | undefined;
  cleanupTimer: ReturnType<typeof setTimeout>;
};

const PNG_MIME = "image/png";
const THUMBNAIL_EDGE_PX = 320;
const WORKER_JOB_TIMEOUT_MS = 60_000;

export class ImageProcessingFailure extends Error {
  constructor(readonly error: CaptureError) {
    super(error.tag);
    this.name = "ImageProcessingFailure";
  }
}

export class CanvasImageProcessingPort implements ImageProcessingPort {
  readonly #createCanvas: CanvasFactory;

  constructor(createCanvas: CanvasFactory = () => document.createElement("canvas")) {
    this.#createCanvas = createCanvas;
  }

  async prepare(image: Blob, needsClipboardPng: boolean): Promise<PreparedImage> {
    let bitmap: ImageBitmap | undefined;
    let fullCanvas: HTMLCanvasElement | undefined;
    let thumbnailCanvas: HTMLCanvasElement | undefined;
    try {
      bitmap = await createImageBitmap(image);
      const dimensions = checkedDimensions(bitmap.width, bitmap.height);
      const thumbnailDimensions = containedDimensions(
        dimensions.width,
        dimensions.height,
        THUMBNAIL_EDGE_PX,
      );
      thumbnailCanvas = this.#createCanvas();
      thumbnailCanvas.width = thumbnailDimensions.width;
      thumbnailCanvas.height = thumbnailDimensions.height;
      const thumbnailContext = thumbnailCanvas.getContext("2d", { alpha: false });
      if (thumbnailContext === null) throw failure({ tag: "canvasUnavailable" });
      thumbnailContext.drawImage(
        bitmap,
        0,
        0,
        thumbnailDimensions.width,
        thumbnailDimensions.height,
      );

      let clipboardPng = Promise.resolve({ blob: image, durationMs: 0 });
      if (needsClipboardPng) {
        fullCanvas = this.#createCanvas();
        fullCanvas.width = dimensions.width;
        fullCanvas.height = dimensions.height;
        const fullContext = fullCanvas.getContext("2d", { alpha: false });
        if (fullContext === null) throw failure({ tag: "canvasUnavailable" });
        fullContext.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);
        const pngCanvas = fullCanvas;
        const startedAt = performance.now();
        clipboardPng = canvasToBlob(pngCanvas, PNG_MIME, {
          tag: "pngEncodingFailed",
        })
          .then((blob) => ({
            blob,
            durationMs: Math.max(0, performance.now() - startedAt),
          }))
          .finally(() => releaseCanvasBackingStore(pngCanvas));
      }

      bitmap.close();
      bitmap = undefined;
      let thumbnailPromise: Promise<Blob> | undefined;
      let disposed = false;
      const retainedThumbnailCanvas = thumbnailCanvas;
      return {
        dimensions,
        clipboardPng,
        encodeThumbnail: () => {
          if (disposed) return Promise.reject(failure({ tag: "thumbnailEncodingFailed" }));
          thumbnailPromise ??= canvasToBlob(
            retainedThumbnailCanvas,
            "image/jpeg",
            { tag: "thumbnailEncodingFailed" },
            0.82,
          ).finally(() => releaseCanvasBackingStore(retainedThumbnailCanvas));
          return thumbnailPromise;
        },
        dispose: () => {
          if (disposed) return;
          disposed = true;
          releaseCanvasBackingStore(fullCanvas);
          releaseCanvasBackingStore(retainedThumbnailCanvas);
        },
      };
    } catch (cause) {
      bitmap?.close();
      releaseCanvasBackingStore(fullCanvas);
      releaseCanvasBackingStore(thumbnailCanvas);
      throw imageProcessingFailure(cause, { tag: "imageDecodeFailed" });
    }
  }

  processVideoFrame(
    _video: HTMLVideoElement,
    fallback: () => Promise<EncodedVideoFrame>,
    clock: () => number,
  ): Promise<EncodedVideoFrame> {
    void clock;
    return fallback();
  }

  dispose(): void {}
}

export class WorkerImageProcessingPort implements ImageProcessingPort {
  readonly #worker: ImageProcessingWorker;
  readonly #fallback: ImageProcessingPort;
  readonly #jobs = new Map<number, WorkerJob>();
  readonly #videoFrameJobs = new Map<number, VideoFrameWorkerJob>();
  #nextJobId = 1;
  #workerFailed = false;
  #disposed = false;
  readonly #videoFramePipeline: VideoFramePipeline;

  constructor(
    worker: ImageProcessingWorker,
    fallback: ImageProcessingPort,
    videoFramePipeline: VideoFramePipeline = "workerOffscreen2d",
  ) {
    this.#worker = worker;
    this.#fallback = fallback;
    this.#videoFramePipeline = videoFramePipeline;
    worker.setMessageHandler((message) => this.#handleMessage(message));
    worker.setErrorHandler(() => this.#handleWorkerFailure());
  }

  async prepare(image: Blob, needsClipboardPng: boolean): Promise<PreparedImage> {
    if (this.#workerFailed) return this.#fallback.prepare(image, needsClipboardPng);
    try {
      return await this.#prepareWithWorker(image, needsClipboardPng);
    } catch (cause) {
      if (this.#disposed) throw cause;
      return this.#fallback.prepare(image, needsClipboardPng);
    }
  }

  async processVideoFrame(
    video: HTMLVideoElement,
    fallback: () => Promise<EncodedVideoFrame>,
    clock: () => number,
  ): Promise<EncodedVideoFrame> {
    if (this.#workerFailed || this.#videoFramePipeline === "mainThreadCanvas") return fallback();
    let bitmap: ImageBitmap | undefined;
    try {
      const acquiredStartedAt = clock();
      bitmap = await createImageBitmap(video);
      const acquiredDurationMs = elapsed(clock, acquiredStartedAt);
      if (bitmap.width <= 0 || bitmap.height <= 0) {
        throw failure({ tag: "frameNotReady" });
      }
      const result = this.#processVideoFrameWithWorker(bitmap, acquiredDurationMs, clock);
      bitmap = undefined;
      return await result;
    } catch (cause) {
      bitmap?.close();
      if (this.#disposed) throw cause;
      return fallback();
    }
  }

  dispose(): void {
    this.#disposed = true;
    this.#workerFailed = true;
    this.#worker.terminate();
    for (const job of [...this.#jobs.values()]) {
      this.#rejectJob(job, failure({ tag: "imageDecodeFailed" }));
      this.#deleteJob(job);
    }
    for (const job of [...this.#videoFrameJobs.values()]) {
      job.result.reject(failure({ tag: "pngEncodingFailed" }));
      this.#deleteVideoFrameJob(job);
    }
    this.#fallback.dispose();
  }

  #prepareWithWorker(image: Blob, needsClipboardPng: boolean): Promise<PreparedImage> {
    const jobId = this.#nextJobId++;
    const job: WorkerJob = {
      jobId,
      image,
      needsClipboardPng,
      prepared: deferred<PreparedImage>(),
      clipboardPng: deferred<EncodedClipboardPng>(),
      thumbnail: deferred<Blob>(),
      cleanupTimer: setTimeout(() => this.#timeoutJob(jobId), WORKER_JOB_TIMEOUT_MS),
    };
    this.#jobs.set(jobId, job);
    try {
      this.#worker.postMessage({ type: "prepare", jobId, image, needsClipboardPng });
    } catch (cause) {
      this.#rejectAndDelete(job, cause);
    }
    return job.prepared.promise;
  }

  #processVideoFrameWithWorker(
    bitmap: ImageBitmap,
    acquiredDurationMs: number,
    clock: () => number,
  ): Promise<EncodedVideoFrame> {
    const jobId = this.#nextJobId++;
    const job: VideoFrameWorkerJob = {
      jobId,
      acquiredDurationMs,
      transferStartedAt: clock(),
      transferDurationMs: undefined,
      clock,
      result: deferred<EncodedVideoFrame>(),
      cleanupTimer: setTimeout(() => this.#timeoutVideoFrameJob(jobId), WORKER_JOB_TIMEOUT_MS),
    };
    this.#videoFrameJobs.set(jobId, job);
    try {
      this.#worker.postMessage({ type: "prepareVideoFrame", jobId, bitmap }, [bitmap]);
    } catch (cause) {
      bitmap.close();
      job.result.reject(cause);
      this.#deleteVideoFrameJob(job);
    }
    return job.result.promise;
  }

  #handleMessage(message: ImageProcessingResponse): void {
    if (
      message.type === "videoFrameAccepted" ||
      message.type === "videoFrameReady" ||
      message.type === "videoFrameFailed"
    ) {
      this.#handleVideoFrameMessage(message);
      return;
    }
    const job = this.#jobs.get(message.jobId);
    if (job === undefined) return;
    switch (message.type) {
      case "prepared": {
        let dimensions: Dimensions;
        try {
          dimensions = checkedDimensions(message.width, message.height);
        } catch (cause) {
          this.#rejectAndDelete(job, cause);
          return;
        }
        const fallback = lazy(() => this.#fallback.prepare(job.image, job.needsClipboardPng));
        let thumbnailStarted = false;
        let disposed = false;
        const workerClipboardPng = job.needsClipboardPng
          ? job.clipboardPng.promise
          : Promise.resolve({ blob: job.image, durationMs: 0 });
        job.prepared.resolve({
          dimensions,
          clipboardPng: workerClipboardPng.catch(async (cause: unknown) => {
            if (this.#disposed) throw cause;
            const recovered = await fallback.get();
            return recovered.clipboardPng;
          }),
          encodeThumbnail: () => {
            if (disposed) return Promise.reject(failure({ tag: "thumbnailEncodingFailed" }));
            if (!thumbnailStarted) {
              thumbnailStarted = true;
              try {
                this.#worker.postMessage({ type: "encodeThumbnail", jobId: job.jobId });
              } catch (cause) {
                job.thumbnail.reject(cause);
              }
            }
            return job.thumbnail.promise
              .catch(async (cause: unknown) => {
                if (this.#disposed) throw cause;
                const recovered = await fallback.get();
                return recovered.encodeThumbnail();
              })
              .finally(() => {
                this.#deleteJob(job);
                fallback.dispose();
              });
          },
          dispose: () => {
            if (disposed) return;
            disposed = true;
            try {
              this.#worker.postMessage({ type: "discard", jobId: job.jobId });
            } catch {
              // The worker may already have failed; local cleanup still applies.
            }
            this.#deleteJob(job);
            fallback.dispose();
          },
        });
        break;
      }
      case "preparationFailed":
        this.#rejectAndDelete(job, failure(message.error));
        break;
      case "clipboardPngReady":
        job.clipboardPng.resolve({ blob: message.blob, durationMs: message.durationMs });
        break;
      case "clipboardPngFailed":
        job.clipboardPng.reject(failure(message.error));
        break;
      case "thumbnailReady":
        job.thumbnail.resolve(message.blob);
        break;
      case "thumbnailFailed":
        job.thumbnail.reject(failure(message.error));
        break;
    }
  }

  #handleVideoFrameMessage(
    message: Extract<
      ImageProcessingResponse,
      { type: "videoFrameAccepted" | "videoFrameReady" | "videoFrameFailed" }
    >,
  ): void {
    const job = this.#videoFrameJobs.get(message.jobId);
    if (job === undefined) return;
    switch (message.type) {
      case "videoFrameAccepted":
        job.transferDurationMs = elapsed(job.clock, job.transferStartedAt);
        break;
      case "videoFrameReady": {
        const transferDurationMs = job.transferDurationMs;
        if (transferDurationMs === undefined) {
          job.result.reject(failure({ tag: "pngEncodingFailed" }));
        } else {
          try {
            const dimensions = checkedDimensions(message.width, message.height);
            job.result.resolve({
              blob: message.blob,
              ...dimensions,
              durations: {
                videoFrameAcquire: checkedDuration(job.acquiredDurationMs),
                videoFrameTransfer: some(checkedDuration(transferDurationMs)),
                videoFrameRaster: checkedDuration(message.rasterDurationMs),
                videoFramePngEncode: checkedDuration(message.pngEncodeDurationMs),
              },
            });
          } catch (cause) {
            job.result.reject(cause);
          }
        }
        this.#deleteVideoFrameJob(job);
        break;
      }
      case "videoFrameFailed":
        job.result.reject(failure(message.error));
        this.#deleteVideoFrameJob(job);
        break;
    }
  }

  #handleWorkerFailure(): void {
    this.#workerFailed = true;
    for (const job of [...this.#jobs.values()]) {
      this.#rejectJob(job, failure({ tag: "imageDecodeFailed" }));
      this.#deleteJob(job);
    }
    for (const job of [...this.#videoFrameJobs.values()]) {
      job.result.reject(failure({ tag: "pngEncodingFailed" }));
      this.#deleteVideoFrameJob(job);
    }
  }

  #timeoutJob(jobId: number): void {
    const job = this.#jobs.get(jobId);
    if (job === undefined) return;
    try {
      this.#worker.postMessage({ type: "discard", jobId });
    } catch {
      // Timeout cleanup must not depend on a responsive worker.
    }
    this.#rejectAndDelete(job, failure({ tag: "thumbnailEncodingFailed" }));
  }

  #timeoutVideoFrameJob(jobId: number): void {
    const job = this.#videoFrameJobs.get(jobId);
    if (job === undefined) return;
    job.result.reject(failure({ tag: "pngEncodingFailed" }));
    this.#deleteVideoFrameJob(job);
  }

  #rejectAndDelete(job: WorkerJob, cause: unknown): void {
    this.#rejectJob(job, cause);
    this.#deleteJob(job);
  }

  #rejectJob(job: WorkerJob, cause: unknown): void {
    job.prepared.reject(cause);
    job.clipboardPng.reject(cause);
    job.thumbnail.reject(cause);
  }

  #deleteJob(job: WorkerJob): void {
    clearTimeout(job.cleanupTimer);
    this.#jobs.delete(job.jobId);
  }

  #deleteVideoFrameJob(job: VideoFrameWorkerJob): void {
    clearTimeout(job.cleanupTimer);
    this.#videoFrameJobs.delete(job.jobId);
  }
}

export function browserImageProcessingPort(
  videoFramePipeline: VideoFramePipeline = "workerOffscreen2d",
): ImageProcessingPort {
  const fallback = new CanvasImageProcessingPort();
  if (
    typeof Worker === "undefined" ||
    typeof OffscreenCanvas === "undefined" ||
    typeof createImageBitmap === "undefined"
  ) {
    return fallback;
  }
  try {
    const worker = new Worker(new URL("./image-processing.worker.ts", import.meta.url), {
      type: "module",
    });
    const adapter: ImageProcessingWorker = {
      postMessage: (message, transfer = []) => worker.postMessage(message, transfer),
      terminate: () => worker.terminate(),
      setMessageHandler: (handler) => {
        worker.onmessage = (event: MessageEvent<ImageProcessingResponse>) => handler(event.data);
      },
      setErrorHandler: (handler) => {
        worker.onerror = () => handler();
      },
    };
    return new WorkerImageProcessingPort(adapter, fallback, videoFramePipeline);
  } catch {
    return fallback;
  }
}

export function isImageProcessingFailure(cause: unknown): cause is ImageProcessingFailure {
  return cause instanceof ImageProcessingFailure;
}

function checkedDimensions(width: number, height: number): Dimensions {
  if (width <= 0 || height <= 0) throw failure({ tag: "invalidImage" });
  return { width, height };
}

function checkedDuration(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw failure({ tag: "pngEncodingFailed" });
  return value;
}

function containedDimensions(width: number, height: number, maxLongEdge: number): Dimensions {
  const scale = Math.min(1, maxLongEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  captureError: CaptureError,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => {
          if (blob === null) reject(failure(captureError));
          else resolve(blob);
        },
        type,
        quality,
      );
    } catch (cause) {
      reject(imageProcessingFailure(cause, captureError));
    }
  });
}

function failure(error: CaptureError): ImageProcessingFailure {
  return new ImageProcessingFailure(error);
}

function imageProcessingFailure(cause: unknown, fallback: CaptureError): ImageProcessingFailure {
  if (isImageProcessingFailure(cause)) return cause;
  return failure(
    causeName(cause) === "QuotaExceededError" ? { tag: "memoryAllocationFailed" } : fallback,
  );
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}

function elapsed(clock: () => number, startedAt: number): number {
  return Math.max(0, clock() - startedAt);
}

function lazy(factory: () => Promise<PreparedImage>): Readonly<{
  get: () => Promise<PreparedImage>;
  dispose: () => void;
}> {
  let value: Promise<PreparedImage> | undefined;
  let disposed = false;
  return {
    get: () => {
      value ??= factory().then((prepared) => {
        if (disposed) prepared.dispose();
        return prepared;
      });
      return value;
    },
    dispose: () => {
      disposed = true;
      if (value !== undefined) {
        void value.then((prepared) => {
          if (disposed) prepared.dispose();
        });
      }
    },
  };
}
