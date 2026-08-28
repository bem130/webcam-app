import { describe, expect, it } from "vitest";
import { browserClipboardDuration, type CaptureDiagnostics } from "../../src/core/model";
import { none, some } from "../../src/core/result";

describe("capture diagnostics", () => {
  it("derives browser Clipboard time only from ordered shutter-relative marks", () => {
    const diagnostics: CaptureDiagnostics = {
      durations: {},
      milestones: {
        clipboardRepresentationReady: some(900),
        clipboardSettled: some(2_200),
      },
    };
    expect(browserClipboardDuration(diagnostics)).toEqual(some(1_300));
  });

  it("does not invent a duration for early rejection or missing representation", () => {
    expect(
      browserClipboardDuration({
        durations: {},
        milestones: {
          clipboardRepresentationReady: some(900),
          clipboardSettled: some(100),
        },
      }),
    ).toEqual(none);
    expect(
      browserClipboardDuration({
        durations: {},
        milestones: { clipboardSettled: some(100) },
      }),
    ).toEqual(none);
  });
});
