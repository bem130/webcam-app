export type CameraError =
  | Readonly<{ tag: "insecureContext" }>
  | Readonly<{ tag: "unsupported" }>
  | Readonly<{ tag: "permissionDenied" }>
  | Readonly<{ tag: "noCamera" }>
  | Readonly<{ tag: "cameraUnavailable" }>
  | Readonly<{ tag: "constraintsUnsatisfied" }>
  | Readonly<{ tag: "streamEnded" }>
  | Readonly<{ tag: "unknown"; causeName: string }>;

export type CaptureError =
  | Readonly<{ tag: "frameNotReady" }>
  | Readonly<{ tag: "canvasUnavailable" }>
  | Readonly<{ tag: "pngEncodingFailed" }>
  | Readonly<{ tag: "memoryAllocationFailed" }>;

export type ClipboardError =
  | Readonly<{ tag: "unsupported" }>
  | Readonly<{ tag: "notAllowed" }>
  | Readonly<{ tag: "unsupportedMime"; mime: "image/png" }>
  | Readonly<{ tag: "writeFailed"; causeName: string }>;

export function causeName(cause: unknown): string {
  if (cause instanceof DOMException || cause instanceof Error) return cause.name;
  return "UnknownError";
}
