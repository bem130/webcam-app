import { describe, expect, it, vi } from "vitest";
import { createIdleController } from "../../src/application/idle-controller";
import type { TimerHandle, TimerPort } from "../../src/platform/timer";

describe("idle controller", () => {
  it("suspends once at exactly 10 seconds, not at 9.999 seconds", () => {
    const timer = fakeTimer();
    const onSuspend = vi.fn();
    const controller = createIdleController({ timer, onSuspend });
    controller.cameraStreaming();

    timer.advance(9_999);
    expect(onSuspend).not.toHaveBeenCalled();
    timer.advance(1);
    expect(onSuspend).toHaveBeenCalledOnce();
    timer.advance(60_000);
    expect(onSuspend).toHaveBeenCalledOnce();
  });

  it("does not schedule automatic suspension when timeout is off", () => {
    const timer = fakeTimer();
    const onSuspend = vi.fn();
    const controller = createIdleController({ timeout: "off", timer, onSuspend });
    controller.cameraStreaming();

    expect(timer.pending()).toBe(0);
    timer.advance(600_000);
    expect(onSuspend).not.toHaveBeenCalled();
  });

  it("cancels and rearms the active timer when the timeout changes", () => {
    const timer = fakeTimer();
    const onSuspend = vi.fn();
    const controller = createIdleController({ timer, onSuspend });
    controller.cameraStreaming();

    controller.setTimeout("off");
    expect(timer.pending()).toBe(0);
    timer.advance(60_000);
    expect(onSuspend).not.toHaveBeenCalled();

    controller.setTimeout("30s");
    expect(timer.pending()).toBe(1);
    timer.advance(29_999);
    expect(onSuspend).not.toHaveBeenCalled();
    timer.advance(1);
    expect(onSuspend).toHaveBeenCalledOnce();
  });

  it("resets on activity and defers suspension across capture inhibition", () => {
    const timer = fakeTimer();
    const onSuspend = vi.fn();
    const controller = createIdleController({ timer, onSuspend });
    controller.cameraStreaming();
    timer.advance(9_999);
    controller.activity();
    timer.advance(9_999);
    expect(onSuspend).not.toHaveBeenCalled();

    controller.inhibit();
    timer.advance(60_000);
    expect(onSuspend).not.toHaveBeenCalled();
    controller.release();
    timer.advance(9_999);
    expect(onSuspend).not.toHaveBeenCalled();
    timer.advance(1);
    expect(onSuspend).toHaveBeenCalledOnce();
  });
});

type ScheduledTask = Readonly<{ at: number; callback: () => void }>;

function fakeTimer(): TimerPort &
  Readonly<{ advance: (durationMs: number) => void; pending: () => number }> {
  let now = 0;
  let nextHandle = 1;
  const tasks = new Map<TimerHandle, ScheduledTask>();
  return {
    schedule: (delayMs, callback) => {
      const handle = nextHandle++;
      tasks.set(handle, { at: now + delayMs, callback });
      return handle;
    },
    cancel: (handle) => tasks.delete(handle),
    advance: (durationMs) => {
      const target = now + durationMs;
      while (true) {
        const due = [...tasks.entries()]
          .filter(([, task]) => task.at <= target)
          .sort((left, right) => left[1].at - right[1].at)[0];
        if (due === undefined) break;
        const [handle, task] = due;
        tasks.delete(handle);
        now = task.at;
        task.callback();
      }
      now = target;
    },
    pending: () => tasks.size,
  };
}
