import { describe, expect, it } from "vitest";
import { APP_OVERLAY_ORDER } from "../../src/ui/app-overlay-plane";

describe("app overlay plane", () => {
  it("expresses normal-document overlay priority as render order", () => {
    expect(APP_OVERLAY_ORDER).toEqual(["feedback", "memoryWarning"]);
  });
});
