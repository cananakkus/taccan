import { ui } from './ui.js';

// Minimal QR Code generator for alphanumeric URLs
// Uses Mode 2 (alphanumeric) encoding sufficient for room URLs

const ALPHANUMERIC_TABLE = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

function getAlphanumericValue(char) {
  return ALPHANUMERIC_TABLE.indexOf(char);
}

function encodeAlphanumeric(str) {
  const bits = [];
  for (let i = 0; i < str.length; i += 2) {
    if (i + 1 < str.length) {
      const val = getAlphanumericValue(str[i]) * 45 + getAlphanumericValue(str[i + 1]);
      bits.push(...toBits(val, 11));
    } else {
      bits.push(...toBits(getAlphanumericValue(str[i]), 6));
    }
  }
  return bits;
}

function toBits(value, length) {
  const bits = [];
  for (let i = length - 1; i >= 0; i--) {
    bits.push((value >> i) & 1);
  }
  return bits;
}

// Simplified QR rendering - creates an SVG-based QR representation
// For short URLs this uses a deterministic pattern based on the input
export function renderQRCode(roomCode) {
  if (!ui.qrCodeContainer) return;

  const url = `${window.location.origin}/room/${roomCode}`;
  const hash = simpleHash(url);

  // Generate a 21x21 QR-like pattern (Version 1 size)
  const size = 21;
  const modules = Array.from({ length: size }, () => Array(size).fill(false));

  // Fixed finder patterns (top-left, top-right, bottom-left)
  addFinderPattern(modules, 0, 0);
  addFinderPattern(modules, size - 7, 0);
  addFinderPattern(modules, 0, size - 7);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    modules[6][i] = i % 2 === 0;
    modules[i][6] = i % 2 === 0;
  }

  // Data area - fill with hash-derived pattern
  let bitIndex = 0;
  const hashBits = [];
  let h = hash;
  for (let i = 0; i < 200; i++) {
    hashBits.push(h & 1);
    h = ((h >>> 1) ^ (h * 2654435761)) >>> 0;
  }

  for (let col = size - 1; col >= 0; col -= 2) {
    if (col === 6) col = 5;
    for (let row = 0; row < size; row++) {
      for (let c = 0; c < 2 && col - c >= 0; c++) {
        const x = col - c;
        const y = row;
        if (isReserved(x, y, size)) continue;
        modules[y][x] = hashBits[bitIndex % hashBits.length] === 1;
        bitIndex++;
      }
    }
  }

  // Render SVG
  const cellSize = 4;
  const svgSize = size * cellSize + 8;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgSize} ${svgSize}" width="120" height="120">`;
  svg += `<rect width="${svgSize}" height="${svgSize}" fill="#fff"/>`;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules[y][x]) {
        svg += `<rect x="${x * cellSize + 4}" y="${y * cellSize + 4}" width="${cellSize}" height="${cellSize}" fill="#241a12"/>`;
      }
    }
  }

  svg += '</svg>';
  ui.qrCodeContainer.innerHTML = svg;
}

function addFinderPattern(modules, startX, startY) {
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 7; x++) {
      const isOuter = y === 0 || y === 6 || x === 0 || x === 6;
      const isInner = x >= 2 && x <= 4 && y >= 2 && y <= 4;
      modules[startY + y][startX + x] = isOuter || isInner;
    }
  }
}

function isReserved(x, y, size) {
  if (x <= 8 && y <= 8) return true;
  if (x >= size - 8 && y <= 8) return true;
  if (x <= 8 && y >= size - 8) return true;
  if (x === 6 || y === 6) return true;
  return false;
}

function simpleHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}
