import type { Option } from "./result";
import { none, some } from "./result";

export const IDLE_TIMEOUT_OPTIONS = ["10s", "30s", "1m", "3m", "5m", "10m", "off"] as const;
export type IdleTimeout = (typeof IDLE_TIMEOUT_OPTIONS)[number];
export type SuspensionReason = "idle" | "background";

export type IdleState =
  | Readonly<{ tag: "stopped" }>
  | Readonly<{ tag: "timerDisabled" }>
  | Readonly<{ tag: "armed"; generation: number }>
  | Readonly<{ tag: "inhibited"; depth: number }>;

export type IdleModel = Readonly<{
  timeout: IdleTimeout;
  state: IdleState;
  nextGeneration: number;
}>;

export type IdleAction =
  | Readonly<{ type: "cameraStreaming" }>
  | Readonly<{ type: "cameraStopped" }>
  | Readonly<{ type: "activity" }>
  | Readonly<{ type: "inhibitionStarted" }>
  | Readonly<{ type: "inhibitionEnded" }>
  | Readonly<{ type: "timeoutElapsed"; generation: number }>
  | Readonly<{ type: "timeoutChanged"; timeout: IdleTimeout }>;

export type IdleEffect =
  | Readonly<{ type: "cancelTimer" }>
  | Readonly<{ type: "armTimer"; generation: number; delayMs: number }>
  | Readonly<{ type: "suspendCamera" }>;

export type IdleTransition = Readonly<{
  model: IdleModel;
  effects: readonly IdleEffect[];
}>;

export function initialIdleModel(timeout: IdleTimeout = "10s"): IdleModel {
  return { timeout, state: { tag: "stopped" }, nextGeneration: 1 };
}

export function updateIdle(model: IdleModel, action: IdleAction): IdleTransition {
  switch (action.type) {
    case "cameraStreaming":
      return armFrom(model, model.state.tag === "armed");
    case "cameraStopped":
      return {
        model: { ...model, state: { tag: "stopped" } },
        effects: model.state.tag === "armed" ? [{ type: "cancelTimer" }] : [],
      };
    case "activity":
      return model.state.tag === "armed" ? armFrom(model, true) : unchanged(model);
    case "inhibitionStarted":
      if (model.state.tag === "stopped") return unchanged(model);
      if (model.state.tag === "inhibited") {
        return {
          model: { ...model, state: { tag: "inhibited", depth: model.state.depth + 1 } },
          effects: [],
        };
      }
      return {
        model: { ...model, state: { tag: "inhibited", depth: 1 } },
        effects: model.state.tag === "armed" ? [{ type: "cancelTimer" }] : [],
      };
    case "inhibitionEnded":
      if (model.state.tag !== "inhibited") return unchanged(model);
      if (model.state.depth > 1) {
        return {
          model: { ...model, state: { tag: "inhibited", depth: model.state.depth - 1 } },
          effects: [],
        };
      }
      return armFrom(model, false);
    case "timeoutElapsed":
      if (model.state.tag !== "armed" || model.state.generation !== action.generation) {
        return unchanged(model);
      }
      return {
        model: { ...model, state: { tag: "stopped" } },
        effects: [{ type: "suspendCamera" }],
      };
    case "timeoutChanged": {
      const changed = { ...model, timeout: action.timeout };
      if (model.state.tag === "stopped") return { model: changed, effects: [] };
      if (model.state.tag === "inhibited") return { model: changed, effects: [] };
      return armFrom(changed, model.state.tag === "armed");
    }
  }
}

export function idleTimeoutMs(timeout: IdleTimeout): Option<number> {
  switch (timeout) {
    case "10s":
      return some(10_000);
    case "30s":
      return some(30_000);
    case "1m":
      return some(60_000);
    case "3m":
      return some(180_000);
    case "5m":
      return some(300_000);
    case "10m":
      return some(600_000);
    case "off":
      return none;
  }
}

function armFrom(model: IdleModel, cancelExisting: boolean): IdleTransition {
  const delay = idleTimeoutMs(model.timeout);
  if (delay.tag === "none") {
    return {
      model: { ...model, state: { tag: "timerDisabled" } },
      effects: cancelExisting ? [{ type: "cancelTimer" }] : [],
    };
  }
  const generation = model.nextGeneration;
  return {
    model: {
      ...model,
      state: { tag: "armed", generation },
      nextGeneration: generation + 1,
    },
    effects: [
      ...(cancelExisting ? ([{ type: "cancelTimer" }] as const) : []),
      { type: "armTimer", generation, delayMs: delay.value },
    ],
  };
}

function unchanged(model: IdleModel): IdleTransition {
  return { model, effects: [] };
}
