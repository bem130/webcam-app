import { describe, expect, it } from "vitest";
import { decodePreferences, DEFAULT_PREFERENCES } from "../../src/core/preferences";
import {
  browserPreferencesPort,
  PREFERENCES_STORAGE_KEY,
  type PreferencesStorage,
} from "../../src/platform/preferences";

describe("preferences core", () => {
  it.each(["10s", "30s", "1m", "3m", "5m", "10m", "off"] as const)(
    "accepts the closed idle timeout value %s",
    (idleTimeout) => {
      expect(
        decodePreferences({ version: 1, idleTimeout, capturePreference: "videoFrame" }),
      ).toEqual({ version: 1, idleTimeout, capturePreference: "videoFrame" });
    },
  );

  it.each([
    undefined,
    null,
    {},
    { version: 2, idleTimeout: "10s", capturePreference: "photoPreferred" },
    { version: 1, idleTimeout: "20s", capturePreference: "photoPreferred" },
    { version: 1, idleTimeout: "10s", capturePreference: "auto" },
    { version: 1, idleTimeout: "10s", capturePreference: "photoPreferred", image: "data" },
  ])("falls back to safe defaults for invalid or stale input", (value) => {
    expect(decodePreferences(value)).toEqual(DEFAULT_PREFERENCES);
  });
});

describe("browser preferences adapter", () => {
  it("round-trips only the typed versioned payload", () => {
    const values = new Map<string, string>();
    const storage: PreferencesStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    };
    const port = browserPreferencesPort(storage);
    const preferences = { version: 1, idleTimeout: "5m", capturePreference: "videoFrame" } as const;

    port.save(preferences);

    expect(values.get(PREFERENCES_STORAGE_KEY)).toBe(JSON.stringify(preferences));
    expect(port.load()).toEqual(preferences);
  });

  it("keeps storage errors outside the camera lifecycle", () => {
    const storage: PreferencesStorage = {
      getItem: () => {
        throw new DOMException("Denied", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("Full", "QuotaExceededError");
      },
    };
    const port = browserPreferencesPort(storage);

    expect(port.load()).toEqual(DEFAULT_PREFERENCES);
    expect(() => port.save(DEFAULT_PREFERENCES)).not.toThrow();
  });

  it.each([null, "not-json", JSON.stringify({ version: 9 })])(
    "uses defaults for missing, malformed, or future storage values",
    (serialized) => {
      const port = browserPreferencesPort({
        getItem: () => serialized,
        setItem: () => undefined,
      });

      expect(port.load()).toEqual(DEFAULT_PREFERENCES);
    },
  );
});
