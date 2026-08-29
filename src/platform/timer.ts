export type TimerHandle = number;

export type TimerPort = Readonly<{
  schedule: (delayMs: number, callback: () => void) => TimerHandle;
  cancel: (handle: TimerHandle) => void;
}>;

export function browserTimerPort(): TimerPort {
  return {
    schedule: (delayMs, callback) => window.setTimeout(callback, delayMs),
    cancel: (handle) => window.clearTimeout(handle),
  };
}
