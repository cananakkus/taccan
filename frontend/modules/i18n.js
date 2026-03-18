import { state, STRINGS_BY_LANG, WORD_TRANSLATIONS_BY_LANG, SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY } from './state.js';
import { ui } from './ui.js';
import { socket } from './socket.js';
import { render } from './render.js';
import { setConnection } from './helpers.js';

export function t(key, vars = {}) {
  const current = STRINGS_BY_LANG[state.language] || STRINGS_BY_LANG[DEFAULT_LANGUAGE] || {};
  const fallback = STRINGS_BY_LANG[DEFAULT_LANGUAGE] || {};
  const raw = current[key] ?? fallback[key] ?? key;
  return interpolate(raw, vars);
}

export function interpolate(template, vars) {
  if (typeof template !== 'string') return String(template ?? '');
  return template.replace(/\{(\w+)\}/g, (_full, name) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) return String(vars[name]);
    return '';
  });
}

export function initLanguage() {
  setLanguage(readLanguage(), false);
}

export function setLanguage(nextLanguage, persist) {
  const normalized = normalizeLanguage(nextLanguage);
  state.language = normalized;
  document.documentElement.lang = normalized === 'tr' ? 'tr' : 'en';

  for (const button of ui.languageButtons) {
    button.classList.toggle('active', button.dataset.language === normalized);
  }

  applyLanguageToDocument(persist);
  setConnection(socket.connected, socket.connected ? t('connected') : t('disconnected'));
  if (state.snapshot) {
    render();
  }
}

export function normalizeLanguage(language) {
  return SUPPORTED_LANGUAGES.includes(language) ? language : DEFAULT_LANGUAGE;
}

export function getLocaleTag() {
  return state.language === 'tr' ? 'tr-TR' : 'en-US';
}

export function readLanguage() {
  try {
    const value = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return normalizeLanguage(value);
  } catch (_error) {
    return DEFAULT_LANGUAGE;
  }
}

export function applyLanguageToDocument(persist = true) {
  for (const element of document.querySelectorAll('[data-i18n]')) {
    const key = element.getAttribute('data-i18n');
    if (!key) continue;
    element.textContent = t(key);
  }

  for (const element of document.querySelectorAll('[data-i18n-placeholder]')) {
    const key = element.getAttribute('data-i18n-placeholder');
    if (!key) continue;
    element.setAttribute('placeholder', t(key));
  }

  if (ui.hintStatus && !state.snapshot) {
    ui.hintStatus.textContent = t('waiting_hint_phase');
  }

  if (!state.snapshot && ui.joinNote) {
    ui.joinNote.textContent = t('join_note_default');
  }

  if (ui.connectionDot) {
    ui.connectionDot.title = socket.connected ? t('connected') : t('disconnected');
  }

  if (persist) {
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, state.language);
    } catch (_error) {}
  }
}

export function translateWord(word) {
  const normalizedWord = String(word || '').trim().toLowerCase();
  if (!normalizedWord) return '';
  const dictionary = WORD_TRANSLATIONS_BY_LANG[state.language] || {};
  return dictionary[normalizedWord] || normalizedWord;
}

export function formatCardWord(word) {
  return translateWord(word).toLocaleUpperCase(getLocaleTag());
}
