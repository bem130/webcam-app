import type { CaptureError, ClipboardError } from "../core/errors";
import { causeName } from "../core/errors";
import { err, ok, type Result } from "../core/result";
import { beginPngWrite, browserClipboardPort, type ClipboardPort, PNG_MIME } from "./clipboard";

export type Dimensions = Readonly<{ width: number; height: number }>;
export type CapturedImage = Readonly<{
  png: Blob;
  width: number;
  height: number;
}>;
export type CaptureOperation = Readonly<{
  captured: Promise<Result<CapturedImage, CaptureError>>;
  thumbnail: Promise<Result<Blob, CaptureError>>;
  clipboard: Promise<Result<void, ClipboardError>>;
}>;
export type CaptureEncoder = Readonly<{
  encodePng: (video: HTMLVideoElement) => Promise<Blob>;
  encodeThumbnail: (png: Blob) => Promise<Blob>;
}>;

const THUMBNAIL_EDGE_PX = 320;

export function calculateContainedDimensions(
  sourceWidth: number,
  sourceHeight: number,
  maxLongEdge: number,
): Dimensions {
  if (sourceWidth <= 0 || sourceHeight <= 0 || maxLongEdge <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, maxLongEdge / Math.max(sourceWidth, sourceHeight));
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

export class CanvasCaptureEncoder {
  readonly #frameCanvas: HTMLCanvasElement;
  readonly #thumbnailCanvas: HTMLCanvasElement;

  constructor(
    frameCanvas = document.createElement("canvas"),
    thumbnailCanvas = document.createElement("canvas"),
  ) {
    this.#frameCanvas = frameCanvas;
    this.#thumbnailCanvas = thumbnailCanvas;
  }

  encodePng(video: HTMLVideoElement): Promise<Blob> {
    const dimensions = sourceDimensions(video.videoWidth, video.videoHeight);
    if (dimensions.width === 0 || dimensions.height === 0) {
      return Promise.reject(taggedCaptureError({ tag: "frameNotReady" }));
    }
    const context = this.#frameCanvas.getContext("2d");
    if (context === null) {
      releaseCanvas(this.#frameCanvas);
      return Promise.reject(taggedCaptureError({ tag: "canvasUnavailable" }));
    }
    this.#frameCanvas.width = dimensions.width;
    this.#frameCanvas.height = dimensions.height;
    try {
      context.drawImage(video, 0, 0, dimensions.width, dimensions.height);
    } catch (cause) {
      releaseCanvas(this.#frameCanvas);
      return Promise.reject(taggedCaptureError(mapEncodeFailure(cause)));
    }
    return canvasToBlob(this.#frameCanvas, PNG_MIME, { tag: "pngEncodingFailed" }).finally(() =>
      releaseCanvas(this.#frameCanvas),
    );
  }

  async encodeThumbnail(png: Blob): Promise<Blob> {
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(png);
      const dimensions = calculateContainedDimensions(
        bitmap.width,
        bitmap.height,
        THUMBNAIL_EDGE_PX,
      );
      const context = this.#thumbnailCanvas.getContext("2d");
      if (context === null) throw taggedCaptureError({ tag: "canvasUnavailable" });
      this.#thumbnailCanvas.width = dimensions.width;
      this.#thumbnailCanvas.height = dimensions.height;
      context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);
      return await canvasToBlob(
        this.#thumbnailCanvas,
        "image/jpeg",
        { tag: "pngEncodingFailed" },
        0.82,
      );
    } catch (cause) {
      if (isTaggedCaptureError(cause)) throw cause;
      throw taggedCaptureError(mapEncodeFailure(cause));
    } finally {
      bitmap?.close();
    }
  }
}

let sharedEncoder: CanvasCaptureEncoder | null = null;

export function beginCaptureAndCopy(
  video: HTMLVideoElement,
  encoder: CaptureEncoder = (sharedEncoder ??= new CanvasCaptureEncoder()),
  clipboardPort: ClipboardPort = browserClipboardPort(),
): CaptureOperation {
  const { width, height } = sourceDimensions(video.videoWidth, video.videoHeight);
  const png = encoder.encodePng(video);
  // Do not insert await/microtask/timer before this call: WebKit requires this user activation.
  const clipboard = beginPngWrite(png, clipboardPort);
  const captured = png
    .then((blob): CapturedImage => ({ png: blob, width, height }))
    .then(
      (value) => ok(value),
      (cause: unknown) => err(captureErrorFrom(cause)),
    );
  const thumbnail = png
    .then((blob) => encoder.encodeThumbnail(blob))
    .then(
      (value) => ok(value),
      (cause: unknown) => err(captureErrorFrom(cause)),
    );
  return { captured, thumbnail, clipboard };
}

export function sourceDimensions(sourceWidth: number, sourceHeight: number): Dimensions {
  return sourceWidth > 0 && sourceHeight > 0
    ? { width: sourceWidth, height: sourceHeight }
    : { width: 0, height: 0 };
}

function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 1;
  canvas.height = 1;
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  failure: CaptureError,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => {
          if (blob === null) reject(taggedCaptureError(failure));
          else resolve(blob);
        },
        type,
        quality,
      );
    } catch (cause) {
      reject(taggedCaptureError(mapEncodeFailure(cause)));
    }
  });
}

class TaggedCaptureError extends Error {
  readonly error: CaptureError;

  constructor(error: CaptureError) {
    super(error.tag);
    this.name = "TaggedCaptureError";
    this.error = error;
  }
}

const taggedCaptureError = (error: CaptureError): TaggedCaptureError =>
  new TaggedCaptureError(error);
const isTaggedCaptureError = (cause: unknown): cause is TaggedCaptureError =>
  cause instanceof TaggedCaptureError;

function captureErrorFrom(cause: unknown): CaptureError {
  return isTaggedCaptureError(cause) ? cause.error : mapEncodeFailure(cause);
}

function mapEncodeFailure(cause: unknown): CaptureError {
  return causeName(cause) === "QuotaExceededError"
    ? { tag: "memoryAllocationFailed" }
    : { tag: "pngEncodingFailed" };
}
