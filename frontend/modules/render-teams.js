import { state } from './state.js';
import { ui } from './ui.js';
import { t } from './i18n.js';
import { formatRoleLabel, formatTeam, truncateMarkerName } from './helpers.js';
import { getAvatarColor, getInitials } from './identity.js';

export function renderTeamBoxes(snapshot) {
  const me = snapshot.me;
  ui.redTeamList.innerHTML = '';
  ui.blueTeamList.innerHTML = '';

  const currentIds = new Set();

  for (const player of snapshot.players) {
    const targetList = player.team === 'red' ? ui.redTeamList : player.team === 'blue' ? ui.blueTeamList : null;
    if (!targetList) continue;
    currentIds.add(player.sessionId);
    const item = buildTeamPlayerItem(player, me, snapshot);

    // Highlight newly joined players
    if (state.knownPlayerIds.size > 0 && !state.knownPlayerIds.has(player.sessionId)) {
      item.classList.add('player-new');
      item.addEventListener('animationend', function handler() {
        item.classList.remove('player-new');
        item.removeEventListener('animationend', handler);
      }, { once: true });
    }

    targetList.appendChild(item);
  }

  state.knownPlayerIds = currentIds;

  fillEmptyTeamList(ui.redTeamList, t('no_red_agents'));
  fillEmptyTeamList(ui.blueTeamList, t('no_blue_agents'));
}

function buildTeamPlayerItem(player, me, snapshot) {
  const item = document.createElement('li');
  item.className = 'team-player-item';
  item.dataset.sessionId = player.sessionId;

  // Speaking glow
  if (state.voiceSpeaking.has(player.sessionId)) {
    item.classList.add('speaking');
  }

  const avatar = document.createElement('span');
  avatar.className = 'player-avatar';
  avatar.style.backgroundColor = getAvatarColor(player.name);
  avatar.textContent = getInitials(player.name);
  item.appendChild(avatar);

  const info = document.createElement('div');
  info.className = 'team-player-info';

  const name = document.createElement('div');
  name.className = 'team-player-name';
  name.textContent = player.sessionId === me.sessionId ? `${player.name} ${t('you_suffix')}` : player.name;
  info.appendChild(name);

  const meta = document.createElement('div');
  meta.className = 'player-meta';

  const roleTag = document.createElement('span');
  roleTag.className = 'tag';
  roleTag.textContent = formatRoleLabel(player.role);
  meta.appendChild(roleTag);

  if (player.isHost) {
    const hostTag = document.createElement('span');
    hostTag.className = 'tag host';
    hostTag.textContent = t('tag_host');
    meta.appendChild(hostTag);
  }

  if (!player.connected) {
    const offlineTag = document.createElement('span');
    offlineTag.className = 'tag offline';
    offlineTag.textContent = t('tag_offline');
    meta.appendChild(offlineTag);
  }

  // Thinking indicator
  if (snapshot.game && snapshot.game.phase === 'guess' && player.role === 'operative' &&
      player.team === snapshot.game.currentTeam && player.sessionId !== me.sessionId) {
    const hasMarks = snapshot.game.board.some(card =>
      !card.revealed && Array.isArray(card.marks) && card.marks.some(m => m.sessionId === player.sessionId)
    );
    if (hasMarks) {
      const thinkingTag = document.createElement('span');
      thinkingTag.className = 'tag thinking';
      thinkingTag.textContent = '...';
      meta.appendChild(thinkingTag);
    }
  }

  // Voice chat tags
  if (state.voicePeers.has(player.sessionId) ||
      (state.voiceActive && player.sessionId === me.sessionId)) {
    if (state.voiceMutedPeers.has(player.sessionId) ||
        (player.sessionId === me.sessionId && state.voiceMuted)) {
      const mutedTag = document.createElement('span');
      mutedTag.className = 'tag voice-muted';
      mutedTag.textContent = t('voice_muted_badge');
      meta.appendChild(mutedTag);
    } else {
      const voiceTag = document.createElement('span');
      voiceTag.className = 'tag voice';
      voiceTag.textContent = t('voice_tag');
      meta.appendChild(voiceTag);
    }
  }

  info.appendChild(meta);
  item.appendChild(info);
  return item;
}

function fillEmptyTeamList(list, text) {
  if (!list || list.childElementCount > 0) return;
  const item = document.createElement('li');
  item.className = 'team-empty';
  item.textContent = text;
  list.appendChild(item);
}
