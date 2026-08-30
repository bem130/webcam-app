import { describe, expect, it } from "vitest";
import { releaseCanvasBackingStore } from "../../src/platform/canvas-memory";

describe("canvas backing-store cleanup", () => {
  it("shrinks both dimensions without exposing cleanup failures", () => {
    const heightAssignments: number[] = [];
    const canvas = {
      get width() {
        return 8_160;
      },
      set width(_value: number) {
        throw new Error("width cleanup failed");
      },
      get height() {
        return 6_120;
      },
      set height(value: number) {
        heightAssignments.push(value);
      },
    };

    expect(() => releaseCanvasBackingStore(canvas)).not.toThrow();
    expect(heightAssignments).toEqual([1]);
  });

  it("accepts an absent canvas during partial allocation failure", () => {
    expect(() => releaseCanvasBackingStore(undefined)).not.toThrow();
  });
});
