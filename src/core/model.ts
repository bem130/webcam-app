import type { CameraError, ClipboardError } from "./errors";
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
  frameRate: number | null;
}>;

export type CaptureEntry = Readonly<{
  id: CaptureId;
  capturedAtEpochMs: number;
  camera: Option<CameraId>;
  widthPx: number;
  heightPx: number;
  png: Blob;
  thumbnail: Blob;
  byteLength: number;
}>;

export type CameraState =
  | Readonly<{ tag: "awaitingStart" }>
  | Readonly<{ tag: "requesting" }>
  | Readonly<{ tag: "streaming"; current: Option<CameraId> }>
  | Readonly<{ tag: "switching"; current: Option<CameraId>; target: CameraId }>
  | Readonly<{ tag: "suspended"; current: Option<CameraId> }>
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
}>;

export const initialModel: AppModel = {
  camera: { tag: "awaitingStart" },
  cameras: [],
  previousCamera: { tag: "none" },
  history: [],
  copy: { tag: "idle" },
  memoryWarningShown: false,
  videoSettings: { tag: "none" },
};
