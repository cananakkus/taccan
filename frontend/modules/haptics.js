const patterns = {
  cardSelect: [20],
  correctGuess: [30, 50, 30],
  assassin: [100, 50, 100, 50, 200],
  heartbeat: [60, 120, 60],
  toastSuccess: [15],
  toastError: [40, 30, 40],
};

export function triggerHaptic(name) {
  if (!navigator.vibrate) return;
  const pattern = patterns[name];
  if (!pattern) return;
  try {
    navigator.vibrate(pattern);
  } catch (_e) {}
}
