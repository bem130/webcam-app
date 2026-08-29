import type { CaptureError } from "../core/errors";
import { causeName } from "../core/errors";

export type EncodedWorkerVideoFrame = Readonly<{
  blob: Blob;
  width: number;
  height: number;
  rasterDurationMs: number;
  pngEncodeDurationMs: number;
}>;

type OffscreenCanvasFactory = (width: number, height: number) => OffscreenCanvas;

export async function encodeWorkerVideoFrame(
  bitmap: ImageBitmap,
  createCanvas: OffscreenCanvasFactory = (width, height) => new OffscreenCanvas(width, height),
  clock: () => number = () => performance.now(),
): Promise<EncodedWorkerVideoFrame> {
  let canvas: OffscreenCanvas | undefined;
  let bitmapClosed = false;
  try {
    if (bitmap.width <= 0 || bitmap.height <= 0) {
      throw new VideoFrameWorkerFailure({ tag: "frameNotReady" });
    }
    const width = bitmap.width;
    const height = bitmap.height;
    const rasterStartedAt = clock();
    canvas = createCanvas(width, height);
    const context = canvas.getContext("2d", { alpha: false });
    if (context === null) throw new VideoFrameWorkerFailure({ tag: "canvasUnavailable" });
    context.drawImage(bitmap, 0, 0, width, height);
    const rasterDurationMs = elapsed(clock, rasterStartedAt);
    bitmap.close();
    bitmapClosed = true;

    const pngStartedAt = clock();
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const pngEncodeDurationMs = elapsed(clock, pngStartedAt);
    return { blob, width, height, rasterDurationMs, pngEncodeDurationMs };
  } catch (cause) {
    throw videoFrameWorkerFailure(cause);
  } finally {
    if (!bitmapClosed) bitmap.close();
    releaseCanvas(canvas);
  }
}

export class VideoFrameWorkerFailure extends Error {
  constructor(readonly error: CaptureError) {
    super(error.tag);
    this.name = "VideoFrameWorkerFailure";
  }
}

function videoFrameWorkerFailure(cause: unknown): VideoFrameWorkerFailure {
  if (cause instanceof VideoFrameWorkerFailure) return cause;
  return new VideoFrameWorkerFailure(
    causeName(cause) === "QuotaExceededError"
      ? { tag: "memoryAllocationFailed" }
      : { tag: "pngEncodingFailed" },
  );
}

function elapsed(clock: () => number, startedAt: number): number {
  return Math.max(0, clock() - startedAt);
}

function releaseCanvas(canvas: OffscreenCanvas | undefined): void {
  if (canvas === undefined) return;
  canvas.width = 1;
  canvas.height = 1;
}
