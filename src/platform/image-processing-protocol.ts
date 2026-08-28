import type { CaptureError } from "../core/errors";

export type ImageProcessingRequest =
  | Readonly<{
      type: "prepare";
      jobId: number;
      image: Blob;
      needsClipboardPng: boolean;
    }>
  | Readonly<{ type: "encodeThumbnail"; jobId: number }>
  | Readonly<{ type: "discard"; jobId: number }>;

export type ImageProcessingResponse =
  | Readonly<{ type: "prepared"; jobId: number; width: number; height: number }>
  | Readonly<{ type: "preparationFailed"; jobId: number; error: CaptureError }>
  | Readonly<{
      type: "clipboardPngReady";
      jobId: number;
      blob: Blob;
      durationMs: number;
    }>
  | Readonly<{ type: "clipboardPngFailed"; jobId: number; error: CaptureError }>
  | Readonly<{ type: "thumbnailReady"; jobId: number; blob: Blob }>
  | Readonly<{ type: "thumbnailFailed"; jobId: number; error: CaptureError }>;
