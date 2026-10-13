import '../../translations.js';
import wordsTr from '../../../backend/words-tr.json';
import cluesTr from '../../../backend/clues-tr.json';

import type { TranslationPayload } from '../types';

const payload: TranslationPayload = window.TACCAN_TRANSLATIONS || {};

export const SUPPORTED_LANGUAGES = Array.isArray(payload.supportedLanguages)
  ? payload.supportedLanguages
  : ['en'];

export const DEFAULT_LANGUAGE =
  SUPPORTED_LANGUAGES.find((code) => code === payload.defaultLanguage) || SUPPORTED_LANGUAGES[0] || 'en';

const STRINGS_BY_LANG = payload.strings || {};
const WORDS_BY_LANG: Record<string, Record<string, string>> = { ...(payload.words || {}), tr: wordsTr };
const CLUES_BY_LANG: Record<string, Record<string, string>> = { tr: cluesTr };

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

// A clue as this player reads it. Bot clues come from a bilingual table (the
// server sends the English key); a person's clue is shown as typed.
export function formatClue(language: string, hint: { word: string; bot?: boolean }): string {
  let word = hint.word;
  if (hint.bot && language !== 'en') {
    const key = word.toLowerCase();
    word = CLUES_BY_LANG[language]?.[key] || WORDS_BY_LANG[language]?.[key] || word;
  }
  return word.toLocaleUpperCase(getLocaleTag(language));
}
