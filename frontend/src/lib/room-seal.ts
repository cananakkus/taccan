const SHIELDS = [
  'M50 5 L90 25 L90 60 Q90 85 50 95 Q10 85 10 60 L10 25 Z',
  'M50 5 Q90 5 90 35 L90 60 Q90 90 50 95 Q10 90 10 60 L10 35 Q10 5 50 5 Z',
  'M15 10 L85 10 L90 30 L90 65 Q90 90 50 95 Q10 90 10 65 L10 30 Z',
];

const ICONS = [
  'M50 40 Q35 40 28 50 Q35 60 50 60 Q65 60 72 50 Q65 40 50 40 Z M50 44 A6 6 0 1 1 50 56 A6 6 0 1 1 50 44 Z',
  'M40 35 A10 10 0 1 1 40 55 A10 10 0 1 1 40 35 Z M48 50 L70 50 L70 58 L65 58 L65 54 L60 54 L60 58 L55 58 L55 50',
  'M50 20 L56 38 L75 38 L60 49 L66 68 L50 56 L34 68 L40 49 L25 38 L44 38 Z',
  'M20 65 L20 40 L35 52 L50 30 L65 52 L80 40 L80 65 Z',
  'M50 15 L55 45 L85 50 L55 55 L50 85 L45 55 L15 50 L45 45 Z',
];

const BORDERS = [
  'none',
  'stroke-dasharray="4 2"',
  'stroke-dasharray="8 3"',
  'stroke-dasharray="2 2 6 2"',
];

export function renderRoomSeal(roomCode: string): string {
  const hash = hashCode(roomCode);
  const shieldPath = SHIELDS[Math.abs(hash) % SHIELDS.length];
  const iconPath = ICONS[Math.abs(hash >> 4) % ICONS.length];
  const borderAttr = BORDERS[Math.abs(hash >> 8) % BORDERS.length];

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="48" height="48">',
    `<path d="${shieldPath}" fill="none" stroke="#6b3a2a" stroke-width="2" ${borderAttr} opacity="0.45"/>`,
    `<path d="${shieldPath}" fill="#6b3a2a" opacity="0.05"/>`,
    `<path d="${iconPath}" fill="#6b3a2a" opacity="0.3"/>`,
    '</svg>',
  ].join('');
}

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}
