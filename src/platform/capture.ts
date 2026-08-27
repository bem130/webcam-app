import type { CaptureError, ClipboardError } from "../core/errors";
import { causeName } from "../core/errors";
import { err, ok, type Result } from "../core/result";
import { beginPngWrite, browserClipboardPort, type ClipboardPort, PNG_MIME } from "./clipboard";

export type Dimensions = Readonly<{ width: number; height: number }>;
export type EncodedCapture = Readonly<{
  png: Blob;
  thumbnail: Blob;
  width: number;
  height: number;
}>;
export type CaptureOperation = Readonly<{
  encoded: Promise<Result<EncodedCapture, CaptureError>>;
  clipboard: Promise<Result<void, ClipboardError>>;
}>;

const MAX_LONG_EDGE_PX = 1920;
const THUMBNAIL_EDGE_PX = 320;

export function calculateTargetDimensions(
  sourceWidth: number,
  sourceHeight: number,
  maxLongEdge = MAX_LONG_EDGE_PX,
): Dimensions {
  if (sourceWidth <= 0 || sourceHeight <= 0 || maxLongEdge <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, maxLongEdge / Math.max(sourceWidth, sourceHeight));
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

export class CanvasCaptureEncoder {
  readonly #frameCanvas = document.createElement("canvas");
  readonly #thumbnailCanvas = document.createElement("canvas");

  encodePng(video: HTMLVideoElement): Promise<Blob> {
    const dimensions = calculateTargetDimensions(video.videoWidth, video.videoHeight);
    if (dimensions.width === 0 || dimensions.height === 0) {
      return Promise.reject(taggedCaptureError({ tag: "frameNotReady" }));
    }
    const context = this.#frameCanvas.getContext("2d");
    if (context === null) return Promise.reject(taggedCaptureError({ tag: "canvasUnavailable" }));
    this.#frameCanvas.width = dimensions.width;
    this.#frameCanvas.height = dimensions.height;
    try {
      context.drawImage(video, 0, 0, dimensions.width, dimensions.height);
    } catch (cause) {
      return Promise.reject(taggedCaptureError(mapEncodeFailure(cause)));
    }
    return canvasToBlob(this.#frameCanvas, PNG_MIME, { tag: "pngEncodingFailed" });
  }

  async encodeThumbnail(png: Blob): Promise<Blob> {
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(png);
      const dimensions = calculateTargetDimensions(bitmap.width, bitmap.height, THUMBNAIL_EDGE_PX);
      const context = this.#thumbnailCanvas.getContext("2d");
      if (context === null) throw taggedCaptureError({ tag: "canvasUnavailable" });
      this.#thumbnailCanvas.width = dimensions.width;
      this.#thumbnailCanvas.height = dimensions.height;
      context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);
      return await canvasToBlob(this.#thumbnailCanvas, "image/jpeg", { tag: "pngEncodingFailed" }, 0.82);
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
  encoder = (sharedEncoder ??= new CanvasCaptureEncoder()),
  clipboardPort: ClipboardPort = browserClipboardPort(),
): CaptureOperation {
  const { width, height } = calculateTargetDimensions(video.videoWidth, video.videoHeight);
  const png = encoder.encodePng(video);
  // Do not insert await/microtask/timer before this call: WebKit requires this user activation.
  const clipboard = beginPngWrite(png, clipboardPort);
  const encoded = png
    .then(async (blob): Promise<EncodedCapture> => ({
      png: blob,
      thumbnail: await encoder.encodeThumbnail(blob),
      width,
      height,
    }))
    .then((value) => ok(value), (cause: unknown) => err(captureErrorFrom(cause)));
  return { encoded, clipboard };
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  failure: CaptureError,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob === null) reject(taggedCaptureError(failure));
        else resolve(blob);
      }, type, quality);
    } catch (cause) {
      reject(taggedCaptureError(mapEncodeFailure(cause)));
    }
  });
}

type TaggedCaptureError = Readonly<{ marker: "capture-error"; error: CaptureError }>;
const taggedCaptureError = (error: CaptureError): TaggedCaptureError => ({ marker: "capture-error", error });
const isTaggedCaptureError = (cause: unknown): cause is TaggedCaptureError =>
  typeof cause === "object" && cause !== null && "marker" in cause && cause.marker === "capture-error";

function captureErrorFrom(cause: unknown): CaptureError {
  return isTaggedCaptureError(cause) ? cause.error : mapEncodeFailure(cause);
}

function mapEncodeFailure(cause: unknown): CaptureError {
  return causeName(cause) === "QuotaExceededError"
    ? { tag: "memoryAllocationFailed" }
    : { tag: "pngEncodingFailed" };
}
