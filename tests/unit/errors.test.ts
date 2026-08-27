import { describe, expect, it } from "vitest";
import { mapCameraError } from "../../src/platform/camera";
import { mapClipboardError } from "../../src/platform/clipboard";

describe("platform error mapping", () => {
  it.each([
    ["NotAllowedError", "permissionDenied"],
    ["NotFoundError", "noCamera"],
    ["NotReadableError", "cameraUnavailable"],
    ["OverconstrainedError", "constraintsUnsatisfied"],
    ["FutureBrowserError", "unknown"],
  ])("maps camera %s to %s", (name, tag) => {
    expect(mapCameraError(new DOMException("", name)).tag).toBe(tag);
  });

  it.each([
    ["NotAllowedError", "notAllowed"],
    ["NotSupportedError", "unsupportedMime"],
    ["FutureBrowserError", "writeFailed"],
  ])("maps clipboard %s to %s", (name, tag) => {
    expect(mapClipboardError(new DOMException("", name)).tag).toBe(tag);
  });
});
