import { describe, expect, it } from "vitest";
import { cameraId, captureId, initialModel, type CaptureEntry } from "../../src/core/model";
import { none } from "../../src/core/result";
import { update } from "../../src/core/update";

const capture: CaptureEntry = {
  id: captureId("capture"),
  capturedAtEpochMs: 1,
  camera: none,
  widthPx: 2,
  heightPx: 1,
  png: { size: 2 } as Blob,
  thumbnail: { size: 1 } as Blob,
  byteLength: 2,
};

describe("update", () => {
  it("moves through camera lifecycle states", () => {
    const requesting = update(initialModel, { type: "cameraRequestStarted" });
    expect(requesting.camera.tag).toBe("requesting");
    const streaming = update(requesting, { type: "cameraStarted", current: cameraId("rear"), cameras: [] });
    expect(streaming.camera.tag).toBe("streaming");
    const suspended = update(streaming, { type: "cameraSuspended" });
    expect(suspended.camera.tag).toBe("suspended");
    expect(update(suspended, { type: "cameraResumed" }).camera.tag).toBe("streaming");
    expect(update(streaming, { type: "cameraFailed", error: { tag: "streamEnded" } }).camera.tag).toBe("blocked");
  });

  it("keeps encoded capture when copying fails", () => {
    const withCapture = update(initialModel, { type: "captureAdded", entry: capture });
    const copying = update(withCapture, { type: "copyStarted", captureId: capture.id });
    const failed = update(copying, { type: "copyFailed", captureId: capture.id, error: { tag: "notAllowed" } });
    expect(failed.history).toEqual([capture]);
    expect(failed.copy.tag).toBe("failed");
  });

  it("supports individual removal and clear", () => {
    const withCapture = update(initialModel, { type: "captureAdded", entry: capture });
    expect(update(withCapture, { type: "captureRemoved", captureId: capture.id }).history).toEqual([]);
    expect(update(withCapture, { type: "historyCleared" }).history).toEqual([]);
  });
});
