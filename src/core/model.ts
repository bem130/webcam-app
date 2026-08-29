import type { CameraError, ClipboardError } from "./errors";
import type { SuspensionReason } from "./idle";
import type { Option } from "./result";

declare const cameraIdBrand: unique symbol;
declare const captureIdBrand: unique symbol;

export type CameraId = string & { readonly [cameraIdBrand]: "CameraId" };
export type CaptureId = string & { readonly [captureIdBrand]: "CaptureId" };

export const cameraId = (value: string): CameraId => value as CameraId;
export const captureId = (value: string): CaptureId => value as CaptureId;

export type CameraFacing = "user" | "environment" | "left" | "right" | "unknown";

export type CameraDescriptor = Readonly<{
  id: CameraId;
  label: string;
  facing: CameraFacing;
}>;

export type CameraVideoSettings = Readonly<{
  widthPx: number;
  heightPx: number;
  frameRate: Option<number>;
}>;

export type PhotoCaptureSettings = Readonly<{
  widthPx: number;
  heightPx: number;
}>;
export type PhotoCapabilityState =
  | Readonly<{ tag: "checking" }>
  | Readonly<{ tag: "unsupported" }>
  | Readonly<{ tag: "supported"; settings: PhotoCaptureSettings }>;

export type CapturePreference = "photoPreferred" | "videoFrame";
export type CaptureRoute = "photo" | "videoFrame";
export type ImageMimeType = `image/${string}`;
export type CaptureTimingDurationStage =
  | "sourceAcquisition"
  | "videoFrameAcquire"
  | "videoFrameTransfer"
  | "videoFrameRaster"
  | "videoFramePngEncode"
  | "imageDecode"
  | "clipboardEncode"
  | "thumbnail";
export type CaptureTimingMilestone = "clipboardRepresentationReady" | "clipboardSettled";
export type CaptureTimingMeasurement =
  | Readonly<{
      kind: "duration";
      stage: CaptureTimingDurationStage;
      durationMs: Option<number>;
    }>
  | Readonly<{
      kind: "milestone";
      milestone: CaptureTimingMilestone;
      offsetFromShutterMs: Option<number>;
    }>;
export type CaptureDiagnostics = Readonly<{
  durations: Readonly<Partial<Record<CaptureTimingDurationStage, Option<number>>>>;
  milestones: Readonly<Partial<Record<CaptureTimingMilestone, Option<number>>>>;
}>;

export const emptyCaptureDiagnostics: CaptureDiagnostics = { durations: {}, milestones: {} };

export function browserClipboardDuration(diagnostics: CaptureDiagnostics): Option<number> {
  const ready = diagnostics.milestones.clipboardRepresentationReady;
  const settled = diagnostics.milestones.clipboardSettled;
  if (ready?.tag !== "some" || settled?.tag !== "some" || settled.value < ready.value) {
    return { tag: "none" };
  }
  return { tag: "some", value: settled.value - ready.value };
}

export type CaptureEntry = Readonly<{
  id: CaptureId;
  capturedAtEpochMs: number;
  camera: Option<CameraId>;
  widthPx: number;
  heightPx: number;
  blob: Blob;
  mimeType: ImageMimeType;
  preference: CapturePreference;
  route: CaptureRoute;
  thumbnail: Option<Blob>;
  byteLength: number;
}>;

export type CameraState =
  | Readonly<{ tag: "awaitingStart" }>
  | Readonly<{ tag: "requesting" }>
  | Readonly<{ tag: "streaming"; current: Option<CameraId> }>
  | Readonly<{ tag: "switching"; current: Option<CameraId>; target: CameraId }>
  | Readonly<{
      tag: "suspended";
      current: Option<CameraId>;
      reason: SuspensionReason;
    }>
  | Readonly<{ tag: "blocked"; error: CameraError }>;

export type CopyState =
  | Readonly<{ tag: "idle" }>
  | Readonly<{ tag: "copying"; captureId: CaptureId }>
  | Readonly<{ tag: "copied"; captureId: CaptureId }>
  | Readonly<{ tag: "failed"; captureId: CaptureId; error: ClipboardError }>;

export type AppModel = Readonly<{
  camera: CameraState;
  cameras: readonly CameraDescriptor[];
  previousCamera: Option<CameraId>;
  history: readonly CaptureEntry[];
  copy: CopyState;
  memoryWarningShown: boolean;
  videoSettings: Option<CameraVideoSettings>;
  photoCapability: PhotoCapabilityState;
  capturePreference: CapturePreference;
}>;

export const initialModel: AppModel = {
  camera: { tag: "awaitingStart" },
  cameras: [],
  previousCamera: { tag: "none" },
  history: [],
  copy: { tag: "idle" },
  memoryWarningShown: false,
  videoSettings: { tag: "none" },
  photoCapability: { tag: "checking" },
  capturePreference: "photoPreferred",
};
