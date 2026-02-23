export function deriveScene(snapshot) {
  if (!snapshot) return 'lobby';
  const game = snapshot.game;
  if (!game) {
    if (snapshot.room?.countdown?.active) return 'countdown';
    return 'lobby';
  }
  if (game.phase === 'finished') return 'finished';
  return `${game.phase}_${game.currentTeam}`;
}

export function sceneToBodyClass(scene) {
  return `scene-${scene.replace('_', '-')}`;
}
