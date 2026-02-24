import { state, COLORBLIND_KEY } from './modules/state.js';
import { ui } from './modules/ui.js';
import { initLanguage } from './modules/i18n.js';
import { wireSocketEvents } from './modules/socket.js';
import { wireUiEvents } from './modules/actions.js';
import { render, initBoard } from './modules/render.js';
import { initKeyboardNav } from './modules/keyboard-nav.js';
import { initVoice } from './modules/voice.js';
import './modules/sound.js';

// Parse /room/XXXX URL and auto-fill code input
const pathMatch = window.location.pathname.match(/^\/room\/([A-Za-z0-9]{4})$/);
if (pathMatch && ui.codeInput) {
  ui.codeInput.value = pathMatch[1].toUpperCase();
}

// Restore colorblind preference
try {
  if (localStorage.getItem(COLORBLIND_KEY) === '1') {
    state.colorblindMode = true;
    document.body.classList.add('colorblind-mode');
  }
} catch (_e) {}

// Theatrical mode via URL param
if (new URLSearchParams(window.location.search).get('theater') === '1') {
  document.body.classList.add('theatrical-mode');
}

// Check AI availability once at init
fetch('/api/ai-available').then(r => r.json()).then(data => {
  if (data.available) state.aiAvailable = true;
}).catch(() => {});

initBoard();
initLanguage();
wireSocketEvents();
initVoice();
wireUiEvents();
initKeyboardNav();
render();

// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
