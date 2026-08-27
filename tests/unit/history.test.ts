import { describe, expect, it } from "vitest";
import { addCapture, MEMORY_WARNING_BYTES, removeCapture, shouldWarnAboutMemory } from "../../src/core/history";
import { captureId, type CaptureEntry } from "../../src/core/model";
import { none } from "../../src/core/result";

function entry(id: string, pngBytes = 10, thumbnailBytes = 2): CaptureEntry {
  return {
    id: captureId(id),
    capturedAtEpochMs: 1,
    camera: none,
    widthPx: 100,
    heightPx: 50,
    png: { size: pngBytes } as Blob,
    thumbnail: { size: thumbnailBytes } as Blob,
    byteLength: pngBytes,
  };
}

describe("history", () => {
  it("adds newest first and removes only the selected capture", () => {
    const history = addCapture(addCapture([], entry("first")), entry("second"));
    expect(history.map((item) => item.id)).toEqual(["second", "first"]);
    expect(removeCapture(history, captureId("second")).map((item) => item.id)).toEqual(["first"]);
  });

  it("warns once only after crossing 128 MiB", () => {
    expect(shouldWarnAboutMemory([entry("below", MEMORY_WARNING_BYTES - 2, 2)], false)).toBe(false);
    expect(shouldWarnAboutMemory([entry("above", MEMORY_WARNING_BYTES, 1)], false)).toBe(true);
    expect(shouldWarnAboutMemory([entry("above", MEMORY_WARNING_BYTES, 1)], true)).toBe(false);
  });
});
