import { describe, expect, it } from "vitest";
import { cameraId, captureId, initialModel, type CaptureEntry } from "../../src/core/model";
import { none, some } from "../../src/core/result";
import { update } from "../../src/core/update";

const capture: CaptureEntry = {
  id: captureId("capture"),
  capturedAtEpochMs: 1,
  camera: none,
  widthPx: 2,
  heightPx: 1,
  blob: { size: 2 } as Blob,
  mimeType: "image/jpeg",
  preference: "photoPreferred",
  route: "photo",
  thumbnail: some({ size: 1 } as Blob),
  byteLength: 2,
};

describe("update", () => {
  it("moves through camera lifecycle states", () => {
    const requesting = update(initialModel, { type: "cameraRequestStarted" });
    expect(requesting.camera.tag).toBe("requesting");
    const streaming = update(requesting, {
      type: "cameraStarted",
      current: some(cameraId("rear")),
      cameras: [],
      videoSettings: some({ widthPx: 3840, heightPx: 2160, frameRate: some(30) }),
    });
    expect(streaming.camera.tag).toBe("streaming");
    const suspended = update(streaming, { type: "cameraSuspended" });
    expect(suspended.camera.tag).toBe("suspended");
    expect(update(suspended, { type: "cameraResumed" }).camera.tag).toBe("streaming");
    expect(
      update(streaming, { type: "cameraFailed", error: { tag: "streamEnded" } }).camera.tag,
    ).toBe("blocked");
  });

  it("records switch target, previous camera, and refreshed devices", () => {
    const front = cameraId("front");
    const rear = cameraId("rear");
    const devices = [{ id: rear, label: "Rear", facing: "environment" as const }];
    const streaming = update(initialModel, {
      type: "cameraStarted",
      current: some(front),
      cameras: [],
      videoSettings: none,
    });
    const switching = update(streaming, { type: "cameraSwitchStarted", target: rear });
    expect(switching.camera).toMatchObject({ tag: "switching", target: rear });
    const switched = update(switching, {
      type: "cameraSwitched",
      previous: some(front),
      current: rear,
      cameras: devices,
      videoSettings: some({ widthPx: 1920, heightPx: 1080, frameRate: some(29.97) }),
    });
    expect(switched.camera).toEqual({ tag: "streaming", current: { tag: "some", value: rear } });
    expect(switched.previousCamera).toEqual({ tag: "some", value: front });
    expect(switched.videoSettings).toEqual(
      some({ widthPx: 1920, heightPx: 1080, frameRate: some(29.97) }),
    );
    expect(update(switched, { type: "devicesUpdated", cameras: [] }).cameras).toEqual([]);
  });

  it("keeps encoded capture when copying fails", () => {
    const withCapture = update(initialModel, { type: "captureAdded", entry: capture });
    const copying = update(withCapture, { type: "copyStarted", captureId: capture.id });
    const failed = update(copying, {
      type: "copyFailed",
      captureId: capture.id,
      error: { tag: "notAllowed" },
    });
    expect(failed.history).toEqual([capture]);
    expect(failed.copy.tag).toBe("failed");
  });

  it("adds a thumbnail after the original image artifact enters history", () => {
    const withoutThumbnail: CaptureEntry = { ...capture, thumbnail: none };
    const withCapture = update(initialModel, { type: "captureAdded", entry: withoutThumbnail });
    const thumbnail = new Blob(["thumbnail"]);
    const updated = update(withCapture, {
      type: "captureThumbnailAdded",
      captureId: capture.id,
      thumbnail,
    });

    expect(updated.history[0]?.thumbnail).toEqual(some(thumbnail));
  });

  it("supports individual removal and clear", () => {
    const withCapture = update(initialModel, { type: "captureAdded", entry: capture });
    expect(update(withCapture, { type: "captureRemoved", captureId: capture.id }).history).toEqual(
      [],
    );
    expect(update(withCapture, { type: "historyCleared" }).history).toEqual([]);
  });

  it("moves through copy success and dismissal", () => {
    const copying = update(initialModel, { type: "copyStarted", captureId: capture.id });
    const copied = update(copying, { type: "copySucceeded", captureId: capture.id });
    expect(copied.copy).toEqual({ tag: "copied", captureId: capture.id });
    expect(update(copied, { type: "copyDismissed" }).copy).toEqual({ tag: "idle" });
  });

  it("keeps capture preference independent from native-photo availability", () => {
    const preferred = update(initialModel, {
      type: "capturePreferenceChanged",
      preference: "photoPreferred",
    });
    const unsupported = update(preferred, {
      type: "photoCapabilityUpdated",
      capability: { tag: "unsupported" },
    });
    expect(unsupported.capturePreference).toBe("photoPreferred");
    expect(unsupported.photoCapability).toEqual({ tag: "unsupported" });

    const supported = update(unsupported, {
      type: "photoCapabilityUpdated",
      capability: { tag: "supported", settings: { widthPx: 8160, heightPx: 6120 } },
    });
    expect(supported.capturePreference).toBe("photoPreferred");
    expect(supported.photoCapability).toEqual({
      tag: "supported",
      settings: { widthPx: 8160, heightPx: 6120 },
    });
  });
});
