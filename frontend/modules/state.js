// --- Constants ---
export const STORAGE_KEY = 'taccan.session.v1';
export const LANGUAGE_STORAGE_KEY = 'taccan.language.v1';
export const STATS_STORAGE_KEY = 'taccan.stats.v1';
export const SCRATCHPAD_STORAGE_KEY = 'taccan.scratchpad.v1';
export const SOUND_MUTE_KEY = 'taccan.sound.mute.v1';
export const COLORBLIND_KEY = 'taccan.colorblind.v1';
export const TRANSLATIONS = window.TACCAN_TRANSLATIONS || {};
export const STRINGS_BY_LANG = TRANSLATIONS.strings || {};
export const WORD_TRANSLATIONS_BY_LANG = TRANSLATIONS.words || {};
export const SUPPORTED_LANGUAGES = Array.isArray(TRANSLATIONS.supportedLanguages)
  ? TRANSLATIONS.supportedLanguages
  : ['en'];
export const DEFAULT_LANGUAGE =
  SUPPORTED_LANGUAGES.find((code) => code === TRANSLATIONS.defaultLanguage) || SUPPORTED_LANGUAGES[0] || 'en';
export const SCENE_CLASSES = [
  'scene-lobby',
  'scene-hint-red',
  'scene-hint-blue',
  'scene-guess-red',
  'scene-guess-blue',
  'scene-finished',
];
export const STAMP_SVG_NS = 'http://www.w3.org/2000/svg';
export const STAMP_PATHS = Object.freeze({
  red: 'M12 76 L33 62 L49 49 L62 44 L57 56 L60 67 L80 58 L107 72 L82 73 L66 85 L53 79 L37 84 Z',
  blue:
    'M31 88 C24 64 34 43 59 39 C84 43 95 64 87 88 C79 76 71 71 59 71 C47 71 39 76 31 88 Z M49 60 A5 5 0 1 0 49 50 A5 5 0 1 0 49 60 Z M69 60 A5 5 0 1 0 69 50 A5 5 0 1 0 69 60 Z',
  assassin: 'M12 83 L30 58 L51 43 L72 39 L58 57 L99 53 L76 68 L90 87 L57 79 L34 91 Z',
});

// --- Mutable state ---
export const state = {
  snapshot: null,
  toastTimer: null,
  liveTicker: null,
  rejoinAttempted: false,
  revealedCardIndexes: new Set(),
  activeGameId: null,
  selectedGuessIndex: null,
  spymasterSelections: new Set(),
  language: DEFAULT_LANGUAGE,
  cardElements: [],
  soundMuted: false,
  colorblindMode: false,
  aiAvailable: false,
  voiceActive: false,
  voiceMuted: false,
  voicePeers: new Set(),
  voiceSpeaking: new Map(),
  voiceMutedPeers: new Set(),
};

// --- Session persistence ---
export function readSession() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value);
    if (!parsed || !parsed.code || !parsed.sessionId) return null;
    return parsed;
  } catch (_error) {
    return null;
  }
}

export function writeSession(session) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch (_error) {}
}

export function clearSession() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (_error) {}
}
