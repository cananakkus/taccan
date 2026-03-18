import { state } from './state.js';
import { ui } from './ui.js';

const PANEL_KEYS = ['teams', 'feed', 'voice', 'settings', 'debrief'];
const PANEL_KEYBOARD_MAP = { '1': 'teams', '2': 'feed', '3': 'voice', '4': 'settings', '5': 'debrief' };

export function initPanels() {
  for (const tab of ui.barTabs) {
    tab.addEventListener('click', () => {
      const key = tab.dataset.panel;
      if (key) togglePanel(key);
    });
  }

  if (ui.sheetBackdrop) {
    ui.sheetBackdrop.addEventListener('click', closePanel);
  }

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;

    if (e.key === 'Escape') {
      if (state.openPanel) {
        closePanel();
        e.preventDefault();
        return;
      }
      const confirmOverlay = document.getElementById('confirm-overlay');
      if (confirmOverlay && !confirmOverlay.classList.contains('hidden')) {
        const noBtn = document.getElementById('confirm-no-btn');
        if (noBtn) noBtn.click();
      }
      return;
    }

    const panelKey = PANEL_KEYBOARD_MAP[e.key];
    if (panelKey) {
      e.preventDefault();
      togglePanel(panelKey);
    }
  });
}

export function openPanel(key) {
  if (!PANEL_KEYS.includes(key)) return;

  // Close current panel without close animation for swap
  if (state.openPanel && state.openPanel !== key) {
    const oldSheet = document.querySelector(`.sheet-panel[data-sheet="${state.openPanel}"]`);
    if (oldSheet) oldSheet.classList.remove('sheet-open', 'sheet-closing');
    const oldTab = document.querySelector(`.bar-tab[data-panel="${state.openPanel}"]`);
    if (oldTab) oldTab.classList.remove('active');
  }

  state.openPanel = key;

  if (ui.sheetBackdrop) ui.sheetBackdrop.classList.add('visible');

  const sheet = document.querySelector(`.sheet-panel[data-sheet="${key}"]`);
  if (sheet) {
    sheet.classList.remove('sheet-closing');
    sheet.classList.add('sheet-open');
  }

  const tab = document.querySelector(`.bar-tab[data-panel="${key}"]`);
  if (tab) tab.classList.add('active');
}

export function closePanel() {
  if (!state.openPanel) return;

  const key = state.openPanel;
  const sheet = document.querySelector(`.sheet-panel[data-sheet="${key}"]`);

  const tab = document.querySelector(`.bar-tab[data-panel="${key}"]`);
  if (tab) tab.classList.remove('active');

  if (ui.sheetBackdrop) ui.sheetBackdrop.classList.remove('visible');

  if (sheet) {
    sheet.classList.add('sheet-closing');
    sheet.classList.remove('sheet-open');
    const onEnd = () => {
      sheet.classList.remove('sheet-closing');
      sheet.removeEventListener('transitionend', onEnd);
    };
    sheet.addEventListener('transitionend', onEnd, { once: true });
    setTimeout(() => sheet.classList.remove('sheet-closing'), 400);
  }

  state.openPanel = null;
}

export function togglePanel(key) {
  if (state.openPanel === key) {
    closePanel();
  } else {
    openPanel(key);
  }
}

export function showDebriefTab() {
  if (ui.debriefTab) ui.debriefTab.classList.remove('hidden');
}

export function hideDebriefTab() {
  if (ui.debriefTab) ui.debriefTab.classList.add('hidden');
  if (state.openPanel === 'debrief') closePanel();
}
