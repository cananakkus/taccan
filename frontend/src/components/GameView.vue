<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { generateDebriefNarrative } from '../lib/debrief';
import {
  canGuess,
  canHint,
  canHostRematch,
  canMark,
  formatTimerRemaining,
  getCurrentMaxHintCount,
  getPhaseTimerRemainingMs,
  getPlayerName,
  getReadinessIssue,
  getTeamPlayers,
  truncateMarkerName,
} from '../lib/game-helpers';
import { renderQRCode } from '../lib/qrcode';
import { getAssetPath, getInitialRoomCode, getRoomUrl, getServiceWorkerPath } from '../lib/runtime';
import { emitWithAck, socket } from '../lib/socket';
import { playSound, toggleSoundMute } from '../lib/sound';
import { DEFAULT_LANGUAGE, formatCardWord, getLocaleTag, translate } from '../lib/translations';
import { clearSession } from '../lib/storage';
import { renderRoomSeal } from '../lib/room-seal';
import { useVoice } from '../composables/useVoice';
import { useAppStore } from '../stores/app';
import { usePreferencesStore } from '../stores/preferences';
import { useUiStore } from '../stores/ui';
import { useVoiceStore } from '../stores/voice';
import type {
  BoardCard,
  CardMark,
  ChatMessage,
  GameHistoryEntry,
  PlayerView,
  Snapshot,
  Team,
} from '../types';

const SCENE_CLASSES = [
  'scene-lobby',
  'scene-hint-red',
  'scene-hint-blue',
  'scene-guess-red',
  'scene-guess-blue',
  'scene-finished',
];

const STAMP_PATHS = Object.freeze({
  red: 'M12 76 L33 62 L49 49 L62 44 L57 56 L60 67 L80 58 L107 72 L82 73 L66 85 L53 79 L37 84 Z',
  blue:
    'M31 88 C24 64 34 43 59 39 C84 43 95 64 87 88 C79 76 71 71 59 71 C47 71 39 76 31 88 Z M49 60 A5 5 0 1 0 49 50 A5 5 0 1 0 49 60 Z M69 60 A5 5 0 1 0 69 50 A5 5 0 1 0 69 60 Z',
  assassin: 'M12 83 L30 58 L51 43 L72 39 L58 57 L99 53 L76 68 L90 87 L57 79 L34 91 Z',
});

const SERVER_ERROR_MAP: Record<string, string> = {
  'Hint word is required.': 'hint_word_required',
  'Your hint cannot be a word on the board.': 'hint_on_board',
  'Room not found.': 'room_not_found',
};

const PANEL_KEYS = ['teams', 'feed', 'settings', 'debrief'] as const;

const app = useAppStore();
const preferences = usePreferencesStore();
const ui = useUiStore();
const voice = useVoiceStore();

const nameInput = ref(app.session?.name || '');
const codeInput = ref(getInitialRoomCode() || app.session?.code || '');
const hintWordInput = ref('');
const hintCountInput = ref(1);
const chatInput = ref('');
const blitzHintSec = ref(25);
const blitzGuessSec = ref(35);
const nowTick = ref(Date.now());
const boardRefs = ref<(HTMLButtonElement | null)[]>([]);
const audioContainer = ref<HTMLElement | null>(null);
const spymasterSelectedIndexes = ref<number[]>([]);
let liveTimer: number | null = null;

const snapshot = computed(() => app.snapshot);
const game = computed(() => snapshot.value?.game || null);
const room = computed(() => snapshot.value?.room || null);
const me = computed(() => snapshot.value?.me || null);
const players = computed(() => snapshot.value?.players || []);
const canHintNow = computed(() => canHint(snapshot.value));
const canGuessNow = computed(() => canGuess(snapshot.value));
const currentMaxHintCount = computed(() => getCurrentMaxHintCount(snapshot.value));
const readinessIssue = computed(() => getReadinessIssue(snapshot.value, (key) => t(key)));
const redPlayers = computed(() => getTeamPlayers(players.value, 'red'));
const bluePlayers = computed(() => getTeamPlayers(players.value, 'blue'));
const roomMode = computed(() => room.value?.mode || 'casual');
const displayBoard = computed<BoardCard[]>(() => {
  if (game.value?.board?.length) return game.value.board;
  return Array.from({ length: 25 }, (_value, index) => ({
    index,
    word: '',
    revealed: false,
    revealedBy: null,
    color: null,
    marks: [],
  }));
});
const activeMatch = computed(() => room.value?.match || null);
const phaseTimerRemainingMs = computed(() => {
  nowTick.value;
  return getPhaseTimerRemainingMs(game.value);
});
const phaseTimerLabel = computed(() => {
  if (game.value?.phaseTimer?.phase === 'hint') return t('phase_timer_hint');
  if (game.value?.phaseTimer?.phase === 'guess') return t('phase_timer_guess');
  return '';
});
const selectedGuessCard = computed(() => {
  if (!game.value || ui.selectedGuessIndex === null) return null;
  return game.value.board[ui.selectedGuessIndex] || null;
});
const guessLabel = computed(() => {
  if (!canGuessNow.value) return t('no_card_selected');
  if (!selectedGuessCard.value || selectedGuessCard.value.revealed) return t('select_card_then_submit');
  return t('selected_card', { word: formatCardWord(preferences.language, selectedGuessCard.value.word) });
});
const roundLabel = computed(() => {
  if (!game.value?.roundNumber) return '';
  return t('round_prefix', { round: game.value.roundNumber });
});
const turnBannerText = computed(() => {
  if (!game.value) return t('lobby_open');
  if (game.value.phase === 'finished') {
    return t('game_over_banner', {
      round: roundLabel.value,
      team: formatTeam(game.value.winner),
    });
  }
  if (game.value.phase === 'hint') {
    return t('turn_spymaster_choosing', { team: formatTeam(game.value.currentTeam) });
  }
  return t('turn_operatives_guessing', { team: formatTeam(game.value.currentTeam) });
});
const debriefHtml = computed(() => {
  if (!game.value) return `<p>${t('debrief_no_data')}</p>`;
  return generateDebriefNarrative((key, vars) => t(key, vars), game.value.history, players.value, game.value.board);
});
const qrCodeSvg = computed(() => (room.value ? renderQRCode(getRoomUrl(room.value.code)) : ''));
const roomSealSvg = computed(() => (room.value ? renderRoomSeal(room.value.code) : ''));
const voicePeerRows = computed(() => {
  const rows: Array<{ sessionId: string; name: string; isSelf: boolean; volume: number; muted: boolean }> = [];
  if (me.value) {
    rows.push({
      sessionId: me.value.sessionId,
      name: `${me.value.name} ${t('you_suffix')}`,
      isSelf: true,
      volume: 100,
      muted: voice.muted,
    });
  }
  for (const peer of voice.peers) {
    rows.push({
      sessionId: peer.sessionId,
      name: getPlayerName(players.value, peer.sessionId, peer.sessionId),
      isSelf: false,
      volume: peer.volume,
      muted: voice.mutedPeerIds.includes(peer.sessionId),
    });
  }
  return rows;
});
const feedItems = computed(() => {
  const items: Array<{ key: string; className: string; text: string }> = [];
  const merged: Array<{ ts: number; kind: 'chat' | 'game'; entry: ChatMessage | GameHistoryEntry }> = [];
  for (const message of room.value?.chatMessages || []) {
    merged.push({ ts: message.ts || 0, kind: 'chat', entry: message });
  }
  for (const entry of game.value?.history || []) {
    const eventType = String((entry as { type?: string }).type || '');
    if (eventType === 'mark_toggle') continue;
    merged.push({
      ts: Number((entry as { at?: number; endedAt?: number }).at || (entry as { endedAt?: number }).endedAt || 0),
      kind: 'game',
      entry,
    });
  }
  merged.sort((a, b) => a.ts - b.ts);

  for (const item of merged) {
    if (item.kind === 'chat') {
      const message = item.entry as ChatMessage;
      items.push({
        key: `chat-${message.ts}-${message.sessionId}`,
        className: `feed-item feed-chat ${message.team || ''}`,
        text: `${message.name}: ${message.text}`,
      });
      continue;
    }

    const entry = item.entry as Record<string, unknown>;
    const type = String(entry.type || '');
    if (type === 'hint') {
      items.push({
        key: `hint-${entry.at}-${entry.by}`,
        className: `feed-item feed-hint ${String(entry.team || '')}`,
        text: `${formatTeam(String(entry.team || '') as Team)}: ${String(entry.word || '').toLocaleUpperCase(getLocaleTag(preferences.language))} ${entry.count}`,
      });
    } else if (type === 'guess') {
      const card = game.value?.board?.[Number(entry.index)];
      const word = card ? formatCardWord(preferences.language, card.word) : '?';
      const icon = entry.color === entry.team ? '\u2713' : '\u2717';
      items.push({
        key: `guess-${entry.at}-${entry.index}`,
        className: `feed-item feed-guess ${String(entry.team || '')}`,
        text: `${icon} ${word}`,
      });
    } else if (type === 'turn_end') {
      items.push({
        key: `turn-end-${entry.endedAt}`,
        className: 'feed-item feed-turnend',
        text: t('feed_turn_ended'),
      });
    } else if (type === 'game_end') {
      items.push({
        key: `game-end-${entry.at}`,
        className: 'feed-item feed-gameend',
        text: t('feed_game_over', { team: formatTeam(String(entry.winner || '') as Team) }),
      });
    }
  }
  return items;
});

const { joining, joinVoice, leaveVoice, toggleMute, toggleNoiseSuppression, setPeerVolume } = useVoice(
  players,
  computed(() => me.value?.sessionId || null),
  audioContainer,
  t
);

function t(key: string, vars: Record<string, string | number> = {}) {
  return translate(preferences.language || DEFAULT_LANGUAGE, key, vars);
}

function translateServerError(message: string) {
  const key = SERVER_ERROR_MAP[message];
  return key ? t(key) : message;
}

function formatTeam(team: Team | string | null | undefined): string {
  if (team === 'red') return t('team_red');
  if (team === 'blue') return t('team_blue');
  return t('team_unknown');
}

function formatRole(role: string): string {
  if (role === 'spymaster') return t('spymaster');
  if (role === 'operative') return t('operative');
  if (role === 'spectator') return t('spectator');
  return role;
}

function teamListEmptyLabel(team: 'red' | 'blue') {
  return team === 'red' ? t('no_red_agents') : t('no_blue_agents');
}

function hintStatusText() {
  if (canHintNow.value) return t('hint_status_your_turn');
  if (game.value?.phase === 'finished') return t('hint_status_game_finished');
  if (game.value?.phase !== 'hint') return t('hint_status_operatives_guessing', { team: formatTeam(game.value?.currentTeam) });
  return t('hint_status_spymaster_locked', { team: formatTeam(game.value?.currentTeam) });
}

function guessNoteText() {
  if (canGuessNow.value) return t('guess_note_active');
  if (game.value?.phase === 'finished') return t('guess_note_finished');
  if (game.value?.phase !== 'guess') return t('guess_note_waiting');
  return t('guess_note_restricted');
}

function hintDisplayText() {
  if (!game.value?.hint) return t('awaiting_hint');
  return t('hint_display', {
    word: String(game.value.hint.word || '').toLocaleUpperCase(getLocaleTag(preferences.language)),
    count: game.value.hint.count,
    remaining: game.value.guessesRemaining === null ? t('unlimited') : String(Math.max(game.value.guessesRemaining, 0)),
  });
}

function resultText() {
  if (!game.value) return '';
  if (game.value.reason === 'assassin') return t('result_assassin', { loser: formatTeam(game.value.loser) });
  if (game.value.reason === 'all_agents_revealed') return t('result_all_agents', { winner: formatTeam(game.value.winner) });
  if (game.value.reason === 'opponent_agents_revealed') return t('result_opponent_agents', { winner: formatTeam(game.value.winner) });
  return t('result_generic', { winner: formatTeam(game.value.winner) });
}

function scoreBarWidth(team: 'red' | 'blue') {
  if (!game.value) return '0%';
  const redTotal = game.value.startingTeam === 'red' ? 9 : 8;
  const blueTotal = game.value.startingTeam === 'blue' ? 9 : 8;
  const total = redTotal + blueTotal;
  const found = team === 'red' ? redTotal - game.value.remaining.red : blueTotal - game.value.remaining.blue;
  return `${(found / total) * 100}%`;
}

function getBoardCardClasses(card: BoardCard) {
  const keycardColor = !card.revealed ? card.color : null;
  const privateSelected = spymasterSelectedIndexes.value.includes(card.index);
  return {
    card: true,
    revealed: card.revealed,
    red: card.color === 'red',
    blue: card.color === 'blue',
    neutral: card.color === 'neutral',
    assassin: card.color === 'assassin',
    keycard: !card.revealed && Boolean(card.color),
    marked: !card.revealed && card.marks.length > 0,
    clickable: !card.revealed && (canGuessNow.value || isSpymasterSelectionEnabled(card)),
    'selected-for-guess': !card.revealed && ui.selectedGuessIndex === card.index && canGuessNow.value,
    'finished-reveal': !card.revealed && game.value?.phase === 'finished' && Boolean(card.color),
    'spymaster-selected': privateSelected && !!keycardColor,
    placeholder: !game.value,
  };
}

function getCardLabel(card: BoardCard) {
  const revealedLabel = card.revealed ? t('card_revealed') : t('card_unrevealed');
  const colorLabel = card.revealed || (card.color && me.value?.role === 'spymaster') ? card.color || '' : '';
  return `${t('card')} ${card.index + 1}: ${formatCardWord(preferences.language, card.word)}, ${revealedLabel}${colorLabel ? `, ${colorLabel}` : ''}`;
}

function markerTitle(marks: CardMark[]) {
  return marks.length ? t('marked_by', { names: marks.map((mark) => mark.name).join(', ') }) : '';
}

function isSpymasterSelectionEnabled(card: BoardCard) {
  return Boolean(
    game.value &&
      me.value?.role === 'spymaster' &&
      game.value.phase === 'hint' &&
      !card.revealed
  );
}

function toggleSpymasterSelection(card: BoardCard) {
  if (!isSpymasterSelectionEnabled(card)) return;
  const next = new Set(spymasterSelectedIndexes.value);
  if (next.has(card.index)) next.delete(card.index);
  else next.add(card.index);
  spymasterSelectedIndexes.value = [...next].sort((a, b) => a - b);
  hintCountInput.value = Math.min(spymasterSelectedIndexes.value.length, currentMaxHintCount.value ?? 50);
}

function stampSvg(color: string | null) {
  if (!color) return '';
  if (color === 'neutral') return '<span class="card-stamp stamp-neutral-x"></span>';
  const path = STAMP_PATHS[color as keyof typeof STAMP_PATHS];
  if (!path) return '';
  const className =
    color === 'red' ? 'stamp-red-bird' : color === 'blue' ? 'stamp-blue-bird' : 'stamp-assassin-bird';
  return `<span class="card-stamp ${className}"><svg viewBox="0 0 120 120" aria-hidden="true"><path d="${path}"></path></svg></span>`;
}

function roleTeamSelected(team: Team, role: string) {
  return me.value?.team === team && me.value?.role === role;
}

function playerIsSpeaking(sessionId: string) {
  return voice.speakingIds.includes(sessionId);
}

function playerHasMarks(player: PlayerView) {
  if (!game.value || game.value.phase !== 'guess' || player.role !== 'operative' || player.team !== game.value.currentTeam) {
    return false;
  }
  return game.value.board.some((card) => !card.revealed && card.marks.some((mark) => mark.sessionId === player.sessionId));
}

function boardWord(card: BoardCard) {
  return formatCardWord(preferences.language, card.word);
}

function syncSceneClasses() {
  const body = document.body;
  body.classList.toggle('colorblind-mode', preferences.colorblindMode);
  body.classList.toggle('theatrical-mode', new URLSearchParams(window.location.search).get('theater') === '1');
  body.classList.remove(...SCENE_CLASSES);
  if (!game.value) {
    body.classList.add('scene-lobby');
    return;
  }
  if (game.value.phase === 'finished') {
    body.classList.add('scene-finished');
    return;
  }
  body.classList.add(`scene-${game.value.phase}-${game.value.currentTeam}`);
}

function syncDocumentLanguage() {
  document.documentElement.lang = preferences.language === 'tr' ? 'tr' : 'en';
}

function setConnection(connected: boolean) {
  app.setConnection(connected, connected ? t('connected') : t('disconnected'));
}

async function tryAutoRejoin() {
  if (app.rejoinAttempted || !app.session) return;
  app.rejoinAttempted = true;

  nameInput.value = app.session.name || '';
  codeInput.value = getInitialRoomCode() || app.session.code || '';

  try {
    await emitWithAck('room:rejoin', {
      code: codeInput.value,
      sessionId: app.session.sessionId,
      name: app.session.name,
    });
  } catch (_error) {
    app.clearSession();
  }
}

function announceTurnChange(nextSnapshot: Snapshot) {
  const isMyTurn = canHint(nextSnapshot) || canGuess(nextSnapshot);
  if (isMyTurn && !app.previousIsMyTurn) {
    playSound('yourTurn');
  }
  app.previousIsMyTurn = isMyTurn;
}

function handleSnapshot(nextSnapshot: Snapshot) {
  announceTurnChange(nextSnapshot);

  const previousRevealed = new Set(game.value?.board.filter((card) => card.revealed).map((card) => card.index) || []);
  app.setSnapshot(nextSnapshot);
  if (ui.selectedGuessIndex !== null) {
    const selected = nextSnapshot.game?.board?.[ui.selectedGuessIndex];
    if (!selected || selected.revealed) ui.selectedGuessIndex = null;
  }

  if (nextSnapshot.room.mode === 'blitz') {
    blitzHintSec.value = Math.round(Number(nextSnapshot.room.modeConfig?.hintTimerMs || 25_000) / 1000);
    blitzGuessSec.value = Math.round(Number(nextSnapshot.room.modeConfig?.guessTimerMs || 35_000) / 1000);
  }

  for (const card of nextSnapshot.game?.board || []) {
    if (card.revealed && !previousRevealed.has(card.index)) {
      playSound('cardFlip');
    }
  }
}

socket.on('connect', async () => {
  setConnection(true);
  if (app.wasDisconnected) {
    ui.showToast(t('reconnected'), 'success');
    app.wasDisconnected = false;
  }
  await tryAutoRejoin();
});

socket.on('disconnect', () => {
  app.wasDisconnected = true;
  setConnection(false);
});

socket.on('connect_error', () => {
  app.setConnection(false, t('connection_error'));
});

socket.on('state:full', (nextSnapshot: Snapshot) => {
  handleSnapshot(nextSnapshot);
});

socket.on('error:rule_violation', (payload: { message?: string }) => {
  ui.showToast(payload.message || t('action_rejected'), 'error');
});

socket.on('server:info', (payload: { message?: string }) => {
  if (payload.message) ui.showToast(payload.message);
});

socket.on('turn:timer_started', (payload: { phase?: string }) => {
  if (payload.phase === 'hint') ui.showToast(t('hint_timer_started'));
  if (payload.phase === 'guess') ui.showToast(t('guess_timer_started'));
});

socket.on('turn:timer_expired', (payload: { phase?: string }) => {
  if (payload.phase === 'hint') ui.showToast(t('hint_timer_expired'));
  if (payload.phase === 'guess') ui.showToast(t('guess_timer_expired'));
});

socket.on('turn:guess_resolved', (payload: { color?: string; team?: Team }) => {
  if (payload.color === 'assassin') playSound('assassin');
  else if (payload.color === payload.team) playSound('correct');
  else playSound('reveal');
});

socket.on('game:gg_received', (payload: { name?: string }) => {
  ui.showToast(t('gg_received', { name: payload.name || t('anonymous') }));
  playSound('gg');
});

socket.on('chat:message', (message: ChatMessage) => {
  if (!app.snapshot) return;
  app.snapshot.room.chatMessages.push(message);
});

socket.on('turn:mark_update', (payload: { index: number; marks: CardMark[] }) => {
  const card = app.snapshot?.game?.board?.[payload.index];
  if (card) {
    card.marks = payload.marks;
  }
});

socket.on('game:mvp_result', (payload: { winner?: { name?: string } }) => {
  if (payload.winner?.name) {
    ui.showToast(t('mvp_winner', { name: payload.winner.name }), 'success');
  }
});

function setBoardRef(index: number, el: HTMLButtonElement | null) {
  boardRefs.value[index] = el;
}

function syncInputDefaults() {
  if (!game.value?.maxHintCount) return;
  if (hintCountInput.value > game.value.maxHintCount) {
    hintCountInput.value = game.value.maxHintCount;
  }
}

async function createRoom() {
  if (!nameInput.value.trim()) {
    ui.showToast(t('enter_name_create'));
    return;
  }
  try {
    const response = await emitWithAck<{ roomCode: string }>('room:create', { name: nameInput.value.trim() });
    codeInput.value = response.roomCode;
  } catch (error) {
    ui.showToast(error instanceof Error ? error.message : 'Create failed', 'error');
  }
}

async function joinRoom() {
  if (!nameInput.value.trim()) {
    ui.showToast(t('enter_name_join'));
    return;
  }
  if (!codeInput.value.trim()) {
    ui.showToast(t('enter_room_code'));
    return;
  }
  try {
    const response = await emitWithAck<{ roomCode: string }>('room:join', {
      code: codeInput.value.trim().toUpperCase(),
      name: nameInput.value.trim(),
    });
    codeInput.value = response.roomCode;
  } catch (error) {
    ui.showToast(translateServerError(error instanceof Error ? error.message : 'Join failed'), 'error');
  }
}

async function leaveRoom() {
  const confirmed = await ui.confirm(t('confirm_leave'));
  if (!confirmed) return;
  leaveVoice();
  await emitWithAck('room:leave', {}).catch(() => {});
  app.clearSnapshot();
  app.clearSession();
  clearSession();
  ui.closePanel();
}

async function setTeam(team: Team) {
  if (!snapshot.value) {
    ui.showToast(t('join_create_first'));
    return;
  }
  try {
    await emitWithAck('team:set', { team });
  } catch (error) {
    ui.showToast(error instanceof Error ? error.message : 'Team update failed', 'error');
  }
}

async function setRole(role: 'spymaster' | 'operative' | 'spectator', roleTeam?: Team) {
  if (!snapshot.value) {
    ui.showToast(t('join_create_first'));
    return;
  }

  try {
    if (roleTeam && me.value?.team !== roleTeam) {
      await emitWithAck('team:set', { team: roleTeam });
    }
    await emitWithAck('role:set', { role });
  } catch (error) {
    ui.showToast(error instanceof Error ? error.message : 'Role update failed', 'error');
  }
}

async function setMode(mode: 'casual' | 'blitz') {
  if (!snapshot.value?.me.isHost) {
    ui.showToast(t('host_only_mode_change'));
    return;
  }
  if (snapshot.value.game && snapshot.value.game.phase !== 'finished') {
    ui.showToast(t('mode_lobby_only'));
    return;
  }
  await emitWithAck('room:mode_set', { mode }).catch((error: Error) => ui.showToast(error.message, 'error'));
}

async function sendBlitzConfig() {
  if (!snapshot.value?.me.isHost) return;
  await emitWithAck('room:blitz_config', {
    hintTimerSec: Math.max(5, Math.min(300, Number(blitzHintSec.value) || 25)),
    guessTimerSec: Math.max(5, Math.min(300, Number(blitzGuessSec.value) || 35)),
  }).catch(() => {});
}

async function startGame() {
  await emitWithAck('game:start', {}).catch((error: Error) => ui.showToast(error.message, 'error'));
}

async function rematch(mode: 'same_teams' | 'swap_teams') {
  await emitWithAck('game:rematch', { mode }).catch((error: Error) => ui.showToast(error.message, 'error'));
}

async function pruneDisconnected() {
  const confirmed = await ui.confirm(t('confirm_prune'));
  if (!confirmed) return;
  try {
    const response = await emitWithAck<{ removedCount?: number }>('room:prune_disconnected', {});
    const removed = Number(response.removedCount || 0);
    ui.showToast(removed > 0 ? t('removed_offline', { count: removed }) : t('no_offline_players'), 'success');
  } catch (error) {
    ui.showToast(error instanceof Error ? error.message : 'Prune failed', 'error');
  }
}

async function submitHint() {
  if (!hintWordInput.value.trim()) {
    ui.showToast(t('hint_word_required'));
    return;
  }
  const count = Number(hintCountInput.value);
  if (!Number.isInteger(count) || count < 0 || (currentMaxHintCount.value !== null && count > currentMaxHintCount.value)) {
    ui.showToast(t('hint_count_range', { max: currentMaxHintCount.value ?? 50 }), 'error');
    return;
  }
  try {
    await emitWithAck('turn:hint_submit', { word: hintWordInput.value.trim(), count });
    hintWordInput.value = '';
    hintCountInput.value = 1;
    spymasterSelectedIndexes.value = [];
  } catch (error) {
    ui.showToast(translateServerError(error instanceof Error ? error.message : 'Hint failed'), 'error');
  }
}

function optimisticToggleMark(card: BoardCard) {
  if (!snapshot.value) return;
  const marks = [...card.marks];
  const myId = snapshot.value.me.sessionId;
  const existingIndex = marks.findIndex((mark) => mark.sessionId === myId);
  if (existingIndex >= 0) {
    marks.splice(existingIndex, 1);
  } else {
    marks.push({
      sessionId: myId,
      name: snapshot.value.me.name,
      team: snapshot.value.me.team,
      confidence: 'firm',
    });
  }
  card.marks = marks;
}

async function toggleMark(card: BoardCard) {
  if (!canMark(snapshot.value, card)) return;
  optimisticToggleMark(card);
  playSound('mark');
  await emitWithAck('turn:mark_toggle', { index: card.index }).catch((error: Error) => {
    ui.showToast(error.message, 'error');
  });
}

async function setMarkConfidence(card: BoardCard, confidence: 'firm' | 'tentative') {
  if (!snapshot.value || !canMark(snapshot.value, card)) return;
  const existing = card.marks.find((mark) => mark.sessionId === snapshot.value?.me.sessionId);
  if (!existing) return;
  existing.confidence = confidence;
  await emitWithAck('turn:mark_confidence', { index: card.index, confidence }).catch((error: Error) => {
    ui.showToast(error.message, 'error');
  });
}

function selectGuess(index: number) {
  ui.selectedGuessIndex = index;
}

async function submitGuess(index = ui.selectedGuessIndex) {
  if (!Number.isInteger(index)) return;
  try {
    await emitWithAck('turn:guess', { index });
    ui.selectedGuessIndex = null;
  } catch (error) {
    ui.showToast(error instanceof Error ? error.message : 'Guess failed', 'error');
  }
}

async function endTurn() {
  const confirmed = await ui.confirm(t('confirm_end_turn'));
  if (!confirmed) return;
  await emitWithAck('turn:end', {}).catch((error: Error) => ui.showToast(error.message, 'error'));
}

async function sendGG() {
  await emitWithAck('game:gg', {}).catch((error: Error) => ui.showToast(error.message, 'error'));
}

async function loadWordPack() {
  const input = document.getElementById('word-pack-input') as HTMLInputElement | null;
  const url = input?.value.trim() || '';
  if (!url) return;
  await emitWithAck('room:word_pack_set', { url })
    .then(() => ui.showToast(t('word_pack_loaded', { count: '' }), 'success'))
    .catch((error: Error) => ui.showToast(error.message, 'error'));
}

async function sendChat() {
  if (!chatInput.value.trim()) return;
  try {
    await emitWithAck('chat:send', { text: chatInput.value.trim() });
    chatInput.value = '';
  } catch (error) {
    ui.showToast(error instanceof Error ? error.message : 'Chat failed', 'error');
  }
}

function copyRoomCode() {
  if (!room.value) return;
  void navigator.clipboard
    .writeText(room.value.code)
    .then(() => ui.showToast(t('room_code_copied'), 'success'))
    .catch(() => ui.showToast(t('copy_failed'), 'error'));
}

function handleBoardKeydown(event: KeyboardEvent, index: number) {
  const col = index % 5;
  const row = Math.floor(index / 5);
  let nextIndex = -1;

  switch (event.key) {
    case 'ArrowUp':
      if (row > 0) nextIndex = (row - 1) * 5 + col;
      break;
    case 'ArrowDown':
      if (row < 4) nextIndex = (row + 1) * 5 + col;
      break;
    case 'ArrowLeft':
      if (col > 0) nextIndex = row * 5 + col - 1;
      break;
    case 'ArrowRight':
      if (col < 4) nextIndex = row * 5 + col + 1;
      break;
    case 'Home':
      nextIndex = row * 5;
      break;
    case 'End':
      nextIndex = row * 5 + 4;
      break;
    default:
      return;
  }

  if (nextIndex >= 0) {
    event.preventDefault();
    boardRefs.value[nextIndex]?.focus();
  }
}

function handleCardClick(card: BoardCard) {
  if (!game.value) return;
  if (canGuessNow.value && !card.revealed) {
    selectGuess(card.index);
    void toggleMark(card);
    return;
  }
  toggleSpymasterSelection(card);
}

watch(
  () => preferences.language,
  () => {
    syncDocumentLanguage();
    setConnection(socket.connected);
  },
  { immediate: true }
);

watch(
  () => [preferences.colorblindMode, game.value?.phase, game.value?.currentTeam, new URLSearchParams(window.location.search).get('theater')],
  () => syncSceneClasses(),
  { immediate: true }
);

watch(
  () => room.value?.modeConfig,
  () => {
    if (room.value?.mode === 'blitz') {
      blitzHintSec.value = Math.round(Number(room.value.modeConfig?.hintTimerMs || 25_000) / 1000);
      blitzGuessSec.value = Math.round(Number(room.value.modeConfig?.guessTimerMs || 35_000) / 1000);
    }
  },
  { immediate: true }
);

watch(game, () => syncInputDefaults(), { immediate: true });
watch(
  () => [game.value?.id, game.value?.phase, game.value?.currentTeam],
  () => {
    spymasterSelectedIndexes.value = [];
    if (!game.value) {
      ui.selectedGuessIndex = null;
    }
  }
);

onMounted(() => {
  preferences.initialize();
  syncDocumentLanguage();
  syncSceneClasses();
  if (me.value) nameInput.value = me.value.name;
  codeInput.value = getInitialRoomCode() || codeInput.value;
  liveTimer = window.setInterval(() => {
    nowTick.value = Date.now();
  }, 250);

  const worker = getServiceWorkerPath();
  if ('serviceWorker' in navigator) {
    void navigator.serviceWorker.register(worker.path, { scope: worker.scope }).catch(() => {});
  }
});

onBeforeUnmount(() => {
  if (liveTimer) {
    window.clearInterval(liveTimer);
    liveTimer = null;
  }
});
</script>

<template>
  <div>
    <div id="sr-announcements" class="sr-only" aria-live="assertive" role="log"></div>

    <main class="app-shell">
      <section id="join-panel" class="join-screen" :class="{ hidden: !!snapshot }">
        <div class="join-card">
          <div class="dossier-stamp" aria-hidden="true">CLASSIFIED</div>
          <div class="fold-line fold-line-h" aria-hidden="true"></div>
          <div class="fold-line fold-line-v" aria-hidden="true"></div>

          <header class="join-header">
            <div class="document-number" aria-hidden="true">DOC. NO. TC-4782</div>
            <h1 class="logo-title">TACCAN</h1>
            <div class="logo-rule" aria-hidden="true"></div>
            <p class="join-subtitle">{{ t('join_subtitle') }}</p>
          </header>

          <div class="join-form">
            <label class="field-group">
              <span class="field-label">{{ t('display_name') }}</span>
              <input v-model="nameInput" type="text" maxlength="24" :placeholder="t('display_name_placeholder')" autocomplete="off" />
            </label>

            <label class="field-group">
              <span class="field-label">{{ t('room_code') }}</span>
              <div class="join-row">
                <input
                  v-model="codeInput"
                  type="text"
                  maxlength="4"
                  :placeholder="t('room_code_placeholder')"
                  autocomplete="off"
                  class="code-field"
                />
                <button id="join-btn" class="btn btn-secondary" type="button" @click="joinRoom">{{ t('join_room') }}</button>
              </div>
            </label>

            <div class="join-actions">
              <button id="create-btn" class="btn btn-primary btn-lg" type="button" @click="createRoom">{{ t('create_room') }}</button>
            </div>

            <p id="join-note" class="join-note">{{ t('join_note_default') }}</p>
          </div>

          <footer class="join-footer">
            <div class="language-switch" role="group" aria-label="Language">
              <button class="lang-btn" type="button" :class="{ active: preferences.language === 'en' }" @click="preferences.setLanguage('en')">
                {{ t('language_en') }}
              </button>
              <button class="lang-btn" type="button" :class="{ active: preferences.language === 'tr' }" @click="preferences.setLanguage('tr')">
                {{ t('language_tr') }}
              </button>
            </div>
          </footer>
        </div>
      </section>

      <section id="room-panel" class="room-screen" :class="{ hidden: !snapshot }">
        <div class="top-bar">
          <div id="score-bar" class="score-bar">
            <div id="score-bar-red" class="score-bar-red" :style="{ width: scoreBarWidth('red') }"></div>
            <div class="score-bar-gap"></div>
            <div id="score-bar-blue" class="score-bar-blue" :style="{ width: scoreBarWidth('blue') }"></div>
          </div>
        </div>

        <div class="game-stage">
          <div class="stage-layout">
            <div class="board-area">
              <div class="board-wrap">
                <div id="board" class="board" role="grid" aria-label="Game board">
                  <button
                    v-for="(card, index) in displayBoard"
                    :key="card.index"
                    :ref="(el) => setBoardRef(index, el as HTMLButtonElement | null)"
                    type="button"
                    :class="getBoardCardClasses(card)"
                    :tabindex="index === 0 ? 0 : -1"
                    :disabled="!game || (!canGuessNow && !isSpymasterSelectionEnabled(card))"
                    :title="markerTitle(card.marks)"
                    :aria-label="getCardLabel(card)"
                    @click="() => handleCardClick(card)"
                    @dblclick="() => { if (canGuessNow && !card.revealed) void submitGuess(card.index); }"
                    @keydown="(event) => handleBoardKeydown(event as KeyboardEvent, index)"
                  >
                    <div class="card-inner">
                      <div class="card-front">
                        <span class="card-word">{{ boardWord(card) }}</span>
                      </div>
                      <div class="card-back">
                        <span class="card-word">{{ boardWord(card) }}</span>
                        <span class="card-stamp-slot" v-html="card.revealed ? stampSvg(card.color) : ''"></span>
                      </div>
                    </div>
                    <div class="card-markers">
                      <span
                        v-for="mark in card.marks"
                        :key="`${card.index}-${mark.sessionId}`"
                        class="card-marker"
                        :class="[mark.team === 'red' ? 'red' : mark.team === 'blue' ? 'blue' : 'neutral', mark.confidence === 'tentative' ? 'tentative' : '']"
                        :title="`${mark.name} (${formatTeam(mark.team)})`"
                        @contextmenu.prevent="() => void setMarkConfidence(card, mark.confidence === 'tentative' ? 'firm' : 'tentative')"
                      >
                        {{ truncateMarkerName(mark.name, t('anonymous')) }}
                      </span>
                    </div>
                  </button>
                </div>
              </div>
            </div>

            <div class="controls-strip">
              <div id="ctrl-placeholder" class="ctrl-panel ctrl-placeholder" :class="{ hidden: !!game }">{{ t('ctrl_placeholder') }}</div>

              <section id="hint-section" class="ctrl-panel hint-ctrl" :class="{ hidden: me?.role !== 'spymaster' || !game }">
                <div class="ctrl-head">
                  <h3>{{ t('spymaster_hint') }}</h3>
                  <span id="hint-status" class="ctrl-status">{{ hintStatusText() }}</span>
                </div>
                <form id="hint-form" class="hint-form" @submit.prevent="submitHint">
                  <input
                    v-model="hintWordInput"
                    id="hint-word-input"
                    type="text"
                    maxlength="30"
                    :placeholder="t('one_word')"
                    :disabled="!canHintNow"
                    autocomplete="off"
                  />
                  <div class="number-stepper">
                    <button type="button" class="stepper-btn stepper-btn-down" aria-label="Decrease" @click="hintCountInput = Math.max(0, Number(hintCountInput) - 1)">
                      &minus;
                    </button>
                    <input
                      id="hint-count-input"
                      v-model="hintCountInput"
                      type="number"
                      min="0"
                      :max="currentMaxHintCount ?? 50"
                      :disabled="!canHintNow"
                    />
                    <button
                      type="button"
                      class="stepper-btn stepper-btn-up"
                      aria-label="Increase"
                      @click="hintCountInput = Math.min(currentMaxHintCount ?? 50, Number(hintCountInput) + 1)"
                    >
                      +
                    </button>
                  </div>
                  <button class="btn btn-primary" type="submit" :disabled="!canHintNow">{{ t('transmit') }}</button>
                </form>
              </section>

              <section id="guess-section" class="ctrl-panel guess-ctrl" :class="{ hidden: me?.role !== 'operative' || !game }">
                <p id="hint-display" class="hint-display-bar">{{ hintDisplayText() }}</p>
                <p id="guess-note" class="ctrl-status">{{ guessNoteText() }}</p>
                <div class="guess-row">
                  <span id="selected-guess" class="selected-label">{{ guessLabel }}</span>
                  <button id="submit-guess-btn" class="btn btn-primary" type="button" :disabled="!selectedGuessCard || !canGuessNow" @click="() => void submitGuess()">
                    {{ t('submit_guess') }}
                  </button>
                  <button id="end-turn-btn" class="btn btn-ghost" type="button" :disabled="!canGuessNow" @click="() => void endTurn()">
                    {{ t('end_turn') }}
                  </button>
                </div>
              </section>

              <section id="result-section" class="ctrl-panel result-ctrl" :class="{ hidden: game?.phase !== 'finished' }">
                <p id="result-text" class="result-text">{{ resultText() }}</p>
                <div class="result-actions">
                  <button id="rematch-btn" class="btn btn-primary" type="button" :class="{ hidden: !canHostRematch(snapshot) }" @click="() => void rematch('same_teams')">
                    {{ t('rematch') }}
                  </button>
                  <button id="swap-rematch-btn" class="btn btn-secondary" type="button" :class="{ hidden: !canHostRematch(snapshot) }" @click="() => void rematch('swap_teams')">
                    {{ t('swap_rematch') }}
                  </button>
                  <button id="gg-btn" class="btn btn-ghost" type="button" @click="() => void sendGG()">{{ t('gg') }}</button>
                  <button id="debrief-btn" class="btn btn-ghost" type="button" @click="ui.togglePanel('debrief')">{{ t('debrief') }}</button>
                </div>
                <div id="mvp-section" class="mvp-section hidden"></div>
              </section>
            </div>
          </div>
        </div>

        <div class="bottom-bar-status">
          <div id="turn-banner" class="turn-banner" :class="{ red: game?.phase !== 'finished' && game?.currentTeam === 'red', blue: game?.phase !== 'finished' && game?.currentTeam === 'blue', finished: game?.phase === 'finished' }">
            {{ turnBannerText }}
          </div>
          <div
            id="phase-timer"
            class="phase-timer"
            :class="{
              hidden: !game?.phaseTimer || game?.phase === 'finished',
              'warning-10': phaseTimerRemainingMs <= 10000 && phaseTimerRemainingMs > 5000,
              'warning-5': phaseTimerRemainingMs <= 5000,
              hint: game?.phaseTimer?.phase === 'hint',
              guess: game?.phaseTimer?.phase === 'guess',
            }"
          >
            <span id="phase-timer-label" class="timer-label">{{ phaseTimerLabel }}</span>
            <span id="phase-timer-value" class="timer-value">{{ formatTimerRemaining(phaseTimerRemainingMs) }}</span>
          </div>
        </div>

        <div class="bottom-bar">
          <nav class="bar-tabs" aria-label="Panels">
            <div class="bar-util">
              <span id="room-code" class="room-code-val" title="Click to copy" @click="copyRoomCode">{{ room?.code || '----' }}</span>
              <span id="mode-badge" class="mode-tag" :class="{ blitz: roomMode === 'blitz' }">{{ roomMode === 'blitz' ? t('mode_blitz') : t('mode_casual') }}</span>
              <span id="connection-dot" class="conn-status" :class="{ online: app.connected, offline: !app.connected }">
                <span class="conn-dot"></span>
                <span class="conn-text">{{ app.connectionLabel }}</span>
              </span>
            </div>

            <div class="bar-tabs-center">
              <button
                v-for="panel in PANEL_KEYS"
                :key="panel"
                class="bar-tab"
                :class="{ active: ui.openPanel === panel, hidden: panel === 'debrief' && game?.phase !== 'finished' }"
                type="button"
                @click="ui.togglePanel(panel)"
              >
                <span class="bar-tab-icon" aria-hidden="true">{{ panel === 'teams' ? '⚐' : panel === 'feed' ? '☰' : panel === 'settings' ? '⚙' : '☷' }}</span>
                <span class="bar-tab-label">
                  {{ panel === 'teams' ? t('panel_teams') : panel === 'feed' ? t('panel_feed') : panel === 'settings' ? t('panel_settings') : t('debrief') }}
                </span>
              </button>

              <div class="voice-dropdown">
                <button id="voice-join-btn" class="bar-tab bar-tab-voice" type="button" :class="{ 'in-voice': voice.active }" @click="() => void joinVoice()">
                  <span class="bar-tab-icon" aria-hidden="true">♪</span>
                  <span class="bar-tab-label">{{ voice.active ? t('voice_leave') : t('voice_join') }}</span>
                </button>
                <div class="voice-dropdown-menu">
                  <button id="voice-mute-btn" class="btn btn-ghost btn-sm" type="button" :class="{ hidden: !voice.active, muted: voice.muted }" @click="toggleMute">
                    {{ voice.muted ? t('voice_unmute') : t('voice_mute') }}
                  </button>
                  <button id="voice-noise-btn" class="btn btn-ghost btn-sm" type="button" :class="{ hidden: !voice.active }" @click="() => void toggleNoiseSuppression()">
                    {{ preferences.noiseSuppression ? t('voice_noise_off') : t('voice_noise_on') }}
                  </button>
                  <div id="voice-peer-list" class="voice-peer-list">
                    <div v-for="peer in voicePeerRows" :key="peer.sessionId" class="voice-peer" :class="{ speaking: playerIsSpeaking(peer.sessionId) }">
                      <span class="voice-peer-name">{{ peer.name }}</span>
                      <span v-if="peer.muted" class="voice-peer-muted">{{ t('voice_muted_badge') }}</span>
                      <input
                        v-if="!peer.isSelf"
                        class="voice-volume-slider"
                        type="range"
                        min="0"
                        max="100"
                        :value="peer.volume"
                        @input="(event) => setPeerVolume(peer.sessionId, Number((event.target as HTMLInputElement).value))"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="bar-tabs-right">
              <button id="leave-room-btn" class="bar-tab bar-tab-leave" type="button" @click="() => void leaveRoom()">
                <span class="bar-tab-icon" aria-hidden="true">✕</span>
                <span class="bar-tab-label">{{ t('leave') }}</span>
              </button>
            </div>
          </nav>
        </div>

        <div id="sheet-container" class="sheet-container">
          <div id="sheet-backdrop" class="sheet-backdrop" :class="{ visible: !!ui.openPanel }" @click="ui.closePanel()"></div>

          <div class="sheet-panel" id="sheet-teams" data-sheet="teams" :class="{ 'sheet-open': ui.openPanel === 'teams' }">
            <div class="sheet-handle"></div>
            <div class="sheet-body">
              <h3 class="sheet-title">{{ t('panel_teams') }}</h3>

              <div class="team-panel team-red">
                <div class="team-head">
                  <span class="team-dot red"></span>
                  <h3>{{ t('red_team') }}</h3>
                </div>
                <ul id="red-team-list" class="player-list">
                  <li v-if="redPlayers.length === 0" class="team-empty">{{ teamListEmptyLabel('red') }}</li>
                  <li v-for="player in redPlayers" :key="player.sessionId" class="team-player-item" :class="{ speaking: playerIsSpeaking(player.sessionId) }">
                    <div class="team-player-info">
                      <div class="team-player-name">{{ player.sessionId === me?.sessionId ? `${player.name} ${t('you_suffix')}` : player.name }}</div>
                      <div class="player-meta">
                        <span class="tag">{{ formatRole(player.role) }}</span>
                        <span v-if="player.isHost" class="tag host">{{ t('tag_host') }}</span>
                        <span v-if="!player.connected" class="tag offline">{{ t('tag_offline') }}</span>
                        <span v-if="playerHasMarks(player)" class="tag thinking">...</span>
                        <span v-if="voice.peerIds.includes(player.sessionId) || (voice.active && player.sessionId === me?.sessionId)" class="tag" :class="voice.mutedPeerIds.includes(player.sessionId) || (player.sessionId === me?.sessionId && voice.muted) ? 'voice-muted' : 'voice'">
                          {{ voice.mutedPeerIds.includes(player.sessionId) || (player.sessionId === me?.sessionId && voice.muted) ? t('voice_muted_badge') : t('voice_tag') }}
                        </span>
                      </div>
                    </div>
                  </li>
                </ul>
                <div class="team-actions">
                  <div class="role-row">
                    <button class="btn btn-role red" type="button" :class="{ active: roleTeamSelected('red', 'spymaster') }" @click="() => void setRole('spymaster', 'red')">{{ t('spymaster') }}</button>
                    <button class="btn btn-role red" type="button" :class="{ active: roleTeamSelected('red', 'operative') }" @click="() => void setRole('operative', 'red')">{{ t('operative') }}</button>
                  </div>
                </div>
              </div>

              <div class="team-panel team-blue">
                <div class="team-head">
                  <span class="team-dot blue"></span>
                  <h3>{{ t('blue_team') }}</h3>
                </div>
                <ul id="blue-team-list" class="player-list">
                  <li v-if="bluePlayers.length === 0" class="team-empty">{{ teamListEmptyLabel('blue') }}</li>
                  <li v-for="player in bluePlayers" :key="player.sessionId" class="team-player-item" :class="{ speaking: playerIsSpeaking(player.sessionId) }">
                    <div class="team-player-info">
                      <div class="team-player-name">{{ player.sessionId === me?.sessionId ? `${player.name} ${t('you_suffix')}` : player.name }}</div>
                      <div class="player-meta">
                        <span class="tag">{{ formatRole(player.role) }}</span>
                        <span v-if="player.isHost" class="tag host">{{ t('tag_host') }}</span>
                        <span v-if="!player.connected" class="tag offline">{{ t('tag_offline') }}</span>
                        <span v-if="playerHasMarks(player)" class="tag thinking">...</span>
                        <span v-if="voice.peerIds.includes(player.sessionId) || (voice.active && player.sessionId === me?.sessionId)" class="tag" :class="voice.mutedPeerIds.includes(player.sessionId) || (player.sessionId === me?.sessionId && voice.muted) ? 'voice-muted' : 'voice'">
                          {{ voice.mutedPeerIds.includes(player.sessionId) || (player.sessionId === me?.sessionId && voice.muted) ? t('voice_muted_badge') : t('voice_tag') }}
                        </span>
                      </div>
                    </div>
                  </li>
                </ul>
                <div class="team-actions">
                  <div class="role-row">
                    <button class="btn btn-role blue" type="button" :class="{ active: roleTeamSelected('blue', 'spymaster') }" @click="() => void setRole('spymaster', 'blue')">{{ t('spymaster') }}</button>
                    <button class="btn btn-role blue" type="button" :class="{ active: roleTeamSelected('blue', 'operative') }" @click="() => void setRole('operative', 'blue')">{{ t('operative') }}</button>
                  </div>
                </div>
              </div>

              <div class="sidebar-actions">
                <button id="start-game-btn" class="btn btn-accent btn-lg" type="button" :class="{ hidden: !me?.isHost }" :disabled="!!readinessIssue || !!(game && game.phase !== 'finished')" @click="() => void startGame()">
                  {{ t('start_game') }}
                </button>
                <button class="btn btn-ghost spectator-btn" type="button" @click="() => void setRole('spectator')">{{ t('spectator') }}</button>
                <button id="prune-btn" class="btn btn-ghost btn-sm" type="button" :class="{ hidden: !me?.isHost }" @click="() => void pruneDisconnected()">
                  {{ t('prune_offline') }}
                </button>
              </div>
            </div>
          </div>

          <div class="sheet-panel" id="sheet-feed" data-sheet="feed" :class="{ 'sheet-open': ui.openPanel === 'feed' }">
            <div class="sheet-handle"></div>
            <div class="sheet-body">
              <h3 class="sheet-title">{{ t('panel_feed') }}</h3>
              <div id="feed-entries" class="feed-entries">
                <div v-if="feedItems.length === 0" class="feed-empty">{{ t('feed_empty') }}</div>
                <div v-for="item in feedItems" :key="item.key" :class="item.className">{{ item.text }}</div>
              </div>
              <form id="chat-form" class="chat-form" autocomplete="off" @submit.prevent="sendChat">
                <input id="chat-input" v-model="chatInput" type="text" maxlength="200" :placeholder="t('chat_placeholder')" />
                <button class="btn btn-ghost btn-sm" type="submit">{{ t('send') }}</button>
              </form>
            </div>
          </div>

          <div class="sheet-panel" id="sheet-settings" data-sheet="settings" :class="{ 'sheet-open': ui.openPanel === 'settings' }">
            <div class="sheet-handle"></div>
            <div class="sheet-body">
              <h3 class="sheet-title">{{ t('panel_settings') }}</h3>

              <div class="settings-block settings-block-meta">
                <div class="room-meta">
                  <div id="qr-code-container" class="qr-wrap" v-html="qrCodeSvg"></div>
                  <div id="room-seal-container" class="seal-wrap" v-html="roomSealSvg"></div>
                </div>
              </div>

              <div class="settings-block">
                <span class="settings-label">{{ t('mode') }}</span>
                <div class="mode-grid">
                  <button class="mode-btn" type="button" :class="{ active: roomMode === 'casual' }" :disabled="!me?.isHost || !!(game && game.phase !== 'finished')" @click="() => void setMode('casual')">
                    {{ t('mode_casual') }}
                  </button>
                  <button class="mode-btn" type="button" :class="{ active: roomMode === 'blitz' }" :disabled="!me?.isHost || !!(game && game.phase !== 'finished')" @click="() => void setMode('blitz')">
                    {{ t('mode_blitz') }}
                  </button>
                </div>
                <div id="blitz-config" class="blitz-config" :class="{ hidden: roomMode !== 'blitz' || !!(game && game.phase !== 'finished') }">
                  <label class="blitz-field">
                    <span>{{ t('blitz_hint_timer') }}</span>
                    <input id="blitz-hint-sec" v-model="blitzHintSec" type="number" min="5" max="300" class="input-sm" :disabled="!me?.isHost" @change="() => void sendBlitzConfig()" />
                    <span>s</span>
                  </label>
                  <label class="blitz-field">
                    <span>{{ t('blitz_guess_timer') }}</span>
                    <input id="blitz-guess-sec" v-model="blitzGuessSec" type="number" min="5" max="300" class="input-sm" :disabled="!me?.isHost" @change="() => void sendBlitzConfig()" />
                    <span>s</span>
                  </label>
                </div>
                <p id="mode-note" class="mode-note">
                  {{
                    roomMode === 'blitz'
                      ? t('mode_note_blitz', { hint: Math.round(Number(room?.modeConfig?.hintTimerMs || 25000) / 1000), guess: Math.round(Number(room?.modeConfig?.guessTimerMs || 35000) / 1000) })
                      : t('mode_note_casual')
                  }}
                </p>
              </div>

              <div class="settings-block">
                <div class="toggle-row">
                  <button id="sound-toggle-btn" class="toggle-btn" type="button" @click="toggleSoundMute()">
                    <span>{{ preferences.soundMuted ? t('sound_off') : t('sound_on') }}</span>
                  </button>
                  <button id="colorblind-toggle-btn" class="toggle-btn" type="button" @click="preferences.setColorblindMode(!preferences.colorblindMode)">
                    <span>{{ preferences.colorblindMode ? t('colorblind_on') : t('colorblind_off') }}</span>
                  </button>
                </div>
              </div>

              <div class="settings-block">
                <span class="settings-label">{{ t('word_pack') }}</span>
                <div class="pack-row">
                  <input id="word-pack-input" type="url" placeholder="https://..." class="input-sm" />
                  <button id="word-pack-btn" class="btn btn-ghost btn-sm" type="button" @click="() => void loadWordPack()">{{ t('load') }}</button>
                </div>
              </div>

              <div class="settings-block">
                <div class="language-switch" role="group" aria-label="Language">
                  <button class="lang-btn" type="button" :class="{ active: preferences.language === 'en' }" @click="preferences.setLanguage('en')">{{ t('language_en') }}</button>
                  <button class="lang-btn" type="button" :class="{ active: preferences.language === 'tr' }" @click="preferences.setLanguage('tr')">{{ t('language_tr') }}</button>
                </div>
              </div>
            </div>
          </div>

          <div class="sheet-panel" id="sheet-debrief" data-sheet="debrief" :class="{ 'sheet-open': ui.openPanel === 'debrief' }">
            <div class="sheet-handle"></div>
            <div class="sheet-body">
              <h3 class="sheet-title">{{ t('debrief') }}</h3>
              <div id="debrief-content" class="overlay-content" v-html="debriefHtml"></div>
            </div>
          </div>
        </div>
      </section>
    </main>

    <div id="toast" class="toast" :class="{ hidden: !ui.toast.visible, [`toast-${ui.toast.type}`]: !!ui.toast.type }" role="alert" aria-live="assertive">
      {{ ui.toast.message }}
    </div>

    <div id="confirm-overlay" class="overlay" :class="{ hidden: !ui.confirmId }">
      <div class="overlay-panel confirm-panel">
        <p id="confirm-message" class="confirm-message">{{ ui.confirmMessage }}</p>
        <div class="confirm-actions">
          <button id="confirm-yes-btn" class="btn btn-primary" type="button" @click="ui.resolveConfirm(true)">{{ t('confirm_yes') }}</button>
          <button id="confirm-no-btn" class="btn btn-ghost" type="button" @click="ui.resolveConfirm(false)">{{ t('confirm_no') }}</button>
        </div>
      </div>
    </div>

    <div ref="audioContainer" id="voice-audio-container" aria-hidden="true"></div>
  </div>
</template>
