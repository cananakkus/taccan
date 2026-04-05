export type Team = 'red' | 'blue' | 'none';
export type Role = 'spymaster' | 'operative' | 'spectator';
export type Confidence = 'firm' | 'tentative';
export type RoomMode = 'casual' | 'blitz';
export type RoomStatus = 'lobby' | 'in_game' | 'finished';
export type GamePhase = 'hint' | 'guess' | 'finished';

export interface SessionRecord {
  code: string;
  sessionId: string;
  name: string;
}

export interface ChatMessage {
  sessionId: string;
  name: string;
  team: Team;
  text: string;
  ts: number;
}

export interface MatchInfo {
  id: string;
  roundNumber: number;
}

export interface ModeConfig {
  hintTimerMs: number | null;
  guessTimerMs: number | null;
  maxHintCount: number | null;
}

export interface RoomView {
  code: string;
  status: RoomStatus;
  hostSessionId: string | null;
  createdAt: number;
  mode: RoomMode;
  modeConfig: ModeConfig;
  match: MatchInfo | null;
  chatMessages: ChatMessage[];
}

export interface PlayerView {
  sessionId: string;
  name: string;
  team: Team;
  role: Role;
  connected: boolean;
  joinedAt: number;
  isHost: boolean;
}

export interface MeView {
  sessionId: string;
  name: string;
  team: Team;
  role: Role;
  connected: boolean;
  isHost: boolean;
}

export interface CardMark {
  sessionId: string;
  name: string;
  team: Team;
  confidence?: Confidence;
}

export interface BoardCard {
  index: number;
  word: string;
  revealed: boolean;
  revealedBy: Team | null;
  color: 'red' | 'blue' | 'neutral' | 'assassin' | null;
  marks: CardMark[];
}

export interface HintView {
  word: string;
  count: number;
  team: Team;
  by: string;
  at: number;
}

export interface PhaseTimer {
  phase: Exclude<GamePhase, 'finished'>;
  startedAt: number;
  endsAt: number;
  durationMs: number;
}

export interface GuessHistoryEntry {
  type: 'guess';
  by: string;
  team: Team;
  index: number;
  color: string;
  at: number;
}

export interface HintHistoryEntry {
  type: 'hint';
  by: string;
  team: Team;
  word: string;
  count: number;
  at: number;
}

export interface TurnEndHistoryEntry {
  type: 'turn_end';
  reason: string;
  endedAt: number;
  previousTeam: Team;
}

export interface GameEndHistoryEntry {
  type: 'game_end';
  winner: Team;
  loser: Team;
  reason: string;
  at: number;
}

export type GameHistoryEntry =
  | GuessHistoryEntry
  | HintHistoryEntry
  | TurnEndHistoryEntry
  | GameEndHistoryEntry
  | Record<string, unknown>;

export interface GameView {
  id: string;
  matchId: string | null;
  roundNumber: number | null;
  phase: GamePhase;
  currentTeam: Team;
  startingTeam: Exclude<Team, 'none'>;
  turnNumber: number;
  mode: RoomMode;
  seed: number | null;
  maxHintCount: number | null;
  phaseTimer: PhaseTimer | null;
  hint: HintView | null;
  guessesRemaining: number | null;
  remaining: {
    red: number;
    blue: number;
  };
  winner: Team | null;
  loser: Team | null;
  reason: string | null;
  showKeycard: boolean;
  history: GameHistoryEntry[];
  board: BoardCard[];
}

export interface Snapshot {
  now: number;
  room: RoomView;
  me: MeView;
  players: PlayerView[];
  game: GameView | null;
}

export interface AckSuccess<T = Record<string, unknown>> extends T {
  ok: true;
}

export interface AckFailure {
  ok: false;
  error: string;
}

export type AckResponse<T = Record<string, unknown>> = AckSuccess<T> | AckFailure;

export interface TurnCredentialsResponse {
  iceServers: RTCIceServer[];
}

export interface ToastState {
  message: string;
  type: '' | 'success' | 'error' | 'info';
  visible: boolean;
}

export interface VoicePeerEntry {
  sessionId: string;
  volume: number;
}
