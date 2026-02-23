import { state } from './state.js';

export function getAvatarColor(name) {
  let hash = 0;
  const str = String(name || '');
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 45%, 42%)`;
}

export function getInitials(name) {
  const str = String(name || '').trim();
  if (!str) return '?';
  const parts = str.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return str.slice(0, 2).toUpperCase();
}

const STATS_KEY = 'taccan.stats.v1';

export function recordGameResult(won) {
  const stats = getStats();
  if (won) stats.wins += 1;
  else stats.losses += 1;
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch (_e) {}
}

export function getStats() {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { wins: Number(parsed.wins) || 0, losses: Number(parsed.losses) || 0 };
    }
  } catch (_e) {}
  return { wins: 0, losses: 0 };
}
