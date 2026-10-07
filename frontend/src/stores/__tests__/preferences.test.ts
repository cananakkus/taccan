import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { usePreferencesStore } from '../preferences';
import { LANGUAGE_STORAGE_KEY } from '../../lib/storage';

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([['tr-TR', 'tr'], ['TR', 'tr'], ['en-US', 'en'], ['de-DE', 'en']])('uses %s browser language to choose %s', (locale, language) => {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue([locale]);
  const preferences = usePreferencesStore();
  preferences.initialize();
  expect(preferences.language).toBe(language);
});

it('keeps a saved choice instead of the browser default', () => {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['tr-TR']);
  localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
  const preferences = usePreferencesStore();
  preferences.initialize();
  expect(preferences.language).toBe('en');
});

it('detects Turkish even when browser storage is unavailable', () => {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['tr-TR']);
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage blocked'); });
  const preferences = usePreferencesStore();
  preferences.initialize();
  expect(preferences.language).toBe('tr');
});
