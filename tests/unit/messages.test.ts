import { describe, expect, it } from "vitest";
import type { CameraError, CaptureError, ClipboardError } from "../../src/core/errors";
import {
  cameraErrorMessage,
  captureErrorMessage,
  clipboardErrorMessage,
} from "../../src/ui/messages.ja";

describe("Japanese error catalog", () => {
  it("maps every camera error without exposing diagnostic names", () => {
    const errors: CameraError[] = [
      { tag: "insecureContext" },
      { tag: "unsupported" },
      { tag: "permissionDenied" },
      { tag: "noCamera" },
      { tag: "cameraUnavailable" },
      { tag: "constraintsUnsatisfied" },
      { tag: "streamEnded" },
      { tag: "unknown", causeName: "SensitiveDriverName" },
    ];
    errors.forEach((error) => {
      expect(cameraErrorMessage(error)).not.toHaveLength(0);
      expect(cameraErrorMessage(error)).not.toContain("SensitiveDriverName");
    });
  });

  it("maps every capture and Clipboard error", () => {
    const captureErrors: CaptureError[] = [
      { tag: "frameNotReady" },
      { tag: "canvasUnavailable" },
      { tag: "pngEncodingFailed" },
      { tag: "memoryAllocationFailed" },
    ];
    const clipboardErrors: ClipboardError[] = [
      { tag: "unsupported" },
      { tag: "notAllowed" },
      { tag: "unsupportedMime", mime: "image/png" },
      { tag: "writeFailed", causeName: "SensitiveClipboardName" },
    ];
    captureErrors.forEach((error) => expect(captureErrorMessage(error)).not.toHaveLength(0));
    clipboardErrors.forEach((error) => {
      expect(clipboardErrorMessage(error)).not.toHaveLength(0);
      expect(clipboardErrorMessage(error)).not.toContain("SensitiveClipboardName");
    });
  });
});
