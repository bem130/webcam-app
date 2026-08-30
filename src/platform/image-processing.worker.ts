import type { CaptureError } from "../core/errors";
import { releaseCanvasBackingStore } from "./canvas-memory";
import type { ImageProcessingRequest, ImageProcessingResponse } from "./image-processing-protocol";
import { encodeWorkerVideoFrame, VideoFrameWorkerFailure } from "./video-frame-worker";

type WorkerScope = Readonly<{
  postMessage: (message: ImageProcessingResponse) => void;
}> & {
  onmessage: ((event: Readonly<{ data: ImageProcessingRequest }>) => void) | null;
};

type PreparedJob = Readonly<{ thumbnailCanvas: OffscreenCanvas }>;

const workerScope = globalThis as unknown as WorkerScope;
const jobs = new Map<number, PreparedJob>();
const THUMBNAIL_EDGE_PX = 320;
let processingQueue = Promise.resolve();

workerScope.onmessage = (event) => {
  const request = event.data;
  switch (request.type) {
    case "prepare":
      enqueue(() => prepare(request));
      break;
    case "prepareVideoFrame":
      post({ type: "videoFrameAccepted", jobId: request.jobId });
      enqueue(() => prepareVideoFrame(request));
      break;
    case "encodeThumbnail":
      enqueue(() => encodeThumbnail(request.jobId));
      break;
    case "discard":
      discard(request.jobId);
      break;
  }
};

async function prepareVideoFrame(
  request: Extract<ImageProcessingRequest, { type: "prepareVideoFrame" }>,
): Promise<void> {
  try {
    const encoded = await encodeWorkerVideoFrame(request.bitmap);
    post({ type: "videoFrameReady", jobId: request.jobId, ...encoded });
  } catch (cause) {
    post({
      type: "videoFrameFailed",
      jobId: request.jobId,
      error: cause instanceof VideoFrameWorkerFailure ? cause.error : { tag: "pngEncodingFailed" },
    });
  }
}

function enqueue(task: () => Promise<void>): void {
  processingQueue = processingQueue.then(task, task);
}

async function prepare(request: Extract<ImageProcessingRequest, { type: "prepare" }>) {
  let bitmap: ImageBitmap | undefined;
  let fullCanvas: OffscreenCanvas | undefined;
  let thumbnailCanvas: OffscreenCanvas | undefined;
  try {
    bitmap = await createImageBitmap(request.image);
    if (bitmap.width <= 0 || bitmap.height <= 0) {
      throw workerFailure({ tag: "invalidImage" });
    }

    const thumbnailDimensions = containedDimensions(bitmap.width, bitmap.height);
    thumbnailCanvas = new OffscreenCanvas(thumbnailDimensions.width, thumbnailDimensions.height);
    const thumbnailContext = thumbnailCanvas.getContext("2d", { alpha: false });
    if (thumbnailContext === null) throw workerFailure({ tag: "canvasUnavailable" });
    thumbnailContext.drawImage(bitmap, 0, 0, thumbnailDimensions.width, thumbnailDimensions.height);

    let clipboardPng: Promise<Blob> | undefined;
    let clipboardPngStartedAt: number | undefined;
    if (request.needsClipboardPng) {
      fullCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const fullContext = fullCanvas.getContext("2d", { alpha: false });
      if (fullContext === null) throw workerFailure({ tag: "canvasUnavailable" });
      fullContext.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height);
      clipboardPngStartedAt = performance.now();
      clipboardPng = fullCanvas.convertToBlob({ type: "image/png" });
    }

    const job = { thumbnailCanvas };
    jobs.set(request.jobId, job);
    post({
      type: "prepared",
      jobId: request.jobId,
      width: bitmap.width,
      height: bitmap.height,
    });
    bitmap.close();
    bitmap = undefined;

    if (clipboardPng !== undefined) {
      try {
        const blob = await clipboardPng;
        post({
          type: "clipboardPngReady",
          jobId: request.jobId,
          blob,
          durationMs:
            clipboardPngStartedAt === undefined
              ? 0
              : Math.max(0, performance.now() - clipboardPngStartedAt),
        });
      } catch (cause) {
        post({
          type: "clipboardPngFailed",
          jobId: request.jobId,
          error: mapWorkerFailure(cause, { tag: "pngEncodingFailed" }),
        });
      } finally {
        releaseCanvasBackingStore(fullCanvas);
      }
    }
  } catch (cause) {
    bitmap?.close();
    releaseCanvasBackingStore(fullCanvas);
    releaseCanvasBackingStore(thumbnailCanvas);
    jobs.delete(request.jobId);
    post({
      type: "preparationFailed",
      jobId: request.jobId,
      error: mapWorkerFailure(cause, { tag: "imageDecodeFailed" }),
    });
  }
}

async function encodeThumbnail(jobId: number) {
  const job = jobs.get(jobId);
  if (job === undefined) return;
  try {
    const blob = await job.thumbnailCanvas.convertToBlob({ type: "image/jpeg", quality: 0.82 });
    post({ type: "thumbnailReady", jobId, blob });
  } catch (cause) {
    post({
      type: "thumbnailFailed",
      jobId,
      error: mapWorkerFailure(cause, { tag: "thumbnailEncodingFailed" }),
    });
  } finally {
    discard(jobId);
  }
}

function discard(jobId: number): void {
  const job = jobs.get(jobId);
  if (job === undefined) return;
  jobs.delete(jobId);
  releaseCanvasBackingStore(job.thumbnailCanvas);
}

function containedDimensions(
  width: number,
  height: number,
): Readonly<{
  width: number;
  height: number;
}> {
  const scale = Math.min(1, THUMBNAIL_EDGE_PX / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

class WorkerImageProcessingFailure extends Error {
  constructor(readonly error: CaptureError) {
    super(error.tag);
    this.name = "WorkerImageProcessingFailure";
  }
}

function workerFailure(error: CaptureError): WorkerImageProcessingFailure {
  return new WorkerImageProcessingFailure(error);
}

function mapWorkerFailure(cause: unknown, fallback: CaptureError): CaptureError {
  if (cause instanceof WorkerImageProcessingFailure) return cause.error;
  return cause instanceof DOMException && cause.name === "QuotaExceededError"
    ? { tag: "memoryAllocationFailed" }
    : fallback;
}

function post(message: ImageProcessingResponse): void {
  workerScope.postMessage(message);
}
