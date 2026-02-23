import { state, SCRATCHPAD_STORAGE_KEY } from './state.js';
import { ui } from './ui.js';

export function initScratchpad() {
  if (!ui.scratchpadTextarea) return;

  ui.scratchpadTextarea.addEventListener('input', () => {
    const gameId = state.activeGameId;
    if (!gameId) return;
    try {
      const key = `${SCRATCHPAD_STORAGE_KEY}.${gameId}`;
      localStorage.setItem(key, ui.scratchpadTextarea.value);
    } catch (_e) {}
  });

  // Restore on game change via MutationObserver on scratchpad visibility
  const observer = new MutationObserver(() => {
    restoreScratchpad();
  });

  if (ui.scratchpad) {
    observer.observe(ui.scratchpad, { attributes: true, attributeFilter: ['class'] });
  }
}

function restoreScratchpad() {
  if (!ui.scratchpadTextarea || !state.activeGameId) return;
  try {
    const key = `${SCRATCHPAD_STORAGE_KEY}.${state.activeGameId}`;
    const saved = localStorage.getItem(key);
    if (saved !== null && ui.scratchpadTextarea.value === '') {
      ui.scratchpadTextarea.value = saved;
    }
  } catch (_e) {}
}
