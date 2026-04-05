import { defineStore } from 'pinia';

import {
  COLORBLIND_KEY,
  LANGUAGE_STORAGE_KEY,
  NOISE_SUPPRESSION_KEY,
  SOUND_MUTE_KEY,
} from '../lib/storage';
import { DEFAULT_LANGUAGE, normalizeLanguage } from '../lib/translations';

function readBoolean(key: string, defaultValue: boolean, truthy = '1'): boolean {
  try {
    const value = localStorage.getItem(key);
    if (value === null) return defaultValue;
    return value === truthy || value === 'true';
  } catch (_error) {
    return defaultValue;
  }
}

export const usePreferencesStore = defineStore('preferences', {
  state: () => ({
    language: DEFAULT_LANGUAGE,
    soundMuted: false,
    colorblindMode: true,
    noiseSuppression: true,
  }),
  actions: {
    initialize() {
      try {
        this.language = normalizeLanguage(localStorage.getItem(LANGUAGE_STORAGE_KEY));
      } catch (_error) {
        this.language = DEFAULT_LANGUAGE;
      }
      this.soundMuted = readBoolean(SOUND_MUTE_KEY, false);
      this.colorblindMode = readBoolean(COLORBLIND_KEY, true);
      this.noiseSuppression = readBoolean(NOISE_SUPPRESSION_KEY, true, 'true');
    },
    setLanguage(language: string) {
      this.language = normalizeLanguage(language);
      try {
        localStorage.setItem(LANGUAGE_STORAGE_KEY, this.language);
      } catch (_error) {}
    },
    setSoundMuted(value: boolean) {
      this.soundMuted = value;
      try {
        localStorage.setItem(SOUND_MUTE_KEY, value ? '1' : '0');
      } catch (_error) {}
    },
    setColorblindMode(value: boolean) {
      this.colorblindMode = value;
      try {
        localStorage.setItem(COLORBLIND_KEY, value ? '1' : '0');
      } catch (_error) {}
    },
    setNoiseSuppression(value: boolean) {
      this.noiseSuppression = value;
      try {
        localStorage.setItem(NOISE_SUPPRESSION_KEY, value ? 'true' : 'false');
      } catch (_error) {}
    },
  },
});
