import '../../translations.js';

import type { TranslationPayload } from '../vite-env';

const payload: TranslationPayload = window.TACCAN_TRANSLATIONS || {};

export const SUPPORTED_LANGUAGES = Array.isArray(payload.supportedLanguages)
  ? payload.supportedLanguages
  : ['en'];

export const DEFAULT_LANGUAGE =
  SUPPORTED_LANGUAGES.find((code) => code === payload.defaultLanguage) || SUPPORTED_LANGUAGES[0] || 'en';

const STRINGS_BY_LANG = payload.strings || {};
const WORDS_BY_LANG = payload.words || {};

export function normalizeLanguage(language: string | null | undefined): string {
  return SUPPORTED_LANGUAGES.includes(language || '') ? String(language) : DEFAULT_LANGUAGE;
}

export function interpolate(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) {
      return String(vars[name]);
    }
    return '';
  });
}

export function translate(
  language: string,
  key: string,
  vars: Record<string, string | number> = {}
): string {
  const current = STRINGS_BY_LANG[language] || STRINGS_BY_LANG[DEFAULT_LANGUAGE] || {};
  const fallback = STRINGS_BY_LANG[DEFAULT_LANGUAGE] || {};
  return interpolate(current[key] ?? fallback[key] ?? key, vars);
}

export function translateWord(language: string, word: string): string {
  const normalized = String(word || '').trim().toLowerCase();
  if (!normalized) return '';
  const dictionary = WORDS_BY_LANG[language] || {};
  return dictionary[normalized] || normalized;
}

export function getLocaleTag(language: string): string {
  return language === 'tr' ? 'tr-TR' : 'en-US';
}

export function formatCardWord(language: string, word: string): string {
  return translateWord(language, word).toLocaleUpperCase(getLocaleTag(language));
}
