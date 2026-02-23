import { state } from './state.js';
import { ui } from './ui.js';

const COLS = 5;
const ROWS = 5;

export function initKeyboardNav() {
  ui.board.addEventListener('keydown', (event) => {
    const current = document.activeElement;
    if (!current || !current.dataset.cardIndex) return;

    const index = Number(current.dataset.cardIndex);
    if (!Number.isInteger(index)) return;

    const row = Math.floor(index / COLS);
    const col = index % COLS;
    let nextIndex = -1;

    switch (event.key) {
      case 'ArrowUp':
        if (row > 0) nextIndex = (row - 1) * COLS + col;
        break;
      case 'ArrowDown':
        if (row < ROWS - 1) nextIndex = (row + 1) * COLS + col;
        break;
      case 'ArrowLeft':
        if (col > 0) nextIndex = row * COLS + (col - 1);
        break;
      case 'ArrowRight':
        if (col < COLS - 1) nextIndex = row * COLS + (col + 1);
        break;
      case 'Home':
        nextIndex = row * COLS;
        break;
      case 'End':
        nextIndex = row * COLS + (COLS - 1);
        break;
      default:
        return;
    }

    if (nextIndex >= 0 && nextIndex < 25) {
      event.preventDefault();
      const nextCard = state.cardElements[nextIndex];
      if (nextCard) {
        // Roving tabindex
        current.setAttribute('tabindex', '-1');
        nextCard.setAttribute('tabindex', '0');
        nextCard.focus();
      }
    }
  });
}
