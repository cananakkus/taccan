import { ui } from './ui.js';
import { t, getLocaleTag, formatCardWord } from './i18n.js';
import { formatTeam } from './helpers.js';

export function renderFeed(snapshot) {
  if (!ui.feedEntries) return;
  ui.feedEntries.innerHTML = '';

  const items = buildFeedItems(snapshot);
  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'feed-empty';
    empty.textContent = t('feed_empty');
    ui.feedEntries.appendChild(empty);
    return;
  }
  for (const item of items) {
    ui.feedEntries.appendChild(item);
  }
  ui.feedEntries.scrollTop = ui.feedEntries.scrollHeight;
}

export function appendChatMessage(message) {
  if (!ui.feedEntries) return;
  const el = buildChatItem(message);
  ui.feedEntries.appendChild(el);
  ui.feedEntries.scrollTop = ui.feedEntries.scrollHeight;
}

function buildFeedItems(snapshot) {
  const items = [];
  const chatMessages = snapshot?.room?.chatMessages || [];
  const history = snapshot?.game?.history || [];
  const board = snapshot?.game?.board || [];

  const merged = [];
  for (const msg of chatMessages) {
    merged.push({ kind: 'chat', ts: msg.ts || 0, data: msg });
  }
  for (const event of history) {
    if (event.type === 'mark_toggle') continue;
    merged.push({ kind: 'game', ts: event.at || event.endedAt || 0, data: event });
  }

  merged.sort((a, b) => a.ts - b.ts);

  for (const entry of merged) {
    if (entry.kind === 'chat') {
      items.push(buildChatItem(entry.data));
    } else {
      items.push(buildGameEventItem(entry.data, board));
    }
  }
  return items;
}

function buildChatItem(message) {
  const div = document.createElement('div');
  div.className = 'feed-item feed-chat';

  const name = document.createElement('span');
  name.className = 'feed-name';
  if (message.team === 'red' || message.team === 'blue') {
    name.classList.add(message.team);
  }
  name.textContent = message.name;

  const text = document.createElement('span');
  text.className = 'feed-text';
  text.textContent = message.text;

  div.appendChild(name);
  div.appendChild(text);
  return div;
}

function buildGameEventItem(event, board) {
  const div = document.createElement('div');
  div.className = 'feed-item';

  if (event.type === 'hint') {
    div.classList.add('feed-hint', event.team || '');
    const word = String(event.word || '').toLocaleUpperCase(getLocaleTag());
    div.textContent = `${formatTeam(event.team)}: ${word} ${event.count}`;
  } else if (event.type === 'guess') {
    div.classList.add('feed-guess', event.team || '');
    const card = board[event.index];
    const word = card ? formatCardWord(card.word) : '?';
    const correct = event.color === event.team;
    const icon = correct ? '\u2713' : '\u2717';
    div.textContent = `${icon} ${word}`;
  } else if (event.type === 'turn_end') {
    div.classList.add('feed-turnend');
    div.textContent = t('feed_turn_ended');
  } else if (event.type === 'game_end') {
    div.classList.add('feed-gameend');
    div.textContent = t('feed_game_over', { team: formatTeam(event.winner) });
  } else {
    div.classList.add('feed-event');
    div.textContent = event.type;
  }

  return div;
}
