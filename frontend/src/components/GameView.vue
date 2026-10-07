<script setup lang="ts">
import AccountControls from './AccountControls.vue';
import {isTournament, loadPartySeat, savePartyIdentity} from '../lib/party';
import LanguageSwitcher from './LanguageSwitcher.vue';
import VoiceBadge from './VoiceBadge.vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { copyText } from '../lib/clipboard';
import { generateDebriefNarrative } from '../lib/debrief';
import {
  canGuess,
  canHint,
  canHostRematch,
  canMark,
  formatTimerRemaining,
  getCurrentMaxHintCount,
  getPhaseTimerRemainingMs,
  getReadinessIssue,
  getTeamPlayers,
  getScoreBarShares,
  truncateMarkerName,
} from '../lib/game-helpers';
import { getAssetPath, getBasePath, getInitialRoomCode, getRoomUrl, getServiceWorkerPath } from '../lib/runtime';
import { emitWithAck, socket } from '../lib/socket';
import { playSound, toggleSoundMute, unlockSound } from '../lib/sound';
import { DEFAULT_LANGUAGE, formatCardWord, getLocaleTag, translate } from '../lib/translations';
import { clearSession } from '../lib/storage';
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

const accountName = ref('');
const partyError = ref('');
const retryParty = () => {partyError.value='';void tryAutoRejoin();};
function setAccountName(name: string) {
  accountName.value = name;
  if (name) nameInput.value = name;
}

const SCENE_CLASSES = [
  'scene-lobby',
  'scene-hint-red',
  'scene-hint-blue',
  'scene-guess-red',
  'scene-guess-blue',
  'scene-finished',
];

const SERVER_ERROR_MAP: Record<string, string> = {
  'That spymaster position is occupied.': 'spymaster_occupied',
  'Hint word is required.': 'hint_word_required',
  'Your hint cannot be a word on the board.': 'hint_on_board',
  'Room not found.': 'room_not_found',
};

const wordObservers = new WeakMap<HTMLElement, ResizeObserver>();
const wordValues = new WeakMap<HTMLElement, string>();
function fitWord(el: HTMLElement) {
  if (!el.isConnected) return;
  const word = wordValues.get(el) || '';
  el.textContent = word;
  el.style.whiteSpace = 'pre';
  const preferred = window.innerWidth <= 600 ? 14 : 18;
  let size = preferred;
  el.style.fontSize = `${size}px`;
  while (el.scrollWidth > el.clientWidth && size > 12) el.style.fontSize = `${--size}px`;
  if (el.scrollWidth > el.clientWidth && word.length > 5) {
    const middle = Math.ceil(word.length / 2);
    el.textContent = `${word.slice(0, middle)}\n${word.slice(middle)}`;
    size = preferred;
    el.style.fontSize = `${size}px`;
    while (el.scrollWidth > el.clientWidth && size > 10) el.style.fontSize = `${--size}px`;
  }
}
const vFitWord = {
  mounted(el: HTMLElement, binding: { value: string }) {
    wordValues.set(el, binding.value);
    const observer = new ResizeObserver(() => fitWord(el));
    observer.observe(el.parentElement!);
    wordObservers.set(el, observer);
    fitWord(el);
    void document.fonts.ready.then(() => fitWord(el));
  },
  updated(el: HTMLElement, binding: { value: string }) { wordValues.set(el, binding.value); fitWord(el); },
  unmounted(el: HTMLElement) { wordObservers.get(el)?.disconnect(); wordObservers.delete(el); wordValues.delete(el); },
};

const PANEL_KEYS = ['settings', 'debrief'] as const;

const app = useAppStore();
const preferences = usePreferencesStore();
preferences.initialize();
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
const theaterMode = new URLSearchParams(window.location.search).get('theater') === '1';
let liveTimer: number | null = null;

const snapshot = computed(() => app.snapshot);
const game = computed(() => snapshot.value?.game || null);
const room = computed(() => snapshot.value?.room || null);
const me = computed(() => snapshot.value?.me || null);
const players = computed(() => snapshot.value?.players || []);
const canHintNow = computed(() => app.connected && app.roomBound && canHint(snapshot.value));
const canGuessNow = computed(() => app.connected && app.roomBound && canGuess(snapshot.value));
const currentMaxHintCount = computed(() => getCurrentMaxHintCount(snapshot.value));
const readinessIssue = computed(() => getReadinessIssue(snapshot.value, (key) => t(key)));
const sortRoster = (list: PlayerView[]) => [...list].sort((a, b) => Number(b.role === 'spymaster') - Number(a.role === 'spymaster') || Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name));
const redPlayers = computed(() => sortRoster(getTeamPlayers(players.value, 'red')));
const bluePlayers = computed(() => sortRoster(getTeamPlayers(players.value, 'blue')));
const spymasters = computed(() => ({
  red: sortRoster(getTeamPlayers(players.value, 'red').filter(player => player.role === 'spymaster')),
  blue: sortRoster(getTeamPlayers(players.value, 'blue').filter(player => player.role === 'spymaster')),
}));
const spectatorPlayers = computed(() => players.value.filter(player => player.team === 'none' || player.role === 'spectator'));
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
const feedEntries = ref<HTMLDivElement | null>(null);
const feedItems = computed(() => {
  const items: Array<{ key: string; className: string; text: string; sender?: string; team?: string }> = [];
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
        text: message.text,
        sender: message.name,
        team: message.team || '',
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
        className: `feed-item feed-guess ${String(entry.color || '')}`,
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

function hintStatusText() {
  if (canHintNow.value) return t('hint_status_your_turn');
  if (game.value?.phase === 'finished') return t('hint_status_game_finished');
  if (game.value?.phase !== 'hint') return t('hint_status_operatives_guessing', { team: formatTeam(game.value?.currentTeam) });
  return t('hint_status_spymaster_locked', { team: formatTeam(game.value?.currentTeam) });
}

const activeHint = computed(() => game.value?.phase === 'guess' && game.value.hint?.team === game.value.currentTeam ? game.value.hint : null);

function hintDisplayText(hint: { word: string; count: number }) {
  return `${hint.word.toLocaleUpperCase(getLocaleTag(preferences.language))} · ${hint.count}`;
}

function resultText() {
  if (!game.value) return '';
  if (game.value.reason === 'assassin') return t('result_assassin', { loser: formatTeam(game.value.loser) });
  if (game.value.reason === 'all_agents_revealed') return t('result_all_agents', { winner: formatTeam(game.value.winner) });
  if (game.value.reason === 'opponent_agents_revealed') return t('result_opponent_agents', { winner: formatTeam(game.value.winner) });
  return t('result_generic', { winner: formatTeam(game.value.winner) });
}

function scoreBarWidth(team: 'red' | 'blue') {
  return `${getScoreBarShares(game.value?.remaining)[team]}%`;
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
    app.connected && app.roomBound &&
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
  hintCountInput.value = Math.max(1, Math.min(spymasterSelectedIndexes.value.length, currentMaxHintCount.value ?? 50));
}

function roleTeamSelected(team: Team, role: string) {
  return me.value?.team === team && me.value?.role === role;
}

function playerIsSpeaking(sessionId: string) {
  return players.value.find(player => player.sessionId === sessionId)?.speaking ?? false;
}
function peerVolume(sessionId: string) {
  return voice.active ? voice.peers.find(peer => peer.sessionId === sessionId)?.volume : undefined;
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
  body.classList.toggle('theatrical-mode', theaterMode);
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
  if(isTournament){
    if(app.rejoinAttempted)return;app.rejoinAttempted=true;
    try{const seat=await loadPartySeat();await emitWithAck('room:rejoin',{code:seat.room,sessionId:seat.sessionId,reconnectToken:seat.reconnectToken,name:seat.name});}
    catch(error){app.rejoinAttempted=false;partyError.value=error instanceof Error?error.message:'Could not join your assigned match';}
    return;
  }

  if (app.rejoinAttempted || !app.session) return;
  const inviteCode = getInitialRoomCode();
  if (inviteCode && inviteCode !== app.session.code) return;
  app.rejoinAttempted = true;

  nameInput.value = app.session.name || '';
  codeInput.value = getInitialRoomCode() || app.session.code || '';

  try {
    await emitWithAck('room:rejoin', {
      code: codeInput.value,
      sessionId: app.session.sessionId,
      reconnectToken: app.session.reconnectToken,
      name: app.session.name,
    });
  } catch (error) {
    if (error instanceof Error && ['Room not found.', 'Session not found in room.', 'Session proof is invalid. Join the room again.'].includes(error.message)) {
      app.clearSnapshot();
      app.clearSession();
    } else {
      app.rejoinAttempted = false;
      ui.showToast(error instanceof Error ? error.message : t('action_rejected'), 'error');
    }
  }
}

function announceTurnChange(nextSnapshot: Snapshot, hintAnnounced = false) {
  const isMyTurn = canHint(nextSnapshot) || canGuess(nextSnapshot);
  if (isMyTurn && !app.previousIsMyTurn && !hintAnnounced) {
    playSound('yourTurn');
  }
  app.previousIsMyTurn = isMyTurn;
}

function handleSnapshot(nextSnapshot: Snapshot) {
  const previousGame = game.value;
  const nextGame = nextSnapshot.game;
  const newHint = Boolean(previousGame && nextGame?.id === previousGame.id &&
    nextGame.phase === 'guess' && nextGame.hint &&
    (previousGame.phase !== 'guess' || previousGame.hint?.at !== nextGame.hint.at || previousGame.turnNumber !== nextGame.turnNumber));
  announceTurnChange(nextSnapshot, newHint);
  if (newHint) playSound('hint');

  const previousRevealed = new Set(game.value?.board.filter((card) => card.revealed).map((card) => card.index) || []);
  app.setSnapshot(nextSnapshot);
  codeInput.value = nextSnapshot.room.code;
  const roomUrl = new URL(getRoomUrl(nextSnapshot.room.code));
  roomUrl.search = window.location.search;
  roomUrl.hash = window.location.hash;
  window.history.replaceState(window.history.state, '', roomUrl);
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

const socketSubscriptions: Array<[string, (...args: any[]) => void]> = [];
function listen(event: string, handler: (...args: any[]) => void) {
  socket.on(event, handler);
  socketSubscriptions.push([event, handler]);
}

listen('connect', async () => {
  setConnection(true);
  if (app.wasDisconnected) {
    ui.showToast(t('reconnected'), 'success');
    app.wasDisconnected = false;
  }
  await tryAutoRejoin();
});

listen('disconnect', () => {
  app.wasDisconnected = true;
  setConnection(false);
});

listen('connect_error', () => {
  app.setConnection(false, t('connection_error'));
});

listen('state:full', (nextSnapshot: Snapshot) => {
  handleSnapshot(nextSnapshot);
});

listen('error:rule_violation', (payload: { message?: string }) => {
  ui.showToast(payload.message || t('action_rejected'), 'error');
});

listen('server:info', (payload: { message?: string }) => {
  if (payload.message) ui.showToast(payload.message);
});

listen('turn:timer_started', (payload: { phase?: string }) => {
  if (payload.phase === 'hint') ui.showToast(t('hint_timer_started'));
  if (payload.phase === 'guess') ui.showToast(t('guess_timer_started'));
});

listen('turn:timer_expired', (payload: { phase?: string }) => {
  if (payload.phase === 'hint') ui.showToast(t('hint_timer_expired'));
  if (payload.phase === 'guess') ui.showToast(t('guess_timer_expired'));
});

listen('turn:guess_resolved', (payload: { color?: string; team?: Team }) => {
  if (payload.color === 'assassin') playSound('assassin');
  else if (payload.color === payload.team) playSound('correct');
  else playSound('reveal');
});

listen('voice:status', (status: { sessionId: string; inVoice: boolean; muted: boolean; speaking: boolean }) => {
  const player = players.value.find(player => player.sessionId === status.sessionId);
  if (player) Object.assign(player, { inVoice: status.inVoice, voiceMuted: status.muted, speaking: status.speaking });
});
listen('voice:speaking_changed', (status: { sessionId: string; speaking: boolean }) => {
  const player = players.value.find(player => player.sessionId === status.sessionId);
  if (player) player.speaking = status.speaking;
});

listen('game:gg_received', (payload: { name?: string }) => {
  ui.showToast(t('gg_received', { name: payload.name || t('anonymous') }));
  playSound('gg');
});

listen('chat:message', (message: ChatMessage) => {
  if (!app.snapshot) return;
  app.snapshot.room.chatMessages.push(message);
  if (app.snapshot.room.chatMessages.length > 200) app.snapshot.room.chatMessages.splice(0, app.snapshot.room.chatMessages.length - 200);
});

listen('turn:mark_update', (payload: { index: number; marks: CardMark[] }) => {
  const card = app.snapshot?.game?.board?.[payload.index];
  if (card) {
    card.marks = payload.marks;
  }
});

listen('game:mvp_result', (payload: { winner?: { name?: string } }) => {
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

const enteringRoom = ref(false);
async function enterRoom() {
  if (enteringRoom.value) return;
  enteringRoom.value = true;
  const code = codeInput.value.trim().toUpperCase();
  try {
    const response = await emitWithAck<{ roomCode: string }>(
      code ? 'room:join' : 'room:create',
      { name: nameInput.value.trim(), ...(code ? { code } : {}) },
    );
    codeInput.value = response.roomCode;
  } catch (error) {
    ui.showToast(translateServerError(error instanceof Error ? error.message : t('action_rejected')), 'error');
  } finally {
    enteringRoom.value = false;
  }
}

async function leaveRoom() {
  const confirmed = await ui.confirm(t('confirm_leave'));
  if (!confirmed) return;
  leaveVoice();
  try {
    await emitWithAck('room:leave', {});
  } catch (error) {
    ui.showToast(error instanceof Error ? error.message : t('action_rejected'), 'error');
    return;
  }
  window.history.replaceState(window.history.state, '', getBasePath());
  app.clearSnapshot();
  app.clearSession();
  clearSession();
  ui.closePanel();
}

async function updatePartyIdentity(name: string, color: string) {
  try {
    await emitWithAck('player:identity', {name, color});
    await savePartyIdentity({name, color});
  } catch(error) {ui.showToast(error instanceof Error ? error.message : 'Identity update failed','error');}
}

async function setRole(role: 'spymaster' | 'operative' | 'spectator', roleTeam?: Team) {
  if(isTournament)return;
  if (!snapshot.value) {
    ui.showToast(t('join_create_first'));
    return;
  }

  try {
    await emitWithAck('role:set', { role, ...(roleTeam ? { team: roleTeam } : {}) });
  } catch (error) {
    ui.showToast(error instanceof Error ? translateServerError(error.message) : 'Role update failed', 'error');
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
  if (!Number.isInteger(count) || count < 1 || count > (currentMaxHintCount.value ?? 50)) {
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
  if (!app.connected || !app.roomBound || !canMark(snapshot.value, card)) return;
  const previousMarks = card.marks;
  optimisticToggleMark(card);
  const optimisticMarks = card.marks;
  playSound('mark');
  await emitWithAck('turn:mark_toggle', { index: card.index }).catch((error: Error) => {
    if (card.marks === optimisticMarks) card.marks = previousMarks;
    ui.showToast(error.message, 'error');
  });
}

async function setMarkConfidence(card: BoardCard, confidence: 'firm' | 'tentative') {
  if (!app.connected || !app.roomBound || !snapshot.value || !canMark(snapshot.value, card)) return;
  const existing = card.marks.find((mark) => mark.sessionId === snapshot.value?.me.sessionId);
  if (!existing) return;
  const previousConfidence = existing.confidence;
  existing.confidence = confidence;
  await emitWithAck('turn:mark_confidence', { index: card.index, confidence }).catch((error: Error) => {
    if (card.marks.includes(existing) && existing.confidence === confidence) existing.confidence = previousConfidence;
    ui.showToast(error.message, 'error');
  });
}

function selectGuess(index: number) {
  ui.selectedGuessIndex = ui.selectedGuessIndex === index ? null : index;
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
  await emitWithAck('turn:end', {}).catch((error: Error) => ui.showToast(error.message, 'error'));
}

async function sendGG() {
  await emitWithAck('game:gg', {}).catch((error: Error) => ui.showToast(error.message, 'error'));
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

function copyInviteLink() {
  if (!room.value) return;
  void copyText(getRoomUrl(room.value.code))
    .then(() => ui.showToast(t('invite_copied'), 'success'))
    .catch(() => ui.showToast(t('copy_failed'), 'error'));
}

function copyRoomCode() {
  if (!room.value) return;
  void copyText(room.value.code)
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
  () => [preferences.colorblindMode, game.value?.phase, game.value?.currentTeam],
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

watch(
  [() => room.value?.code, () => feedItems.value[feedItems.value.length - 1]?.key, () => feedItems.value[feedItems.value.length - 1]?.text],
  () => {
    const entries = feedEntries.value;
    if (entries) entries.scrollTop = entries.scrollHeight;
  },
  { flush: 'post' }
);

watch(game, () => syncInputDefaults(), { immediate: true });
watch(
  [() => game.value?.id, () => game.value?.phase, () => game.value?.currentTeam, () => me.value?.team, () => me.value?.role],
  () => {
    spymasterSelectedIndexes.value = [];
    ui.selectedGuessIndex = null;
  }
);

onMounted(() => {
  document.body.classList.toggle('party-mode',isTournament);
  document.addEventListener('pointerdown', unlockSound);
  document.addEventListener('keydown', unlockSound);
  if (socket.connected) {setConnection(true);void tryAutoRejoin();}
  syncDocumentLanguage();
  syncSceneClasses();
  if (me.value) nameInput.value = me.value.name;
  codeInput.value = getInitialRoomCode() || codeInput.value;
  liveTimer = window.setInterval(() => {
    nowTick.value = Date.now();
  }, 250);

  const worker = getServiceWorkerPath();
  if (!isTournament && 'serviceWorker' in navigator) {
    void navigator.serviceWorker.register(worker.path, { scope: worker.scope }).catch(() => {});
  }
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', unlockSound);
  document.removeEventListener('keydown', unlockSound);
  for (const [event, handler] of socketSubscriptions) socket.off(event, handler);
  document.body.classList.remove(...SCENE_CLASSES, 'colorblind-mode', 'theatrical-mode');
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
        <div class="landing-account">
          <AccountControls v-if="!snapshot" compact @identity="setAccountName" />
        </div>
        <div class="join-card">
          <div class="dossier-stamp" aria-hidden="true">CLASSIFIED</div>
          <div class="fold-line fold-line-h" aria-hidden="true"></div>
          <div class="fold-line fold-line-v" aria-hidden="true"></div>

          <header class="join-header">
            <div class="document-number" aria-hidden="true">DOC. NO. TC-4782</div>
            <div class="join-logo-lockup"><img class="join-logo-mark" :src="getAssetPath('icons/murmur-mark-128.webp')" width="48" height="48" alt="" /><h1 class="logo-title">MURMUR</h1></div>
            <div class="logo-rule" aria-hidden="true"></div>
            <p class="join-subtitle">{{ t('join_subtitle') }}</p>
          </header>

          <div v-if="isTournament" class="join-form" role="status">
            <p>{{partyError || 'Connecting to your assigned match…'}}</p>
            <button v-if="partyError" class="btn btn-primary" type="button" @click="retryParty">Try again</button>
            <a v-if="partyError" class="btn" href="/" target="_top">Return to Play</a>
          </div>
          <form v-else class="join-form" @submit.prevent="enterRoom">
            <label class="field-group">
              <span class="field-label">{{ t('display_name') }}</span>
              <input v-model="nameInput" :disabled="!!accountName" type="text" maxlength="24" :placeholder="t('display_name_placeholder')" autocomplete="off" />
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
              </div>
            </label>

            <div class="join-actions">
              <button id="room-action-btn" class="btn btn-primary btn-lg" type="submit" :disabled="enteringRoom">{{ t(codeInput.trim() ? 'join_room' : 'create_room') }}</button>
            </div>

            <p id="join-note" class="join-note">{{ t('join_note_default') }}</p>
          </form>

          <footer class="join-footer">
            <button class="lang-btn" type="button" @click="preferences.toggleTheme()" :aria-label="preferences.resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'">
              {{ preferences.resolvedTheme === 'dark' ? '☀' : '☾' }}
            </button>
            <LanguageSwitcher />
          </footer>
        </div>
      </section>

      <section id="room-panel" class="room-screen" :class="{ hidden: !snapshot, 'is-lobby': !game }">
        <div class="bottom-bar">
          <nav class="bar-tabs" aria-label="Panels">
            <span class="navbar-brand"><img class="navbar-logo-mark" :src="getAssetPath('icons/murmur-mark-128.webp')" width="30" height="30" alt="" />MURMUR<span id="connection-dot" class="conn-status" :class="{ online: app.connected, offline: !app.connected }" role="status" :aria-label="app.connectionLabel" :title="app.connectionLabel"><span class="conn-dot"></span></span></span>
            <div v-if="game && !isTournament" class="bar-util">
              <button id="room-code" class="room-code-val" type="button" :aria-label="t('copy_room_code')" @click="copyRoomCode">{{ room?.code || '----' }}</button>
            </div>

            <div class="bar-tabs-center">


              <button
                v-for="panel in PANEL_KEYS"
                :key="panel"
                :data-panel="panel"
                :aria-label="panel === 'debrief' ? t('debrief') : t('panel_settings')"
                :title="panel === 'debrief' ? t('debrief') : t('panel_settings')"
                class="bar-tab"
                :class="{ active: ui.openPanel === panel, hidden: panel === 'debrief' && game?.phase !== 'finished' }"
                type="button"
                @click="ui.togglePanel(panel)"
              >
                <svg v-if="panel === 'settings'" class="nav-icon settings-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M10 2h4l.5 3.1 1.8 1 2.9-1.2 2 3.5-2.4 2v3.2l2.4 2-2 3.5-2.9-1.2-1.8 1L14 22h-4l-.5-3.1-1.8-1-2.9 1.2-2-3.5 2.4-2v-3.2l-2.4-2 2-3.5 2.9 1.2 1.8-1L10 2Zm6 10a4 4 0 1 0-8 0 4 4 0 0 0 8 0Z" /></svg>
                <svg v-else class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M5 3h14v18H5zM8 7h8M8 11h8M8 15h5" /></svg>
                <span class="bar-tab-label">
                  {{ panel === 'settings' ? t('panel_settings') : t('debrief') }}
                </span>
              </button>

              <div class="voice-controls" :class="{ 'voice-active': voice.active }" role="group" :aria-label="t('voice_chat')">
                <button id="voice-join-btn" :aria-label="voice.active ? t('voice_leave') : t('voice_join')" :title="voice.active ? t('voice_leave') : t('voice_join')" :disabled="joining" class="bar-tab bar-tab-voice" type="button" :class="{ 'in-voice': voice.active }" @click="() => void joinVoice()">
                  <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 15v-3a8 8 0 0 1 16 0v3M4 12H2v8h5v-8ZM20 12h2v8h-5v-8Z" /></svg>
                  <span class="bar-tab-label">{{ voice.active ? t('voice_leave') : t('voice_join') }}</span>
                </button>
                <template v-if="voice.active">
                  <button id="voice-mute-btn" class="btn btn-ghost btn-sm" type="button" :aria-label="voice.muted ? t('voice_unmute') : t('voice_mute')" :title="voice.muted ? t('voice_unmute') : t('voice_mute')" :aria-pressed="voice.muted" :class="{ muted: voice.muted }" @click="toggleMute">
                    <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" /><path v-if="voice.muted" d="m3 3 18 18" /></svg>
                  </button>
                  <button id="voice-noise-btn" class="btn btn-ghost btn-sm" type="button" :aria-label="t('noise_suppression')" :title="`${t('noise_suppression')} · ${t(preferences.noiseSuppression ? 'enabled' : 'disabled')}`" :aria-pressed="preferences.noiseSuppression" @click="() => void toggleNoiseSuppression()">
                    <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 9v6M8 5v14M12 2v20M16 5v14M20 9v6" /></svg>
                  </button>

                </template>
              </div>
            </div>

            <div class="bar-tabs-right">
              <div v-if="isTournament && me" class="party-identity" aria-label="Your identity">
                <input aria-label="Your name" :value="me.name" maxlength="18" @change="updatePartyIdentity(($event.target as HTMLInputElement).value, me.color || '#5b8c65')" />
                <input aria-label="Your color" type="color" :value="me.color || '#5b8c65'" @input="updatePartyIdentity(me.name, ($event.target as HTMLInputElement).value)" />
              </div>
              <button v-if="!isTournament" id="leave-room-btn" class="bar-tab bar-tab-leave" type="button" :aria-label="t('leave')" :title="t('leave')" @click="() => void leaveRoom()">
                <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M10 3H4v18h6M9 12h12m-5-5 5 5-5 5" /></svg>
                <span class="bar-tab-label">{{ t('leave') }}</span>
              </button>
            </div>
          </nav>
        </div>

        <div v-if="game" class="top-bar">
          <div id="score-bar" class="score-bar">
            <div id="score-bar-red" class="score-bar-red" :style="{ width: scoreBarWidth('red') }"></div>

            <div id="score-bar-blue" class="score-bar-blue" :style="{ width: scoreBarWidth('blue') }"></div>
            <span class="score-endpoint score-endpoint-left" aria-hidden="true">⚑</span>
            <span class="score-battle" :style="{ left: scoreBarWidth('red') }" aria-hidden="true">⚔</span>
            <span class="score-endpoint score-endpoint-right" aria-hidden="true">⚑</span>
          </div>
        </div>

        <div v-if="game" class="bottom-bar-status">
          <strong v-if="game" class="words-remaining status-score red" :aria-label="`${formatTeam('red')}: ${t('words_left', { count: game.remaining.red })}`">{{ t('words_left', { count: game.remaining.red }) }}</strong>
          <div class="turn-status-center">
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
          <strong v-if="game" class="words-remaining status-score blue" :aria-label="`${formatTeam('blue')}: ${t('words_left', { count: game.remaining.blue })}`">{{ t('words_left', { count: game.remaining.blue }) }}</strong>
        </div>

        <div class="game-stage">
          <header v-if="!game" class="lobby-header">
            <div class="lobby-intro"><h2>{{ t('lobby_heading') }}</h2><p>{{ t('lobby_guidance') }}</p></div>
            <div class="lobby-tools">
              <button id="room-code" class="room-code-val" type="button" :aria-label="t('copy_room_code')" @click="copyRoomCode"><small>{{ t('room_code') }}</small><strong>{{ room?.code || '----' }}</strong></button>
              <button class="btn btn-ghost invite-link-btn" type="button" :aria-label="t('copy_invite')" :title="t('copy_invite')" @click="copyInviteLink"><span class="invite-full">{{ t('copy_invite') }}</span><span class="invite-short">{{ t('invite_short') }}</span></button>
              <button id="mode-badge" class="mode-tag" type="button" :title="t('panel_settings')" @click="ui.togglePanel('settings')">{{ t(roomMode === 'blitz' ? 'mode_blitz' : 'mode_casual') }}</button>
            </div>
          </header>
          <div class="stage-layout">
            <div v-if="game" class="board-area">
              <div id="hint-display" class="clue-summary" aria-live="polite">
                <div v-for="team in (['red', 'blue'] as const)" :key="team" class="clue-slot" :class="{ current: game.currentTeam === team, empty: activeHint?.team !== team }" :data-team="team">
                  <div class="spymaster-roster" :aria-label="`${formatTeam(team)} · ${t('spymaster')}`">
                    <span class="spymaster-label">{{ t('spymaster') }}</span>
                    <ul v-if="spymasters[team].length">
                      <li v-for="player in spymasters[team]" :key="player.sessionId" :class="{ 'is-offline': !player.connected, speaking: playerIsSpeaking(player.sessionId) }"><span>{{ player.name }}</span> <VoiceBadge :name="player.name" :in-voice="!!player.inVoice" :muted="!!player.voiceMuted" :speaking="playerIsSpeaking(player.sessionId)" :volume="peerVolume(player.sessionId)" @volume="value => setPeerVolume(player.sessionId, value)" /><small v-if="!player.connected"> · {{ t('tag_offline') }}</small></li>
                    </ul>
                    <button v-else class="spymaster-vacancy btn btn-ghost" type="button" :aria-label="`${t('join_spymaster')} · ${formatTeam(team)}`" @click="setRole('spymaster', team)">{{ t('join_spymaster') }}</button>
                  </div>
                  <span class="clue-word" :class="{ 'has-hint': activeHint?.team === team }" :data-team-label="formatTeam(team)">{{ activeHint?.team === team ? hintDisplayText(activeHint) : '—' }}</span>
                  <small v-if="game.hint?.team === team && game.phase === 'guess'">{{ t(game.guessesRemaining === 1 ? 'guess_left' : 'guesses_left', { count: game.guessesRemaining ?? '∞' }) }}</small>
                </div>
              </div>

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
                    :aria-pressed="!card.revealed && (ui.selectedGuessIndex === card.index || spymasterSelectedIndexes.includes(card.index))"
                    :title="markerTitle(card.marks)"
                    :aria-label="getCardLabel(card)"
                    @click="() => handleCardClick(card)"
                    @keydown="(event) => handleBoardKeydown(event as KeyboardEvent, index)"
                  >
                    <div class="card-inner">
                      <div class="card-front">
                        <span class="card-word" v-fit-word="boardWord(card)"></span>
                      </div>
                    </div>
                    <span v-if="card.revealed && me?.role === 'spymaster'" class="card-opened-mark" :title="t('card_revealed')" aria-hidden="true">◆</span>
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

            <div v-if="game" class="controls-strip">
              <div id="ctrl-placeholder" class="ctrl-panel ctrl-placeholder" :class="{ hidden: !!game }">{{ t('ctrl_placeholder') }}</div>

              <section id="hint-section" class="ctrl-panel hint-ctrl" :class="{ hidden: !canHintNow }">
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
                    autocomplete="off"
                  />
                  <div class="number-stepper">
                    <button type="button" class="stepper-btn stepper-btn-down" aria-label="Decrease" @click="hintCountInput = Math.max(1, Number(hintCountInput) - 1)">
                      &minus;
                    </button>
                    <input
                      id="hint-count-input"
                      :aria-label="t('hint_count')"
                      v-model="hintCountInput"
                      type="number"
                      min="1"
                      :max="currentMaxHintCount ?? 50"
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
                  <button class="btn btn-primary" type="submit">{{ t('transmit') }}</button>
                </form>
              </section>

              <section id="guess-section" class="ctrl-panel guess-ctrl" :class="{ hidden: !canGuessNow }">
                <div v-if="canGuessNow" class="guess-row">
                  <span id="selected-guess" class="selected-label">{{ guessLabel }}</span>
                  <button id="submit-guess-btn" class="btn btn-primary" type="button" :disabled="!selectedGuessCard || !canGuessNow" @click="() => void submitGuess()">
                    {{ t('submit_guess') }}
                  </button>
                  <button id="end-turn-btn" class="btn btn-ghost" type="button" @click="() => void endTurn()">
                    {{ t('end_turn') }}
                  </button>
                </div>
              </section>

              <section id="result-section" class="ctrl-panel result-ctrl" :class="{ hidden: game?.phase !== 'finished' }">
                <p id="result-text" class="result-text">{{ resultText() }}</p>
                <div class="result-actions">
                  <button v-if="!isTournament" id="rematch-btn" class="btn btn-primary" type="button" :class="{ hidden: !canHostRematch(snapshot) }" @click="() => void rematch('same_teams')">
                    {{ t('rematch') }}
                  </button>
                  <button v-if="!isTournament" id="swap-rematch-btn" class="btn btn-secondary" type="button" :class="{ hidden: !canHostRematch(snapshot) }" @click="() => void rematch('swap_teams')">
                    {{ t('swap_rematch') }}
                  </button>
                  <button id="gg-btn" class="btn btn-ghost" type="button" @click="() => void sendGG()">{{ t('gg') }}</button>
                  <button id="debrief-btn" class="btn btn-ghost" type="button" @click="ui.togglePanel('debrief')">{{ t('debrief') }}</button>
                </div>
                <div id="mvp-section" class="mvp-section hidden"></div>
              </section>
            </div>
            <aside class="room-sidebar">
          <div class="persistent-panel" id="sheet-teams">
            <div class="sheet-body">

              <section v-for="group in [
                { team: 'red', role: 'operative', title: 'red_team', members: redPlayers },
                { team: 'blue', role: 'operative', title: 'blue_team', members: bluePlayers },
                { team: 'none', role: 'spectator', title: 'spectators', members: spectatorPlayers },
              ] as const" :key="group.team" class="team-panel" :class="[`team-${group.team}`, { 'spectator-roster': group.team === 'none', 'is-my-team': roleTeamSelected(group.team, group.role) }]" @click="setRole(group.role, group.team)">
                <button v-if="!isTournament && (game || group.team === 'none')" class="operative-join-target" type="button" :aria-label="group.team === 'none' ? t('spectator') : `${t('join_operative')} · ${formatTeam(group.team)}`" :aria-pressed="roleTeamSelected(group.team, group.role)" @click.stop="setRole(group.role, group.team)"></button>
                <div class="team-head">
                  <span class="team-dot" :class="group.team"></span>
                  <h3>{{ t(group.title) }}</h3><span class="roster-count">{{ group.members.length }}</span>
                </div>
                <ul :id="group.team === 'none' ? 'spectator-list' : `${group.team}-team-list`" class="player-list" :aria-label="t(group.title)" tabindex="0">
                  <li v-if="!group.members.length" class="team-empty">{{ t(group.team === 'none' ? 'no_spectators' : 'no_team_players') }}</li>
                  <li v-for="player in group.members" :key="player.sessionId" class="team-player-item" tabindex="0" :title="`${player.name} · ${formatRole(player.role)}${!player.connected ? ` · ${t('tag_offline')}` : ''}`" :aria-label="`${player.name} · ${formatRole(player.role)}`" :class="{ speaking: playerIsSpeaking(player.sessionId), 'is-offline': !player.connected, 'is-spymaster': player.role === 'spymaster' }">
                    <span class="team-player-name" :style="player.color ? {borderLeft:`3px solid ${player.color}`,paddingLeft:'5px'} : {}">{{ player.name }}</span>
                    <VoiceBadge :name="player.name" :in-voice="!!player.inVoice" :muted="!!player.voiceMuted" :speaking="playerIsSpeaking(player.sessionId)" :volume="peerVolume(player.sessionId)" @volume="value => setPeerVolume(player.sessionId, value)" />
                    <span v-if="player.isHost" class="chip-status" :title="t('tag_host')" :aria-label="t('tag_host')">★</span>
                    <span v-if="!player.connected" class="chip-status">· {{ t('tag_offline') }}</span>
                  </li>
                </ul>
                <div v-if="!game && group.team !== 'none'" class="lobby-team-actions" @click.stop>
                  <div class="lobby-spymaster" :data-team="group.team">
                    <button v-if="!spymasters[group.team].length" class="spymaster-vacancy" type="button" :aria-label="`${t('join_spymaster')} · ${formatTeam(group.team)}`" @click="setRole('spymaster', group.team)">{{ t('spymaster') }}</button>
                    <button v-else class="spymaster-filled" type="button" :aria-pressed="roleTeamSelected(group.team, 'spymaster')" :disabled="isTournament || !roleTeamSelected(group.team, 'spymaster')" :title="t('lobby_spymaster_is', { name: spymasters[group.team].map(player => player.name).join(', ') })" @click="setRole('spymaster', group.team)">{{ t('spymaster') }}</button>
                  </div>
                  <button v-if="!isTournament" class="operative-join-target" type="button" :aria-label="`${t('join_operative')} · ${formatTeam(group.team)}`" :aria-pressed="roleTeamSelected(group.team, 'operative')" @click.stop="setRole('operative', group.team)">{{ t('operative') }}</button>
                </div>
              </section>

              <div v-if="!game || game.phase === 'finished' || (me?.isHost && players.some(player => !player.connected))" class="sidebar-actions">
                <p v-if="!game" class="readiness-note" :class="{ ready: !readinessIssue && me?.isHost }">{{ me?.isHost ? (readinessIssue || t('ready_to_start')) : t('lobby_waiting_host') }}</p>
                <button v-if="!isTournament" id="start-game-btn" class="btn btn-accent btn-lg" type="button" :class="{ hidden: !me?.isHost || !!(game && game.phase !== 'finished') }" :disabled="!!readinessIssue || !!(game && game.phase !== 'finished')" @click="() => void startGame()">
                  {{ t('start_game') }}
                </button>
                <button v-if="!isTournament" id="prune-btn" class="btn btn-ghost btn-sm" type="button" :class="{ hidden: !me?.isHost || !players.some(player => !player.connected) }" @click="() => void pruneDisconnected()">
                  {{ t('prune_offline') }}
                </button>
              </div>
            </div>
          </div>

          <div class="persistent-panel" id="sheet-feed">
            <div class="sheet-body">
              <h3 class="sheet-title">{{ t('panel_feed') }}</h3>
              <div id="feed-entries" ref="feedEntries" class="feed-entries">
                <div v-if="feedItems.length === 0" class="feed-empty">{{ t('feed_empty') }}</div>
                <div v-for="item in feedItems" :key="item.key" :class="item.className"><template v-if="item.sender"><span class="feed-name" :class="item.team">{{ item.sender }}:</span> </template><span class="feed-text">{{ item.text }}</span></div>
              </div>
              <form id="chat-form" class="chat-form" autocomplete="off" @submit.prevent="sendChat">
                <input id="chat-input" :aria-label="t('chat_placeholder')" v-model="chatInput" type="text" maxlength="200" :placeholder="t('chat_placeholder')" />
                <button class="btn btn-ghost btn-sm" type="submit">{{ t('send') }}</button>
              </form>
            </div>
          </div>

            </aside>
          </div>
        </div>

        <div id="sheet-container" class="sheet-container" @keydown.esc="ui.closePanel()">
          <div id="sheet-backdrop" class="sheet-backdrop" :class="{ visible: !!ui.openPanel }" @click="ui.closePanel()"></div>

          <div class="sheet-panel" id="sheet-settings" data-sheet="settings" :class="{ 'sheet-open': ui.openPanel === 'settings' }">
            <div class="sheet-handle"></div>
            <div class="sheet-body">
              <AccountControls v-if="snapshot" @identity="setAccountName" />
              <h3 class="sheet-title">{{ t('panel_settings') }} <button class="btn btn-ghost btn-sm panel-close" type="button" @click="ui.closePanel()">{{ t('close_panel') }}</button></h3>

              <div v-if="game" class="settings-room-tools"><span>{{ t('room_code') }} · {{ room?.code }}</span><button class="btn btn-ghost btn-sm" type="button" @click="copyInviteLink">{{ t('copy_invite') }}</button></div>

              <section class="settings-group">
                <h4>{{ t('appearance') }}</h4>
                <div class="preference-row"><span>{{ t('theme_label') }}</span><div class="segmented">
                  <button type="button" :aria-pressed="preferences.resolvedTheme === 'light'" @click="preferences.setTheme('light')">{{ t('theme_light') }}</button>
                  <button type="button" :aria-pressed="preferences.resolvedTheme === 'dark'" @click="preferences.setTheme('dark')">{{ t('theme_dark') }}</button>
                </div></div>
                <div class="preference-row"><span>{{ t('card_patterns') }}</span><button id="colorblind-toggle-btn" :aria-label="t('card_patterns')" class="preference-switch" type="button" role="switch" :aria-checked="preferences.colorblindMode" @click="preferences.setColorblindMode(!preferences.colorblindMode)">{{ t(preferences.colorblindMode ? 'enabled' : 'disabled') }}</button></div>
                <div class="preference-row"><span>{{ t('language_label') }}</span><LanguageSwitcher /></div>
              </section>
              <section class="settings-group">
                <h4>{{ t('audio_options') }}</h4>
                <div class="preference-row"><span>{{ t('sound_effects') }}</span><button id="sound-toggle-btn" :aria-label="t('sound_effects')" class="preference-switch" type="button" role="switch" :aria-checked="!preferences.soundMuted" @click="toggleSoundMute()">{{ t(!preferences.soundMuted ? 'enabled' : 'disabled') }}</button></div>
              </section>
              <section class="settings-group">
                <h4>{{ t('room_setup') }}</h4>
                <p v-if="game && game.phase !== 'finished'" class="settings-explanation">{{ t('room_setup_locked') }}</p>
                <div class="preference-row"><span>{{ t('mode') }}</span><div class="segmented">
                  <button type="button" :aria-pressed="roomMode === 'casual'" :disabled="isTournament || !me?.isHost || !!(game && game.phase !== 'finished')" @click="() => void setMode('casual')">{{ t('mode_casual') }}</button>
                  <button type="button" :aria-pressed="roomMode === 'blitz'" :disabled="isTournament || !me?.isHost || !!(game && game.phase !== 'finished')" @click="() => void setMode('blitz')">{{ t('mode_blitz') }}</button>
                </div></div>
                <div v-if="roomMode === 'blitz'" class="timer-settings">
                  <label>{{ t('blitz_hint_timer') }} <input id="blitz-hint-sec" v-model="blitzHintSec" type="number" min="5" max="300" :disabled="isTournament || !me?.isHost || !!(game && game.phase !== 'finished')" @change="() => void sendBlitzConfig()" /></label>
                  <label>{{ t('blitz_guess_timer') }} <input id="blitz-guess-sec" v-model="blitzGuessSec" type="number" min="5" max="300" :disabled="isTournament || !me?.isHost || !!(game && game.phase !== 'finished')" @change="() => void sendBlitzConfig()" /></label>
                </div>

              </section>
            </div>
          </div>

          <div class="sheet-panel" id="sheet-debrief" data-sheet="debrief" :class="{ 'sheet-open': ui.openPanel === 'debrief' }">
            <div class="sheet-handle"></div>
            <div class="sheet-body">
              <h3 class="sheet-title">{{ t('debrief') }} <button class="btn btn-ghost btn-sm panel-close" type="button" @click="ui.closePanel()">{{ t('close_panel') }}</button></h3>
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

<style>
.party-identity {display:flex;align-items:center;gap:.3rem;max-width:180px}
.party-identity input:not([type=color]) {width:100px;min-width:0;font-size:12px;padding:5px;background:var(--surface);color:inherit;border:1px solid currentColor;border-radius:4px}
.party-identity input[type=color] {width:28px;height:28px;padding:0;flex:none}
.party-mode .team-panel {cursor:default}
@media(max-width:699px){
 .party-mode .room-screen:is(.is-lobby,:not(.is-lobby)) .bar-tabs {grid-template-columns:minmax(0,1fr) auto 36px}
 .party-mode .room-screen .navbar-brand {grid-column:1 / 3}
 .party-mode .room-screen:is(.is-lobby,:not(.is-lobby)) .bar-tab[data-panel="settings"] {grid-column:3}
 .party-mode .party-identity {grid-column:1;grid-row:2;max-width:135px;justify-self:start}
 .party-mode .party-identity input:not([type=color]){width:100px;flex:none}
 .party-mode .room-screen:is(.is-lobby,:not(.is-lobby)) .voice-controls {grid-column:2 / 4}
}
@media(min-width:540px) and (max-width:900px) and (max-height:500px){.party-mode .room-screen:is(.is-lobby,:not(.is-lobby)) .bar-tabs{display:flex}.party-identity input:not([type=color]){width:85px}}
</style>
