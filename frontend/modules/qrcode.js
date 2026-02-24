import { ui } from './ui.js';

// Minimal but correct QR Code encoder (byte mode, EC level L, versions 1-6)
// Produces scannable QR codes for room URLs.

const EC_CODEWORDS = [7, 10, 15, 20, 26, 36];  // version 1-6, level L
const DATA_CAPACITY = [19, 34, 55, 80, 108, 136]; // total data codewords per version

// GF(256) arithmetic for Reed-Solomon
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function initGF() {
  let v = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = v;
    GF_LOG[v] = i;
    v = (v << 1) ^ (v >= 128 ? 0x11d : 0);
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGenPoly(n) {
  let poly = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecCount) {
  const gen = rsGenPoly(ecCount);
  const msg = new Array(data.length + ecCount).fill(0);
  for (let i = 0; i < data.length; i++) msg[i] = data[i];
  for (let i = 0; i < data.length; i++) {
    const coef = msg[i];
    if (coef === 0) continue;
    for (let j = 0; j < gen.length; j++) {
      msg[i + j] ^= gfMul(gen[j], coef);
    }
  }
  return msg.slice(data.length);
}

function encodeData(bytes, version) {
  const capacity = DATA_CAPACITY[version - 1];
  const bits = [];
  // Mode indicator: byte mode = 0100
  bits.push(0, 1, 0, 0);
  // Character count (8 bits for versions 1-9)
  const countBits = version <= 9 ? 8 : 16;
  for (let i = countBits - 1; i >= 0; i--) bits.push((bytes.length >> i) & 1);
  // Data
  for (const b of bytes) {
    for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1);
  }
  // Terminator (up to 4 zeros)
  const maxBits = capacity * 8;
  for (let i = 0; i < 4 && bits.length < maxBits; i++) bits.push(0);
  // Pad to byte boundary
  while (bits.length % 8 !== 0) bits.push(0);
  // Pad codewords
  const pads = [0xEC, 0x11];
  let pi = 0;
  while (bits.length < maxBits) {
    for (let i = 7; i >= 0; i--) bits.push((pads[pi] >> i) & 1);
    pi ^= 1;
  }
  // Convert to bytes
  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let val = 0;
    for (let j = 0; j < 8; j++) val = (val << 1) | (bits[i + j] || 0);
    codewords.push(val);
  }
  return codewords;
}

function selectVersion(byteLength) {
  for (let v = 1; v <= 6; v++) {
    // Byte mode: 4 (mode) + 8 (count v1-9) + byteLength*8 bits
    const needed = Math.ceil((4 + 8 + byteLength * 8) / 8);
    if (needed <= DATA_CAPACITY[v - 1]) return v;
  }
  return 6; // fallback to largest supported
}

function getSize(version) { return 17 + version * 4; }

function createMatrix(size) {
  return Array.from({ length: size }, () => new Uint8Array(size));
}

function addFinderPattern(matrix, reserved, x0, y0) {
  const size = matrix.length;
  for (let dy = -1; dy <= 7; dy++) {
    for (let dx = -1; dx <= 7; dx++) {
      const x = x0 + dx, y = y0 + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      reserved[y][x] = 1;
      if (dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6) {
        const outer = dx === 0 || dx === 6 || dy === 0 || dy === 6;
        const inner = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
        matrix[y][x] = (outer || inner) ? 1 : 0;
      }
    }
  }
}

const ALIGNMENT_POSITIONS = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34]];

function addAlignmentPatterns(matrix, reserved, version) {
  const positions = ALIGNMENT_POSITIONS[version];
  if (!positions || positions.length < 2) return;
  for (const cy of positions) {
    for (const cx of positions) {
      if (reserved[cy]?.[cx]) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const x = cx + dx, y = cy + dy;
          reserved[y][x] = 1;
          const edge = Math.abs(dx) === 2 || Math.abs(dy) === 2;
          const center = dx === 0 && dy === 0;
          matrix[y][x] = (edge || center) ? 1 : 0;
        }
      }
    }
  }
}

function addTimingPatterns(matrix, reserved) {
  const size = matrix.length;
  for (let i = 8; i < size - 8; i++) {
    if (!reserved[6][i]) { matrix[6][i] = i % 2 === 0 ? 1 : 0; reserved[6][i] = 1; }
    if (!reserved[i][6]) { matrix[i][6] = i % 2 === 0 ? 1 : 0; reserved[i][6] = 1; }
  }
}

function reserveFormatArea(reserved, size) {
  for (let i = 0; i < 8; i++) {
    reserved[8][i] = 1; reserved[8][size - 1 - i] = 1;
    reserved[i][8] = 1; reserved[size - 1 - i][8] = 1;
  }
  reserved[8][8] = 1;
  reserved[size - 8][8] = 1; // dark module
}

function placeDataBits(matrix, reserved, bits) {
  const size = matrix.length;
  let idx = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let c = 0; c < 2; c++) {
        const x = right - c;
        const upward = ((right + 1) >> 1 & 1) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (reserved[y][x]) continue;
        matrix[y][x] = idx < bits.length ? bits[idx] : 0;
        idx++;
      }
    }
  }
}

const MASK_FNS = [
  (r, c) => (r + c) % 2 === 0,
  (r, c) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2 + (r * c) % 3) === 0,
  (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0,
  (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0,
];

function applyMask(matrix, reserved, maskIndex) {
  const fn = MASK_FNS[maskIndex];
  const size = matrix.length;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!reserved[y][x] && fn(y, x)) {
        matrix[y][x] ^= 1;
      }
    }
  }
}

// Format info for EC level L (indicator = 01)
const FORMAT_BITS_L = [
  0x77c4, 0x72f3, 0x7daa, 0x789d, 0x662f, 0x6318, 0x6c41, 0x6976,
];

function placeFormatInfo(matrix, maskIndex) {
  const size = matrix.length;
  const info = FORMAT_BITS_L[maskIndex];
  const bits = [];
  for (let i = 14; i >= 0; i--) bits.push((info >> i) & 1);

  // Around top-left finder
  const positions = [
    [0,8],[1,8],[2,8],[3,8],[4,8],[5,8],[7,8],[8,8],
    [8,7],[8,5],[8,4],[8,3],[8,2],[8,1],[8,0],
  ];
  for (let i = 0; i < 15; i++) {
    matrix[positions[i][0]][positions[i][1]] = bits[i];
  }
  // Bottom-left and top-right
  for (let i = 0; i < 7; i++) matrix[size - 1 - i][8] = bits[i];
  for (let i = 7; i < 15; i++) matrix[8][size - 15 + i] = bits[i];
  // Dark module
  matrix[size - 8][8] = 1;
}

function penaltyScore(matrix) {
  const size = matrix.length;
  let score = 0;
  // Rule 1: runs of 5+
  for (let y = 0; y < size; y++) {
    let run = 1;
    for (let x = 1; x < size; x++) {
      if (matrix[y][x] === matrix[y][x - 1]) { run++; }
      else { if (run >= 5) score += run - 2; run = 1; }
    }
    if (run >= 5) score += run - 2;
  }
  for (let x = 0; x < size; x++) {
    let run = 1;
    for (let y = 1; y < size; y++) {
      if (matrix[y][x] === matrix[y - 1][x]) { run++; }
      else { if (run >= 5) score += run - 2; run = 1; }
    }
    if (run >= 5) score += run - 2;
  }
  return score;
}

function generateQR(url) {
  const bytes = new TextEncoder().encode(url);
  const version = selectVersion(bytes.length);
  const size = getSize(version);
  const ecCount = EC_CODEWORDS[version - 1];

  // Encode data + error correction
  const dataCW = encodeData(bytes, version);
  const ecCW = rsEncode(dataCW, ecCount);
  const allCW = [...dataCW, ...ecCW];
  const bits = [];
  for (const cw of allCW) {
    for (let i = 7; i >= 0; i--) bits.push((cw >> i) & 1);
  }

  // Build matrix
  const reserved = createMatrix(size);
  const baseMatrix = createMatrix(size);

  addFinderPattern(baseMatrix, reserved, 0, 0);
  addFinderPattern(baseMatrix, reserved, size - 7, 0);
  addFinderPattern(baseMatrix, reserved, 0, size - 7);
  addTimingPatterns(baseMatrix, reserved);
  addAlignmentPatterns(baseMatrix, reserved, version);
  reserveFormatArea(reserved, size);

  placeDataBits(baseMatrix, reserved, bits);

  // Try all masks, pick lowest penalty
  let bestMask = 0, bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    const trial = baseMatrix.map(r => Uint8Array.from(r));
    applyMask(trial, reserved, m);
    placeFormatInfo(trial, m);
    const s = penaltyScore(trial);
    if (s < bestScore) { bestScore = s; bestMask = m; }
  }

  const matrix = baseMatrix;
  applyMask(matrix, reserved, bestMask);
  placeFormatInfo(matrix, bestMask);

  return { matrix, size };
}

export function renderQRCode(roomCode) {
  if (!ui.qrCodeContainer) return;

  const url = `${window.location.origin}/room/${roomCode}`;
  let qr;
  try {
    qr = generateQR(url);
  } catch (_e) {
    ui.qrCodeContainer.innerHTML = '';
    return;
  }

  const { matrix, size } = qr;
  const cellSize = 4;
  const quiet = 4; // quiet zone
  const svgSize = (size + quiet * 2) * cellSize;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgSize} ${svgSize}" width="100" height="100">`;
  svg += `<rect width="${svgSize}" height="${svgSize}" fill="#f4ecd8"/>`;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (matrix[y][x]) {
        svg += `<rect x="${(x + quiet) * cellSize}" y="${(y + quiet) * cellSize}" width="${cellSize}" height="${cellSize}" fill="#2c2416"/>`;
      }
    }
  }

  svg += '</svg>';
  ui.qrCodeContainer.innerHTML = svg;
}
