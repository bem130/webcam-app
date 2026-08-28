import type { CaptureError, ClipboardError } from "../core/errors";
import { causeName } from "../core/errors";
import type {
  CapturePreference,
  CaptureRoute,
  CaptureTimingMeasurement,
  ImageMimeType,
} from "../core/model";
import type { Option, Result } from "../core/result";
import { err, none, ok, some } from "../core/result";
import { beginPngWrite, browserClipboardPort, type ClipboardPort, PNG_MIME } from "./clipboard";
import type { NativePhotoCapture } from "./native-photo";

export type Dimensions = Readonly<{ width: number; height: number }>;
export type CapturedImage = Readonly<{
  blob: Blob;
  mimeType: ImageMimeType;
  width: number;
  height: number;
  route: CaptureRoute;
}>;

export type CaptureOperation = Readonly<{
  captured: Promise<Result<CapturedImage, CaptureError>>;
  thumbnail: Promise<Result<Blob, CaptureError>>;
  clipboard: Promise<Result<void, ClipboardError>>;
}>;

export type CaptureEncoder = Readonly<{
  encodeVideoFramePng: (
    video: HTMLVideoElement,
  ) => Promise<Readonly<{ blob: Blob; width: number; height: number }>>;
  inspectImage: (image: Blob) => Promise<Dimensions>;
  encodeBlobPng: (image: Blob) => Promise<Blob>;
  encodeThumbnail: (image: Blob) => Promise<Blob>;
}>;

export type CaptureDependencies = Readonly<{
  encoder?: CaptureEncoder;
  clipboardPort?: ClipboardPort;
  nativePhoto?: Option<NativePhotoCapture>;
  preference?: CapturePreference;
  clock?: () => number;
  observeTiming?: (measurement: CaptureTimingMeasurement) => void;
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

export class CanvasCaptureEncoder implements CaptureEncoder {
  readonly #frameCanvas: HTMLCanvasElement;
  readonly #thumbnailCanvas: HTMLCanvasElement;

  constructor(
    frameCanvas = document.createElement("canvas"),
    thumbnailCanvas = document.createElement("canvas"),
  ) {
    this.#frameCanvas = frameCanvas;
    this.#thumbnailCanvas = thumbnailCanvas;
  }

  async encodeVideoFramePng(
    video: HTMLVideoElement,
  ): Promise<Readonly<{ blob: Blob; width: number; height: number }>> {
    const dimensions = sourceDimensions(video.videoWidth, video.videoHeight);
    if (dimensions.width === 0 || dimensions.height === 0) {
      throw taggedCaptureError({ tag: "frameNotReady" });
    }
    this.#frameCanvas.width = dimensions.width;
    this.#frameCanvas.height = dimensions.height;
    try {
      const context = this.#frameCanvas.getContext("2d");
      if (context === null) throw taggedCaptureError({ tag: "canvasUnavailable" });
      context.drawImage(video, 0, 0, dimensions.width, dimensions.height);
      const blob = await canvasToBlob(this.#frameCanvas, PNG_MIME, {
        tag: "pngEncodingFailed",
      });
      return { blob, ...dimensions };
    } catch (cause) {
      if (isTaggedCaptureError(cause)) throw cause;
      throw taggedCaptureError(mapEncodeFailure(cause));
    } finally {
      releaseCanvas(this.#frameCanvas);
    }
  }

  async inspectImage(image: Blob): Promise<Dimensions> {
    let bitmap: ImageBitmap | undefined;
    try {
      bitmap = await createImageBitmap(image);
      const dimensions = sourceDimensions(bitmap.width, bitmap.height);
      if (dimensions.width === 0 || dimensions.height === 0) {
        throw taggedCaptureError({ tag: "invalidImage" });
      }
      return dimensions;
    } catch (cause) {
      if (isTaggedCaptureError(cause)) throw cause;
      throw taggedCaptureError({ tag: "imageDecodeFailed" });
    } finally {
      bitmap?.close();
    }
  }

  async encodeBlobPng(image: Blob): Promise<Blob> {
    let bitmap: ImageBitmap | undefined;
    try {
      bitmap = await createImageBitmap(image);
      const dimensions = sourceDimensions(bitmap.width, bitmap.height);
      if (dimensions.width === 0 || dimensions.height === 0) {
        throw taggedCaptureError({ tag: "invalidImage" });
      }
      this.#frameCanvas.width = dimensions.width;
      this.#frameCanvas.height = dimensions.height;
      const context = this.#frameCanvas.getContext("2d");
      if (context === null) throw taggedCaptureError({ tag: "canvasUnavailable" });
      context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);
      return await canvasToBlob(this.#frameCanvas, PNG_MIME, {
        tag: "pngEncodingFailed",
      });
    } catch (cause) {
      if (isTaggedCaptureError(cause)) throw cause;
      throw taggedCaptureError(mapEncodeFailure(cause));
    } finally {
      bitmap?.close();
      releaseCanvas(this.#frameCanvas);
    }
  }

  async encodeThumbnail(image: Blob): Promise<Blob> {
    let bitmap: ImageBitmap | undefined;
    try {
      bitmap = await createImageBitmap(image);
      const dimensions = calculateContainedDimensions(
        bitmap.width,
        bitmap.height,
        THUMBNAIL_EDGE_PX,
      );
      if (dimensions.width === 0 || dimensions.height === 0) {
        throw taggedCaptureError({ tag: "invalidImage" });
      }
      this.#thumbnailCanvas.width = dimensions.width;
      this.#thumbnailCanvas.height = dimensions.height;
      const context = this.#thumbnailCanvas.getContext("2d");
      if (context === null) throw taggedCaptureError({ tag: "canvasUnavailable" });
      context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);
      return await canvasToBlob(
        this.#thumbnailCanvas,
        "image/jpeg",
        { tag: "thumbnailEncodingFailed" },
        0.82,
      );
    } catch (cause) {
      if (isTaggedCaptureError(cause)) throw cause;
      throw taggedCaptureError(mapEncodeFailure(cause));
    } finally {
      bitmap?.close();
      releaseCanvas(this.#thumbnailCanvas);
    }
  }
}

export function beginCaptureAndCopy(
  video: HTMLVideoElement,
  dependencies: CaptureDependencies = {},
): CaptureOperation {
  const encoder = dependencies.encoder ?? new CanvasCaptureEncoder();
  const clipboardPort = dependencies.clipboardPort ?? browserClipboardPort();
  const nativePhoto = dependencies.nativePhoto ?? none;
  const preference = dependencies.preference ?? "photoPreferred";
  const clock = dependencies.clock ?? defaultClock;
  const observeTiming = dependencies.observeTiming ?? ignoreTiming;

  const image = captureImage(video, encoder, nativePhoto, preference, clock, observeTiming);
  const captured = image.then(
    (value) => ok(value),
    (cause: unknown) => err(captureErrorFrom(cause)),
  );
  const clipboardPng = compatibleClipboardPng(image, encoder, clock, observeTiming);
  // Some fake Clipboard adapters do not observe their ClipboardItem promise.
  void clipboardPng.catch(() => undefined);
  const clipboardStartedAt = clock();
  // Keep this synchronous with the shutter handler for WebKit user activation.
  const clipboard = beginPngWrite(clipboardPng, clipboardPort).then((result) => {
    recordTiming(observeTiming, "clipboardSettle", some(elapsed(clock, clipboardStartedAt)));
    return result;
  });
  const clipboardRepresentationSettled = clipboardPng.then(
    () => undefined,
    () => undefined,
  );
  const thumbnail = Promise.all([image, clipboardRepresentationSettled])
    .then(async ([value]) => {
      const thumbnailStartedAt = clock();
      try {
        return await encoder.encodeThumbnail(value.blob);
      } finally {
        recordTiming(observeTiming, "thumbnail", some(elapsed(clock, thumbnailStartedAt)));
      }
    })
    .then(
      (value) => ok(value),
      (cause: unknown) => err(captureErrorFrom(cause)),
    );

  return { captured, thumbnail, clipboard };
}

export function beginCapturedImageCopy(
  image: Pick<CapturedImage, "blob" | "mimeType">,
  encoder: CaptureEncoder = new CanvasCaptureEncoder(),
  clipboardPort: ClipboardPort = browserClipboardPort(),
): Promise<Result<void, ClipboardError>> {
  const png =
    image.mimeType === PNG_MIME ? Promise.resolve(image.blob) : encoder.encodeBlobPng(image.blob);
  void png.catch(() => undefined);
  return beginPngWrite(png, clipboardPort);
}

async function captureImage(
  video: HTMLVideoElement,
  encoder: CaptureEncoder,
  nativePhoto: Option<NativePhotoCapture>,
  preference: CapturePreference,
  clock: () => number,
  observeTiming: (measurement: CaptureTimingMeasurement) => void,
): Promise<CapturedImage> {
  if (preference === "videoFrame" || nativePhoto.tag === "none") {
    return captureVideoFrame(video, encoder, clock, observeTiming);
  }

  const sourceStartedAt = clock();
  let nativeBlob: Blob;
  try {
    nativeBlob = await nativePhoto.value.takePhoto();
  } catch {
    recordTiming(observeTiming, "sourceAcquisition", some(elapsed(clock, sourceStartedAt)));
    if (nativePhoto.value.track.readyState !== "live") {
      throw taggedCaptureError({ tag: "photoCaptureFailed" });
    }
    return captureVideoFrame(video, encoder, clock, observeTiming);
  }
  recordTiming(observeTiming, "sourceAcquisition", some(elapsed(clock, sourceStartedAt)));

  try {
    const mimeType = imageMimeType(nativeBlob);
    const decodeStartedAt = clock();
    try {
      const dimensions = await encoder.inspectImage(nativeBlob);
      return {
        blob: nativeBlob,
        mimeType,
        width: dimensions.width,
        height: dimensions.height,
        route: "photo",
      };
    } finally {
      recordTiming(observeTiming, "imageDecode", some(elapsed(clock, decodeStartedAt)));
    }
  } catch (cause) {
    if (nativePhoto.value.track.readyState !== "live") throw cause;
    return captureVideoFrame(video, encoder, clock, observeTiming);
  }
}

async function captureVideoFrame(
  video: HTMLVideoElement,
  encoder: CaptureEncoder,
  clock: () => number,
  observeTiming: (measurement: CaptureTimingMeasurement) => void,
): Promise<CapturedImage> {
  const startedAt = clock();
  try {
    const image = await encoder.encodeVideoFramePng(video);
    return {
      blob: image.blob,
      mimeType: imageMimeType(image.blob),
      width: image.width,
      height: image.height,
      route: "videoFrame",
    };
  } finally {
    recordTiming(observeTiming, "videoFrameEncode", some(elapsed(clock, startedAt)));
  }
}

function compatibleClipboardPng(
  image: Promise<CapturedImage>,
  encoder: CaptureEncoder,
  clock: () => number,
  observeTiming: (measurement: CaptureTimingMeasurement) => void,
): Promise<Blob> {
  return image.then(async (value) => {
    if (value.mimeType === PNG_MIME) {
      recordTiming(observeTiming, "clipboardEncode", none);
      return value.blob;
    }
    const startedAt = clock();
    try {
      return await encoder.encodeBlobPng(value.blob);
    } finally {
      recordTiming(observeTiming, "clipboardEncode", some(elapsed(clock, startedAt)));
    }
  });
}

export function sourceDimensions(sourceWidth: number, sourceHeight: number): Dimensions {
  return sourceWidth > 0 && sourceHeight > 0
    ? { width: sourceWidth, height: sourceHeight }
    : { width: 0, height: 0 };
}

function imageMimeType(blob: Blob): ImageMimeType {
  const type = blob.type.trim().toLowerCase();
  if (!/^image\/[a-z0-9][a-z0-9.+-]*$/.test(type)) {
    throw taggedCaptureError({ tag: "invalidImage" });
  }
  return type as ImageMimeType;
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

function defaultClock(): number {
  return performance.now();
}

function elapsed(clock: () => number, startedAt: number): number {
  return Math.max(0, clock() - startedAt);
}

function recordTiming(
  observer: (measurement: CaptureTimingMeasurement) => void,
  stage: CaptureTimingMeasurement["stage"],
  elapsedMs: Option<number>,
): void {
  try {
    observer({ stage, elapsedMs });
  } catch {
    // Diagnostics must never change capture behavior.
  }
}

function ignoreTiming(): void {}
