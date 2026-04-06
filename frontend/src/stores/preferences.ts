import { defineStore } from 'pinia';

import {
  COLORBLIND_KEY,
  LANGUAGE_STORAGE_KEY,
  NOISE_SUPPRESSION_KEY,
  SOUND_MUTE_KEY,
  THEME_KEY,
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
    theme: 'auto' as 'auto' | 'light' | 'dark',
    resolvedTheme: 'dark' as 'light' | 'dark',
  }),
  actions: {
    initialize() {
      try {
        const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
        if (stored) {
          this.language = normalizeLanguage(stored);
        } else {
          const browserLang = navigator.language?.split('-')[0] || '';
          this.language = normalizeLanguage(browserLang);
        }
      } catch (_error) {
        this.language = DEFAULT_LANGUAGE;
      }
      this.soundMuted = readBoolean(SOUND_MUTE_KEY, false);
      this.colorblindMode = readBoolean(COLORBLIND_KEY, true);
      this.noiseSuppression = readBoolean(NOISE_SUPPRESSION_KEY, true, 'true');

      try {
        const storedTheme = localStorage.getItem(THEME_KEY);
        if (storedTheme === 'light' || storedTheme === 'dark') {
          this.theme = storedTheme;
        }
      } catch (_error) {}
      this.applyTheme();

      const mq = window.matchMedia('(prefers-color-scheme: light)');
      mq.addEventListener('change', () => {
        if (this.theme === 'auto') this.applyTheme();
      });
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
    toggleTheme() {
      this.setTheme(this.resolvedTheme === 'dark' ? 'light' : 'dark');
    },
    setTheme(value: 'auto' | 'light' | 'dark') {
      this.theme = value;
      try {
        localStorage.setItem(THEME_KEY, value);
      } catch (_error) {}
      document.documentElement.classList.add('theme-transitioning');
      this.applyTheme();
      setTimeout(() => {
        document.documentElement.classList.remove('theme-transitioning');
      }, 450);
    },
    applyTheme() {
      const resolved: 'light' | 'dark' =
        this.theme === 'auto'
          ? window.matchMedia('(prefers-color-scheme: light)').matches
            ? 'light'
            : 'dark'
          : this.theme;
      this.resolvedTheme = resolved;
      document.documentElement.setAttribute('data-theme', resolved);
      document.documentElement.style.colorScheme = resolved;
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) {
        meta.setAttribute('content', resolved === 'dark' ? '#1a140e' : '#e8e0d4');
      }
    },
  },
});
