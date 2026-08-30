import { decodePreferences, DEFAULT_PREFERENCES, type Preferences } from "../core/preferences";

export const PREFERENCES_STORAGE_KEY = "camera-clipboard.preferences";

export type PreferencesStorage = Readonly<{
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}>;

export type PreferencesPort = Readonly<{
  load: () => Preferences;
  save: (preferences: Preferences) => void;
}>;

export function browserPreferencesPort(storage?: PreferencesStorage): PreferencesPort {
  const getStorage = () => storage ?? window.localStorage;
  return {
    load: () => {
      try {
        const serialized = getStorage().getItem(PREFERENCES_STORAGE_KEY);
        return serialized === null
          ? DEFAULT_PREFERENCES
          : decodePreferences(JSON.parse(serialized));
      } catch {
        return DEFAULT_PREFERENCES;
      }
    },
    save: (preferences) => {
      try {
        getStorage().setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
      } catch {
        // Preferences are optional; storage denial must not block camera use.
      }
    },
  };
}
