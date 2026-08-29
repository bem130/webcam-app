import { describe, expect, it, vi } from "vitest";
import { bindUserActivity } from "../../src/platform/activity";

describe("user activity binding", () => {
  it("observes discrete activity but ignores pointer movement", () => {
    const target = new EventTarget();
    const activity = vi.fn();
    const unbind = bindUserActivity(activity, target);

    target.dispatchEvent(new Event("pointermove"));
    expect(activity).not.toHaveBeenCalled();
    target.dispatchEvent(new Event("pointerdown"));
    target.dispatchEvent(new Event("keydown"));
    target.dispatchEvent(new Event("wheel"));
    expect(activity).toHaveBeenCalledTimes(3);

    unbind();
    target.dispatchEvent(new Event("pointerdown"));
    expect(activity).toHaveBeenCalledTimes(3);
  });
});
