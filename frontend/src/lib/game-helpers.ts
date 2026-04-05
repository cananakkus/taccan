import type { BoardCard, GameView, PlayerView, Snapshot, Team } from '../types';

export function canHint(snapshot: Snapshot | null): boolean {
  return Boolean(
    snapshot?.game &&
      snapshot.game.phase === 'hint' &&
      snapshot.me.role === 'spymaster' &&
      snapshot.me.team === snapshot.game.currentTeam
  );
}

export function canGuess(snapshot: Snapshot | null): boolean {
  return Boolean(
    snapshot?.game &&
      snapshot.game.phase === 'guess' &&
      snapshot.me.role === 'operative' &&
      snapshot.me.team === snapshot.game.currentTeam
  );
}

export function canMark(snapshot: Snapshot | null, card: BoardCard | undefined): boolean {
  return canGuess(snapshot) && Boolean(card && !card.revealed);
}

export function canHostRematch(snapshot: Snapshot | null): boolean {
  return Boolean(snapshot?.me.isHost && snapshot.game?.phase === 'finished');
}

export function getCurrentMaxHintCount(snapshot: Snapshot | null): number | null {
  const fromGame = snapshot?.game?.maxHintCount;
  if (Number.isInteger(fromGame) && fromGame > 0) return fromGame;

  const fromRoom = snapshot?.room?.modeConfig?.maxHintCount;
  if (Number.isInteger(fromRoom) && fromRoom > 0) return fromRoom;

  return null;
}

export function getReadinessIssue(snapshot: Snapshot | null, t: (key: string) => string): string | null {
  if (!snapshot) return t('readiness_join_first');
  if (snapshot.game && snapshot.game.phase !== 'finished') return t('readiness_game_running');

  const connectedPlayers = snapshot.players.filter((player) => player.connected);
  if (connectedPlayers.length < 1) return t('readiness_need_connected');

  const connectedTeamPlayers = connectedPlayers.filter(
    (player) => player.team !== 'none' && player.role !== 'spectator'
  );
  if (connectedTeamPlayers.length < 1) return t('readiness_need_team_player');
  return null;
}

export function getPhaseTimerRemainingMs(game: GameView | null): number {
  const endsAt = game?.phaseTimer?.endsAt;
  if (!endsAt) return 0;
  return Math.max(0, endsAt - Date.now());
}

export function formatTimerRemaining(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function truncateMarkerName(name: string, fallback: string): string {
  const normalized = String(name || '').trim();
  if (!normalized) return fallback;
  const maxLength = 11;
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

export function getPlayerName(players: PlayerView[], sessionId: string, fallback: string): string {
  const player = players.find((item) => item.sessionId === sessionId);
  return player?.name || fallback;
}

export function getTeamPlayers(players: PlayerView[], team: Team): PlayerView[] {
  return players.filter((player) => player.team === team);
}
