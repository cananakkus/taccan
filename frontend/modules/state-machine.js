export function deriveScene(snapshot) {
  if (!snapshot) return 'lobby';
  const game = snapshot.game;
  if (!game) {
    return 'lobby';
  }
  if (game.phase === 'finished') return 'finished';
  return `${game.phase}_${game.currentTeam}`;
}

export function sceneToBodyClass(scene) {
  return `scene-${scene.replace('_', '-')}`;
}
