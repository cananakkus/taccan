export function getAvatarColor(name) {
  let hash = 0;
  const str = String(name || '');
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 40%, 35%)`;
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
