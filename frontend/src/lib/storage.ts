import type { SessionRecord } from '../types';

export const STORAGE_KEY = 'taccan.session.v1';
export const LANGUAGE_STORAGE_KEY = 'taccan.language.v1';
export const SOUND_MUTE_KEY = 'taccan.sound.mute.v1';
export const COLORBLIND_KEY = 'taccan.colorblind.v1';
export const NOISE_SUPPRESSION_KEY = 'taccan.noise.v1';
export const THEME_KEY = 'taccan.theme.v1';

export function readJson<T>(key: string): T | null {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : null;
  } catch (_error) {
    return null;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_error) {}
}

export function readSession(): SessionRecord | null {
  const value = readJson<SessionRecord>(STORAGE_KEY);
  if (!value || typeof value.code !== 'string' || !/^[A-Za-z0-9]{4}$/.test(value.code) ||
      typeof value.sessionId !== 'string' || !value.sessionId.trim() || value.sessionId.length > 128 ||
      (value.name !== undefined && typeof value.name !== 'string') ||
      (value.reconnectToken !== undefined && (typeof value.reconnectToken !== 'string' || value.reconnectToken.length > 128))) return null;
  return { code: value.code.toUpperCase(), sessionId: value.sessionId, name: value.name || '',
    ...(value.reconnectToken ? { reconnectToken: value.reconnectToken } : {}) };
}

export function writeSession(session: SessionRecord): void {
  writeJson(STORAGE_KEY, session);
}

export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (_error) {}
}
