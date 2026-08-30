import { IDLE_TIMEOUT_OPTIONS, type IdleTimeout } from "./idle";
import type { CapturePreference } from "./model";

export type Preferences = Readonly<{
  version: 1;
  idleTimeout: IdleTimeout;
  capturePreference: CapturePreference;
}>;

export const DEFAULT_PREFERENCES: Preferences = {
  version: 1,
  idleTimeout: "10s",
  capturePreference: "photoPreferred",
};

const PREFERENCE_KEYS = ["capturePreference", "idleTimeout", "version"] as const;

export function decodePreferences(value: unknown): Preferences {
  if (Object.prototype.toString.call(value) !== "[object Object]") return DEFAULT_PREFERENCES;
  const record = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== PREFERENCE_KEYS.length ||
    keys.some((key, index) => key !== PREFERENCE_KEYS[index])
  ) {
    return DEFAULT_PREFERENCES;
  }
  if (
    record.version !== 1 ||
    !isIdleTimeout(record.idleTimeout) ||
    !isCapturePreference(record.capturePreference)
  ) {
    return DEFAULT_PREFERENCES;
  }
  return {
    version: 1,
    idleTimeout: record.idleTimeout,
    capturePreference: record.capturePreference,
  };
}

function isIdleTimeout(value: unknown): value is IdleTimeout {
  return typeof value === "string" && IDLE_TIMEOUT_OPTIONS.some((candidate) => candidate === value);
}

function isCapturePreference(value: unknown): value is CapturePreference {
  return value === "photoPreferred" || value === "videoFrame";
}
