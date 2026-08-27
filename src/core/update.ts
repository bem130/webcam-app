import type { CameraError, ClipboardError } from "./errors";
import { addCapture, removeCapture, shouldWarnAboutMemory } from "./history";
import type { AppModel, CameraDescriptor, CameraId, CaptureEntry, CaptureId } from "./model";
import { none, some } from "./result";

export type AppAction =
  | Readonly<{ type: "cameraRequestStarted" }>
  | Readonly<{
      type: "cameraStarted";
      current: CameraId | null;
      cameras: readonly CameraDescriptor[];
    }>
  | Readonly<{ type: "cameraFailed"; error: CameraError }>
  | Readonly<{ type: "cameraSwitchStarted"; target: CameraId }>
  | Readonly<{
      type: "cameraSwitched";
      previous: CameraId | null;
      current: CameraId;
      cameras: readonly CameraDescriptor[];
    }>
  | Readonly<{ type: "cameraSuspended" }>
  | Readonly<{ type: "cameraResumed" }>
  | Readonly<{ type: "devicesUpdated"; cameras: readonly CameraDescriptor[] }>
  | Readonly<{ type: "captureAdded"; entry: CaptureEntry }>
  | Readonly<{ type: "copyStarted"; captureId: CaptureId }>
  | Readonly<{ type: "copySucceeded"; captureId: CaptureId }>
  | Readonly<{ type: "copyFailed"; captureId: CaptureId; error: ClipboardError }>
  | Readonly<{ type: "copyDismissed" }>
  | Readonly<{ type: "captureRemoved"; captureId: CaptureId }>
  | Readonly<{ type: "historyCleared" }>
  | Readonly<{ type: "memoryWarningAcknowledged" }>;

export function update(model: AppModel, action: AppAction): AppModel {
  switch (action.type) {
    case "cameraRequestStarted":
      return { ...model, camera: { tag: "requesting" } };
    case "cameraStarted":
      return {
        ...model,
        camera: {
          tag: "streaming",
          current: action.current === null ? none : some(action.current),
        },
        cameras: action.cameras,
      };
    case "cameraFailed":
      return { ...model, camera: { tag: "blocked", error: action.error } };
    case "cameraSwitchStarted": {
      const current = model.camera.tag === "streaming" ? model.camera.current : none;
      return { ...model, camera: { tag: "switching", current, target: action.target } };
    }
    case "cameraSwitched":
      return {
        ...model,
        camera: { tag: "streaming", current: some(action.current) },
        previousCamera: action.previous === null ? none : some(action.previous),
        cameras: action.cameras,
      };
    case "cameraSuspended":
      return model.camera.tag === "streaming"
        ? { ...model, camera: { tag: "suspended", current: model.camera.current } }
        : model;
    case "cameraResumed":
      return model.camera.tag === "suspended"
        ? { ...model, camera: { tag: "streaming", current: model.camera.current } }
        : model;
    case "devicesUpdated":
      return { ...model, cameras: action.cameras };
    case "captureAdded": {
      const history = addCapture(model.history, action.entry);
      return {
        ...model,
        history,
        memoryWarningShown:
          model.memoryWarningShown || shouldWarnAboutMemory(history, model.memoryWarningShown),
      };
    }
    case "copyStarted":
      return { ...model, copy: { tag: "copying", captureId: action.captureId } };
    case "copySucceeded":
      return { ...model, copy: { tag: "copied", captureId: action.captureId } };
    case "copyFailed":
      return {
        ...model,
        copy: { tag: "failed", captureId: action.captureId, error: action.error },
      };
    case "copyDismissed":
      return { ...model, copy: { tag: "idle" } };
    case "captureRemoved":
      return { ...model, history: removeCapture(model.history, action.captureId) };
    case "historyCleared":
      return { ...model, history: [] };
    case "memoryWarningAcknowledged":
      return { ...model, memoryWarningShown: true };
  }
}
