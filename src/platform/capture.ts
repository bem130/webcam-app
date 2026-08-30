import type { CaptureError, ClipboardError } from "../core/errors";
import { causeName } from "../core/errors";
import type {
  CapturePreference,
  CaptureRoute,
  CaptureTimingDurationStage,
  CaptureTimingMeasurement,
  CaptureTimingMilestone,
  ImageMimeType,
} from "../core/model";
import type { Option, Result } from "../core/result";
import { err, none, ok, some } from "../core/result";
import { beginPngWrite, browserClipboardPort, type ClipboardPort, PNG_MIME } from "./clipboard";
import {
  CanvasImageProcessingPort,
  isImageProcessingFailure,
  type EncodedClipboardPng,
  type ImageProcessingPort,
} from "./image-processing";
import type { NativePhotoCapture } from "./native-photo";
import { releaseCanvasBackingStore } from "./canvas-memory";

export type Dimensions = Readonly<{ width: number; height: number }>;
export type VideoFrameEncodeDurations = Readonly<{
  videoFrameAcquire: number;
  videoFrameTransfer: Option<number>;
  videoFrameRaster: number;
  videoFramePngEncode: number;
}>;
export type EncodedVideoFrame = Readonly<{
  blob: Blob;
  width: number;
  height: number;
  durations: VideoFrameEncodeDurations;
}>;
export type CapturedImage = Readonly<{
  blob: Blob;
  mimeType: ImageMimeType;
  width: number;
  height: number;
  route: CaptureRoute;
}>;

export type CaptureOperation = Readonly<{
  cameraSourceSettled: Promise<void>;
  captured: Promise<Result<CapturedImage, CaptureError>>;
  thumbnail: Promise<Result<Blob, CaptureError>>;
  clipboard: Promise<Result<void, ClipboardError>>;
}>;

export type CaptureEncoder = Readonly<{
  encodeVideoFramePng: (
    video: HTMLVideoElement,
    clock?: () => number,
  ) => Promise<EncodedVideoFrame>;
  inspectImage: (image: Blob) => Promise<Dimensions>;
  encodeBlobPng: (image: Blob) => Promise<Blob>;
  encodeThumbnail: (image: Blob) => Promise<Blob>;
}>;

export type CaptureDependencies = Readonly<{
  encoder?: CaptureEncoder;
  imageProcessing?: ImageProcessingPort;
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
    clock: () => number = defaultClock,
  ): Promise<EncodedVideoFrame> {
    const acquireStartedAt = clock();
    const dimensions = sourceDimensions(video.videoWidth, video.videoHeight);
    const videoFrameAcquire = elapsed(clock, acquireStartedAt);
    if (dimensions.width === 0 || dimensions.height === 0) {
      throw taggedCaptureError({ tag: "frameNotReady" });
    }
    try {
      this.#frameCanvas.width = dimensions.width;
      this.#frameCanvas.height = dimensions.height;
      const rasterStartedAt = clock();
      const context = this.#frameCanvas.getContext("2d");
      if (context === null) throw taggedCaptureError({ tag: "canvasUnavailable" });
      context.drawImage(video, 0, 0, dimensions.width, dimensions.height);
      const videoFrameRaster = elapsed(clock, rasterStartedAt);
      const pngStartedAt = clock();
      const blob = await canvasToBlob(this.#frameCanvas, PNG_MIME, {
        tag: "pngEncodingFailed",
      });
      const videoFramePngEncode = elapsed(clock, pngStartedAt);
      return {
        blob,
        ...dimensions,
        durations: {
          videoFrameAcquire,
          videoFrameTransfer: none,
          videoFrameRaster,
          videoFramePngEncode,
        },
      };
    } catch (cause) {
      if (isTaggedCaptureError(cause)) throw cause;
      throw taggedCaptureError(mapEncodeFailure(cause));
    } finally {
      releaseCanvasBackingStore(this.#frameCanvas);
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
      releaseCanvasBackingStore(this.#frameCanvas);
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
      releaseCanvasBackingStore(this.#thumbnailCanvas);
    }
  }
}

export function beginCaptureAndCopy(
  video: HTMLVideoElement,
  dependencies: CaptureDependencies = {},
): CaptureOperation {
  const encoder = dependencies.encoder ?? new CanvasCaptureEncoder();
  const imageProcessing = dependencies.imageProcessing ?? new CanvasImageProcessingPort();
  const clipboardPort = dependencies.clipboardPort ?? browserClipboardPort();
  const nativePhoto = dependencies.nativePhoto ?? none;
  const preference = dependencies.preference ?? "photoPreferred";
  const clock = dependencies.clock ?? defaultClock;
  const observeTiming = dependencies.observeTiming ?? ignoreTiming;
  const cameraSource = deferred<void>();
  const settleCameraSource = once(() => cameraSource.resolve(undefined));

  const shutterStartedAt = clock();
  const source = captureSource(
    video,
    encoder,
    imageProcessing,
    nativePhoto,
    preference,
    clock,
    observeTiming,
    settleCameraSource,
  );
  const captured = source.then(
    (value) => ok(value.image),
    (cause: unknown) => err(captureErrorFrom(cause)),
  );
  const clipboardPng = compatibleClipboardPng(source, clock, shutterStartedAt, observeTiming);
  // Some fake Clipboard adapters do not observe their ClipboardItem promise.
  void clipboardPng.catch(() => undefined);
  // Keep this synchronous with the shutter handler for WebKit user activation.
  const clipboard = beginPngWrite(clipboardPng, clipboardPort).then((result) => {
    recordMilestone(observeTiming, "clipboardSettled", some(elapsed(clock, shutterStartedAt)));
    return result;
  });
  const clipboardRepresentationSettled = clipboardPng.then(
    () => undefined,
    () => undefined,
  );
  const thumbnail = Promise.all([source, clipboard, clipboardRepresentationSettled])
    .then(async ([value]) => {
      const thumbnailStartedAt = clock();
      try {
        return await value.encodeThumbnail();
      } finally {
        value.dispose();
        recordDuration(observeTiming, "thumbnail", some(elapsed(clock, thumbnailStartedAt)));
      }
    })
    .then(
      (value) => ok(value),
      (cause: unknown) => err(captureErrorFrom(cause)),
    );

  return { cameraSourceSettled: cameraSource.promise, captured, thumbnail, clipboard };
}

export function beginCapturedImageCopy(
  image: Pick<CapturedImage, "blob" | "mimeType">,
  dependencies: Readonly<{
    encoder?: CaptureEncoder;
    imageProcessing?: ImageProcessingPort;
    clipboardPort?: ClipboardPort;
  }> = {},
): Promise<Result<void, ClipboardError>> {
  const encoder = dependencies.encoder ?? new CanvasCaptureEncoder();
  const clipboardPort = dependencies.clipboardPort ?? browserClipboardPort();
  const png =
    image.mimeType === PNG_MIME
      ? Promise.resolve(image.blob)
      : dependencies.imageProcessing === undefined
        ? encoder.encodeBlobPng(image.blob)
        : dependencies.imageProcessing.prepare(image.blob, true).then(async (prepared) => {
            try {
              return (await prepared.clipboardPng).blob;
            } finally {
              prepared.dispose();
            }
          });
  void png.catch(() => undefined);
  return beginPngWrite(png, clipboardPort);
}

type CaptureSource = Readonly<{
  image: CapturedImage;
  clipboardPng: Promise<EncodedClipboardPng>;
  encodeThumbnail: () => Promise<Blob>;
  dispose: () => void;
}>;

async function captureSource(
  video: HTMLVideoElement,
  encoder: CaptureEncoder,
  imageProcessing: ImageProcessingPort,
  nativePhoto: Option<NativePhotoCapture>,
  preference: CapturePreference,
  clock: () => number,
  observeTiming: (measurement: CaptureTimingMeasurement) => void,
  settleCameraSource: () => void,
): Promise<CaptureSource> {
  if (preference === "videoFrame" || nativePhoto.tag === "none") {
    return captureVideoFrame(
      video,
      encoder,
      imageProcessing,
      clock,
      observeTiming,
      settleCameraSource,
    );
  }

  const sourceStartedAt = clock();
  let nativeBlob: Blob;
  try {
    nativeBlob = await nativePhoto.value.takePhoto();
  } catch {
    recordDuration(observeTiming, "sourceAcquisition", some(elapsed(clock, sourceStartedAt)));
    if (nativePhoto.value.track.readyState !== "live") {
      settleCameraSource();
      throw taggedCaptureError({ tag: "photoCaptureFailed" });
    }
    return captureVideoFrame(
      video,
      encoder,
      imageProcessing,
      clock,
      observeTiming,
      settleCameraSource,
    );
  }
  recordDuration(observeTiming, "sourceAcquisition", some(elapsed(clock, sourceStartedAt)));
  settleCameraSource();

  const mimeType = imageMimeType(nativeBlob);
  const decodeStartedAt = clock();
  try {
    const prepared = await imageProcessing.prepare(nativeBlob, mimeType !== PNG_MIME);
    return {
      image: {
        blob: nativeBlob,
        mimeType,
        width: prepared.dimensions.width,
        height: prepared.dimensions.height,
        route: "photo",
      },
      clipboardPng: prepared.clipboardPng,
      encodeThumbnail: prepared.encodeThumbnail,
      dispose: prepared.dispose,
    };
  } finally {
    recordDuration(observeTiming, "imageDecode", some(elapsed(clock, decodeStartedAt)));
  }
}

async function captureVideoFrame(
  video: HTMLVideoElement,
  encoder: CaptureEncoder,
  imageProcessing: ImageProcessingPort,
  clock: () => number,
  observeTiming: (measurement: CaptureTimingMeasurement) => void,
  settleCameraSource: () => void,
): Promise<CaptureSource> {
  try {
    const image = await imageProcessing.processVideoFrame(
      video,
      () => encoder.encodeVideoFramePng(video, clock),
      clock,
    );
    recordDuration(observeTiming, "videoFrameAcquire", some(image.durations.videoFrameAcquire));
    recordDuration(observeTiming, "videoFrameTransfer", image.durations.videoFrameTransfer);
    recordDuration(observeTiming, "videoFrameRaster", some(image.durations.videoFrameRaster));
    recordDuration(observeTiming, "videoFramePngEncode", some(image.durations.videoFramePngEncode));
    const capturedImage = {
      blob: image.blob,
      mimeType: imageMimeType(image.blob),
      width: image.width,
      height: image.height,
      route: "videoFrame" as const,
    };
    return {
      image: capturedImage,
      clipboardPng: Promise.resolve({ blob: image.blob, durationMs: 0 }),
      encodeThumbnail: () => encoder.encodeThumbnail(image.blob),
      dispose: () => undefined,
    };
  } finally {
    settleCameraSource();
  }
}

function compatibleClipboardPng(
  source: Promise<CaptureSource>,
  clock: () => number,
  shutterStartedAt: number,
  observeTiming: (measurement: CaptureTimingMeasurement) => void,
): Promise<Blob> {
  return source.then(async (value) => {
    if (value.image.mimeType === PNG_MIME) {
      recordDuration(observeTiming, "clipboardEncode", none);
    } else {
      const representation = await representationReady(value.clipboardPng);
      recordDuration(observeTiming, "clipboardEncode", some(representation.durationMs));
      return representation.blob;
    }
    return (await representationReady(value.clipboardPng)).blob;
  });

  async function representationReady(
    png: Promise<EncodedClipboardPng>,
  ): Promise<EncodedClipboardPng> {
    const value = await png;
    recordMilestone(
      observeTiming,
      "clipboardRepresentationReady",
      some(elapsed(clock, shutterStartedAt)),
    );
    return value;
  }
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
  if (isImageProcessingFailure(cause)) return cause.error;
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

function recordDuration(
  observer: (measurement: CaptureTimingMeasurement) => void,
  stage: CaptureTimingDurationStage,
  durationMs: Option<number>,
): void {
  try {
    observer({ kind: "duration", stage, durationMs });
  } catch {
    // Diagnostics must never change capture behavior.
  }
}

function recordMilestone(
  observer: (measurement: CaptureTimingMeasurement) => void,
  milestone: CaptureTimingMilestone,
  offsetFromShutterMs: Option<number>,
): void {
  try {
    observer({ kind: "milestone", milestone, offsetFromShutterMs });
  } catch {
    // Diagnostics must never change capture behavior.
  }
}

function ignoreTiming(): void {}

function deferred<T>(): Readonly<{ promise: Promise<T>; resolve: (value: T) => void }> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function once(effect: () => void): () => void {
  let completed = false;
  return () => {
    if (completed) return;
    completed = true;
    effect();
  };
}
