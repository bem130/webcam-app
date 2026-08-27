import { describe, expect, it } from "vitest";
import { calculateTargetDimensions } from "../../src/platform/capture";

describe("calculateTargetDimensions", () => {
  it("does not upscale a small frame", () => {
    expect(calculateTargetDimensions(1280, 720)).toEqual({ width: 1280, height: 720 });
  });

  it("limits landscape and portrait frames to a 1920px long edge", () => {
    expect(calculateTargetDimensions(3840, 2160)).toEqual({ width: 1920, height: 1080 });
    expect(calculateTargetDimensions(2160, 3840)).toEqual({ width: 1080, height: 1920 });
  });

  it("rejects non-positive source dimensions", () => {
    expect(calculateTargetDimensions(0, 1080)).toEqual({ width: 0, height: 0 });
  });
});
