const EC_CODEWORDS = [7, 10, 15, 20, 26, 36];
const DATA_CAPACITY = [19, 34, 55, 80, 108, 136];

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

for (let i = 0, value = 1; i < 255; i += 1) {
  GF_EXP[i] = value;
  GF_LOG[value] = i;
  value = (value << 1) ^ (value >= 128 ? 0x11d : 0);
}
for (let i = 255; i < 512; i += 1) {
  GF_EXP[i] = GF_EXP[i - 255];
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGenPoly(length: number): number[] {
  let poly = [1];
  for (let i = 0; i < length; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data: number[], ecCount: number): number[] {
  const generator = rsGenPoly(ecCount);
  const message = new Array(data.length + ecCount).fill(0);
  for (let i = 0; i < data.length; i += 1) message[i] = data[i];
  for (let i = 0; i < data.length; i += 1) {
    const coefficient = message[i];
    if (coefficient === 0) continue;
    for (let j = 0; j < generator.length; j += 1) {
      message[i + j] ^= gfMul(generator[j], coefficient);
    }
  }
  return message.slice(data.length);
}

function selectVersion(byteLength: number): number {
  for (let version = 1; version <= 6; version += 1) {
    const needed = Math.ceil((4 + 8 + byteLength * 8) / 8);
    if (needed <= DATA_CAPACITY[version - 1]) return version;
  }
  return 6;
}

function getSize(version: number): number {
  return 17 + version * 4;
}

function createMatrix(size: number): Uint8Array[] {
  return Array.from({ length: size }, () => new Uint8Array(size));
}

function addFinderPattern(matrix: Uint8Array[], reserved: Uint8Array[], x0: number, y0: number) {
  const size = matrix.length;
  for (let dy = -1; dy <= 7; dy += 1) {
    for (let dx = -1; dx <= 7; dx += 1) {
      const x = x0 + dx;
      const y = y0 + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      reserved[y][x] = 1;
      if (dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6) {
        const outer = dx === 0 || dx === 6 || dy === 0 || dy === 6;
        const inner = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
        matrix[y][x] = outer || inner ? 1 : 0;
      }
    }
  }
}

const ALIGNMENT_POSITIONS = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34]];

function addAlignmentPatterns(matrix: Uint8Array[], reserved: Uint8Array[], version: number) {
  const positions = ALIGNMENT_POSITIONS[version];
  if (!positions || positions.length < 2) return;
  for (const cy of positions) {
    for (const cx of positions) {
      if (reserved[cy]?.[cx]) continue;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const x = cx + dx;
          const y = cy + dy;
          reserved[y][x] = 1;
          const edge = Math.abs(dx) === 2 || Math.abs(dy) === 2;
          const center = dx === 0 && dy === 0;
          matrix[y][x] = edge || center ? 1 : 0;
        }
      }
    }
  }
}

function addTimingPatterns(matrix: Uint8Array[], reserved: Uint8Array[]) {
  const size = matrix.length;
  for (let i = 8; i < size - 8; i += 1) {
    if (!reserved[6][i]) {
      matrix[6][i] = i % 2 === 0 ? 1 : 0;
      reserved[6][i] = 1;
    }
    if (!reserved[i][6]) {
      matrix[i][6] = i % 2 === 0 ? 1 : 0;
      reserved[i][6] = 1;
    }
  }
}

function reserveFormatArea(reserved: Uint8Array[], size: number) {
  for (let i = 0; i < 8; i += 1) {
    reserved[8][i] = 1;
    reserved[8][size - 1 - i] = 1;
    reserved[i][8] = 1;
    reserved[size - 1 - i][8] = 1;
  }
  reserved[8][8] = 1;
  reserved[size - 8][8] = 1;
}

function encodeData(bytes: Uint8Array, version: number): number[] {
  const capacity = DATA_CAPACITY[version - 1];
  const bits: number[] = [0, 1, 0, 0];
  for (let i = 7; i >= 0; i -= 1) bits.push((bytes.length >> i) & 1);
  for (const byte of bytes) {
    for (let i = 7; i >= 0; i -= 1) bits.push((byte >> i) & 1);
  }
  const maxBits = capacity * 8;
  for (let i = 0; i < 4 && bits.length < maxBits; i += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const pads = [0xec, 0x11];
  let padIndex = 0;
  while (bits.length < maxBits) {
    for (let i = 7; i >= 0; i -= 1) bits.push((pads[padIndex] >> i) & 1);
    padIndex ^= 1;
  }

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j += 1) value = (value << 1) | (bits[i + j] || 0);
    codewords.push(value);
  }
  return codewords;
}

function placeDataBits(matrix: Uint8Array[], reserved: Uint8Array[], bits: number[]) {
  const size = matrix.length;
  let bitIndex = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert += 1) {
      for (let column = 0; column < 2; column += 1) {
        const x = right - column;
        const upward = ((((right + 1) >> 1) & 1) === 0);
        const y = upward ? size - 1 - vert : vert;
        if (reserved[y][x]) continue;
        matrix[y][x] = bitIndex < bits.length ? bits[bitIndex] : 0;
        bitIndex += 1;
      }
    }
  }
}

const MASK_FNS = [
  (r: number, c: number) => (r + c) % 2 === 0,
  (r: number) => r % 2 === 0,
  (_r: number, c: number) => c % 3 === 0,
  (r: number, c: number) => (r + c) % 3 === 0,
  (r: number, c: number) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r: number, c: number) => ((r * c) % 2 + (r * c) % 3) === 0,
  (r: number, c: number) => ((r * c) % 2 + (r * c) % 3) % 2 === 0,
  (r: number, c: number) => ((r + c) % 2 + (r * c) % 3) % 2 === 0,
];

function applyMask(matrix: Uint8Array[], reserved: Uint8Array[], maskIndex: number) {
  const fn = MASK_FNS[maskIndex];
  const size = matrix.length;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!reserved[y][x] && fn(y, x)) {
        matrix[y][x] ^= 1;
      }
    }
  }
}

const FORMAT_BITS_L = [0x77c4, 0x72f3, 0x7daa, 0x789d, 0x662f, 0x6318, 0x6c41, 0x6976];

function placeFormatInfo(matrix: Uint8Array[], maskIndex: number) {
  const size = matrix.length;
  const info = FORMAT_BITS_L[maskIndex];
  const bits: number[] = [];
  for (let i = 14; i >= 0; i -= 1) bits.push((info >> i) & 1);

  const positions = [
    [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [7, 8], [8, 8],
    [8, 7], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
  ];
  for (let i = 0; i < 15; i += 1) matrix[positions[i][0]][positions[i][1]] = bits[i];
  for (let i = 0; i < 7; i += 1) matrix[size - 1 - i][8] = bits[i];
  for (let i = 7; i < 15; i += 1) matrix[8][size - 15 + i] = bits[i];
  matrix[size - 8][8] = 1;
}

function penaltyScore(matrix: Uint8Array[]): number {
  const size = matrix.length;
  let score = 0;
  for (let y = 0; y < size; y += 1) {
    let run = 1;
    for (let x = 1; x < size; x += 1) {
      if (matrix[y][x] === matrix[y][x - 1]) run += 1;
      else {
        if (run >= 5) score += run - 2;
        run = 1;
      }
    }
    if (run >= 5) score += run - 2;
  }
  for (let x = 0; x < size; x += 1) {
    let run = 1;
    for (let y = 1; y < size; y += 1) {
      if (matrix[y][x] === matrix[y - 1][x]) run += 1;
      else {
        if (run >= 5) score += run - 2;
        run = 1;
      }
    }
    if (run >= 5) score += run - 2;
  }
  return score;
}

function generateMatrix(url: string): { matrix: Uint8Array[]; size: number } {
  const bytes = new TextEncoder().encode(url);
  const version = selectVersion(bytes.length);
  const size = getSize(version);
  const ecCount = EC_CODEWORDS[version - 1];

  const dataCW = encodeData(bytes, version);
  const ecCW = rsEncode(dataCW, ecCount);
  const bits: number[] = [];

  for (const codeword of [...dataCW, ...ecCW]) {
    for (let i = 7; i >= 0; i -= 1) bits.push((codeword >> i) & 1);
  }

  const reserved = createMatrix(size);
  const baseMatrix = createMatrix(size);
  addFinderPattern(baseMatrix, reserved, 0, 0);
  addFinderPattern(baseMatrix, reserved, size - 7, 0);
  addFinderPattern(baseMatrix, reserved, 0, size - 7);
  addTimingPatterns(baseMatrix, reserved);
  addAlignmentPatterns(baseMatrix, reserved, version);
  reserveFormatArea(reserved, size);
  placeDataBits(baseMatrix, reserved, bits);

  let bestMask = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask += 1) {
    const trial = baseMatrix.map((row) => Uint8Array.from(row));
    applyMask(trial, reserved, mask);
    placeFormatInfo(trial, mask);
    const score = penaltyScore(trial);
    if (score < bestScore) {
      bestScore = score;
      bestMask = mask;
    }
  }

  applyMask(baseMatrix, reserved, bestMask);
  placeFormatInfo(baseMatrix, bestMask);
  return { matrix: baseMatrix, size };
}

export function renderQRCode(url: string): string {
  const { matrix, size } = generateMatrix(url);
  const cellSize = 4;
  const quiet = 4;
  const svgSize = (size + quiet * 2) * cellSize;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgSize} ${svgSize}" width="100" height="100">`;
  svg += `<rect width="${svgSize}" height="${svgSize}" fill="#f4ecd8"/>`;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (matrix[y][x]) {
        svg += `<rect x="${(x + quiet) * cellSize}" y="${(y + quiet) * cellSize}" width="${cellSize}" height="${cellSize}" fill="#2c2416"/>`;
      }
    }
  }
  svg += '</svg>';
  return svg;
}
