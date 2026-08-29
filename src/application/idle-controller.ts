import {
  initialIdleModel,
  updateIdle,
  type IdleAction,
  type IdleEffect,
  type IdleModel,
  type IdleTimeout,
} from "../core/idle";
import type { Option } from "../core/result";
import { none, some } from "../core/result";
import { browserTimerPort, type TimerHandle, type TimerPort } from "../platform/timer";

export type IdleController = Readonly<{
  cameraStreaming: () => void;
  cameraStopped: () => void;
  activity: () => void;
  inhibit: () => void;
  release: () => void;
  setTimeout: (timeout: IdleTimeout) => void;
  snapshot: () => IdleModel;
  dispose: () => void;
}>;

export function createIdleController(
  options: Readonly<{
    timeout?: IdleTimeout;
    timer?: TimerPort;
    onSuspend: () => void;
  }>,
): IdleController {
  const timer = options.timer ?? browserTimerPort();
  let model = initialIdleModel(options.timeout);
  let timerHandle: Option<TimerHandle> = none;
  let disposed = false;

  const cancelTimer = () => {
    if (timerHandle.tag === "some") timer.cancel(timerHandle.value);
    timerHandle = none;
  };

  const runEffect = (effect: IdleEffect) => {
    switch (effect.type) {
      case "cancelTimer":
        cancelTimer();
        break;
      case "armTimer":
        cancelTimer();
        timerHandle = some(
          timer.schedule(effect.delayMs, () => {
            timerHandle = none;
            transition({ type: "timeoutElapsed", generation: effect.generation });
          }),
        );
        break;
      case "suspendCamera":
        options.onSuspend();
        break;
    }
  };

  const transition = (action: IdleAction) => {
    if (disposed) return;
    const result = updateIdle(model, action);
    model = result.model;
    result.effects.forEach(runEffect);
  };

  return {
    cameraStreaming: () => transition({ type: "cameraStreaming" }),
    cameraStopped: () => transition({ type: "cameraStopped" }),
    activity: () => transition({ type: "activity" }),
    inhibit: () => transition({ type: "inhibitionStarted" }),
    release: () => transition({ type: "inhibitionEnded" }),
    setTimeout: (timeout) => transition({ type: "timeoutChanged", timeout }),
    snapshot: () => model,
    dispose: () => {
      if (disposed) return;
      cancelTimer();
      disposed = true;
    },
  };
}
