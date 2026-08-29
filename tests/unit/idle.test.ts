import { describe, expect, it } from "vitest";
import { idleTimeoutMs, initialIdleModel, updateIdle } from "../../src/core/idle";
import { none, some } from "../../src/core/result";

describe("idle core", () => {
  it("maps only the closed timeout set to durations", () => {
    expect(idleTimeoutMs("10s")).toEqual(some(10_000));
    expect(idleTimeoutMs("30s")).toEqual(some(30_000));
    expect(idleTimeoutMs("1m")).toEqual(some(60_000));
    expect(idleTimeoutMs("3m")).toEqual(some(180_000));
    expect(idleTimeoutMs("5m")).toEqual(some(300_000));
    expect(idleTimeoutMs("10m")).toEqual(some(600_000));
    expect(idleTimeoutMs("off")).toEqual(none);
  });

  it("represents stopped and timer-disabled cameras as distinct states", () => {
    const stopped = initialIdleModel("off");
    expect(stopped.state).toEqual({ tag: "stopped" });

    const streaming = updateIdle(stopped, { type: "cameraStreaming" });
    expect(streaming.model.state).toEqual({ tag: "timerDisabled" });
    expect(streaming.effects).toEqual([]);

    expect(updateIdle(streaming.model, { type: "cameraStopped" }).model.state).toEqual({
      tag: "stopped",
    });
  });

  it("rejects a stale timeout generation after activity rearms the timer", () => {
    const armed = updateIdle(initialIdleModel(), { type: "cameraStreaming" }).model;
    expect(armed.state.tag).toBe("armed");
    if (armed.state.tag !== "armed") throw new Error("expected armed idle state");
    const staleGeneration = armed.state.generation;
    const reset = updateIdle(armed, { type: "activity" }).model;
    const stale = updateIdle(reset, {
      type: "timeoutElapsed",
      generation: staleGeneration,
    });

    expect(stale.model).toBe(reset);
    expect(stale.effects).toEqual([]);
  });

  it("defers timeout while inhibited and rearms after the final release", () => {
    const armed = updateIdle(initialIdleModel(), { type: "cameraStreaming" }).model;
    const inhibited = updateIdle(armed, { type: "inhibitionStarted" });
    expect(inhibited.model.state).toEqual({ tag: "inhibited", depth: 1 });
    expect(inhibited.effects).toEqual([{ type: "cancelTimer" }]);

    const nested = updateIdle(inhibited.model, { type: "inhibitionStarted" }).model;
    expect(nested.state).toEqual({ tag: "inhibited", depth: 2 });
    expect(updateIdle(nested, { type: "inhibitionEnded" }).model.state).toEqual({
      tag: "inhibited",
      depth: 1,
    });

    const released = updateIdle(updateIdle(nested, { type: "inhibitionEnded" }).model, {
      type: "inhibitionEnded",
    });
    expect(released.model.state.tag).toBe("armed");
    expect(released.effects).toMatchObject([{ type: "armTimer", delayMs: 10_000 }]);
  });

  it("does not rearm after the camera stops during an inhibited operation", () => {
    const armed = updateIdle(initialIdleModel(), { type: "cameraStreaming" }).model;
    const inhibited = updateIdle(armed, { type: "inhibitionStarted" }).model;
    const stopped = updateIdle(inhibited, { type: "cameraStopped" });

    expect(stopped.model.state).toEqual({ tag: "stopped" });
    expect(stopped.effects).toEqual([]);
    expect(updateIdle(stopped.model, { type: "inhibitionEnded" })).toEqual({
      model: stopped.model,
      effects: [],
    });
  });
});
