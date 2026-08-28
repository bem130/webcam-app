import type { CaptureError, ClipboardError } from "../core/errors";
import type { CaptureId } from "../core/model";
import type { Result } from "../core/result";
import type { CapturedImage, CaptureOperation } from "../platform/capture";

export type CaptureLifecycleEvent =
  | Readonly<{ type: "captureSucceeded"; captureId: CaptureId; image: CapturedImage }>
  | Readonly<{ type: "captureFailed"; captureId: CaptureId; error: CaptureError }>
  | Readonly<{ type: "thumbnailSucceeded"; captureId: CaptureId; thumbnail: Blob }>
  | Readonly<{ type: "clipboardSucceeded"; captureId: CaptureId }>
  | Readonly<{ type: "clipboardFailed"; captureId: CaptureId; error: ClipboardError }>;

type CaptureState = "pending" | "succeeded" | "failed";

/**
 * Observes three independently settling effects from one shutter gesture.
 * Camera-source completion never waits for thumbnail or Clipboard work.
 */
export function observeCaptureOperation(
  captureId: CaptureId,
  operation: CaptureOperation,
  emit: (event: CaptureLifecycleEvent) => void,
): void {
  let captureState: CaptureState = "pending";
  let bufferedClipboard: Result<void, ClipboardError> | undefined;

  const emitClipboard = (result: Result<void, ClipboardError>) => {
    if (result.tag === "ok") emit({ type: "clipboardSucceeded", captureId });
    else emit({ type: "clipboardFailed", captureId, error: result.error });
  };

  void operation.captured.then((result) => {
    if (result.tag === "err") {
      captureState = "failed";
      bufferedClipboard = undefined;
      emit({ type: "captureFailed", captureId, error: result.error });
      return;
    }

    captureState = "succeeded";
    emit({ type: "captureSucceeded", captureId, image: result.value });
    if (bufferedClipboard !== undefined) {
      emitClipboard(bufferedClipboard);
      bufferedClipboard = undefined;
    }
  });

  void operation.thumbnail.then(async (result) => {
    if (result.tag === "err") return;
    const captured = await operation.captured;
    if (captured.tag === "ok") {
      emit({ type: "thumbnailSucceeded", captureId, thumbnail: result.value });
    }
  });

  void operation.clipboard.then((result) => {
    if (captureState === "failed") return;
    if (captureState === "pending") {
      bufferedClipboard = result;
      return;
    }
    emitClipboard(result);
  });
}
