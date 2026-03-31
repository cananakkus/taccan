import { state } from './state.js';
import { ui } from './ui.js';

const PANEL_KEYS = ['teams', 'settings', 'debrief'];
const PANEL_KEYBOARD_MAP = { '1': 'teams', '2': 'settings', '3': 'debrief' };
const DISMISS_THRESHOLD = 0.3; // fraction of sheet height to trigger close

// --- Drag state ---
let dragSheet = null;
let dragStartY = 0;
let dragCurrentY = 0;
let dragging = false;

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

  // Wire drag on all sheet handles
  for (const panel of ui.sheetPanels) {
    const handle = panel.querySelector('.sheet-handle');
    if (handle) {
      handle.addEventListener('pointerdown', onDragStart);
    }
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

// --- Drag handling ---

function onDragStart(e) {
  if (!state.openPanel) return;
  const sheet = e.target.closest('.sheet-panel');
  if (!sheet) return;

  dragSheet = sheet;
  dragStartY = e.clientY;
  dragCurrentY = e.clientY;
  dragging = true;

  // Kill CSS transition during drag
  sheet.style.transition = 'none';

  // Capture pointer for reliable tracking
  e.target.setPointerCapture(e.pointerId);
  e.target.addEventListener('pointermove', onDragMove);
  e.target.addEventListener('pointerup', onDragEnd);
  e.target.addEventListener('pointercancel', onDragEnd);
  e.preventDefault();
}

function onDragMove(e) {
  if (!dragging || !dragSheet) return;
  dragCurrentY = e.clientY;
  const dy = Math.max(0, dragCurrentY - dragStartY); // only allow downward drag
  dragSheet.style.transform = `translate(-50%, ${dy}px)`;

  // Fade backdrop proportionally
  if (ui.sheetBackdrop) {
    const sheetH = dragSheet.offsetHeight || 1;
    const progress = Math.min(1, dy / sheetH);
    ui.sheetBackdrop.style.opacity = String(1 - progress);
  }
}

function onDragEnd(e) {
  if (!dragging || !dragSheet) return;

  const dy = Math.max(0, dragCurrentY - dragStartY);
  const sheetH = dragSheet.offsetHeight || 1;
  const dismissed = dy / sheetH > DISMISS_THRESHOLD;

  // Restore CSS transition
  dragSheet.style.transition = '';
  if (ui.sheetBackdrop) ui.sheetBackdrop.style.opacity = '';

  if (dismissed) {
    // Let closePanel handle the animation from current position
    dragSheet.style.transform = '';
    closePanel();
  } else {
    // Spring back
    dragSheet.style.transform = 'translate(-50%, 0)';
  }

  // Cleanup listeners
  e.target.removeEventListener('pointermove', onDragMove);
  e.target.removeEventListener('pointerup', onDragEnd);
  e.target.removeEventListener('pointercancel', onDragEnd);

  dragSheet = null;
  dragging = false;
}

// --- Panel open/close ---

export function openPanel(key) {
  if (!PANEL_KEYS.includes(key)) return;

  // Close current panel without close animation for swap
  if (state.openPanel && state.openPanel !== key) {
    const oldSheet = document.querySelector(`.sheet-panel[data-sheet="${state.openPanel}"]`);
    if (oldSheet) {
      oldSheet.classList.remove('sheet-open', 'sheet-closing');
      oldSheet.style.transform = '';
    }
    const oldTab = document.querySelector(`.bar-tab[data-panel="${state.openPanel}"]`);
    if (oldTab) oldTab.classList.remove('active');
  }

  state.openPanel = key;

  if (ui.sheetBackdrop) ui.sheetBackdrop.classList.add('visible');

  const sheet = document.querySelector(`.sheet-panel[data-sheet="${key}"]`);
  if (sheet) {
    sheet.style.transform = '';
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
    sheet.style.transform = '';
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
