import { describe, expect, it } from "vitest";
import {
  chooseQuickSwapTarget,
  reconcileCurrentCamera,
  shouldMirrorPreview,
} from "../../src/core/camera-selection";
import { cameraId, type CameraDescriptor } from "../../src/core/model";
import { none, some } from "../../src/core/result";

const cameras: readonly CameraDescriptor[] = [
  { id: cameraId("front"), label: "Front", facing: "user" },
  { id: cameraId("rear"), label: "Rear", facing: "environment" },
  { id: cameraId("usb"), label: "USB", facing: "unknown" },
];

describe("camera selection", () => {
  it("has no quick swap target with one camera", () => {
    expect(chooseQuickSwapTarget(cameras.slice(0, 1), some(cameraId("front")), none)).toEqual(none);
  });

  it("uses the next camera for the first quick swap", () => {
    expect(chooseQuickSwapTarget(cameras, some(cameraId("front")), none)).toEqual(
      some(cameraId("rear")),
    );
  });

  it("swaps between either camera in a two-camera list", () => {
    const pair = cameras.slice(0, 2);
    expect(chooseQuickSwapTarget(pair, some(cameraId("rear")), none)).toEqual(
      some(cameraId("front")),
    );
  });

  it("returns to the previous camera when it is still connected", () => {
    expect(chooseQuickSwapTarget(cameras, some(cameraId("usb")), some(cameraId("front")))).toEqual(
      some(cameraId("front")),
    );
  });

  it("selects the first remaining device when current disappears", () => {
    expect(reconcileCurrentCamera(cameras.slice(1), some(cameraId("front")))).toEqual(
      some(cameraId("rear")),
    );
  });

  it("mirrors only the front-facing live preview", () => {
    expect(shouldMirrorPreview("user")).toBe(true);
    expect(shouldMirrorPreview("environment")).toBe(false);
    expect(shouldMirrorPreview("unknown")).toBe(false);
  });
});
