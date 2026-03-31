import { t } from './i18n.js';
import { escapeHtml } from './helpers.js';

export function generateDebriefNarrative(history, players, board) {
  if (!history || !Array.isArray(history)) return `<p>${t('debrief_no_data')}</p>`;

  const playerMap = {};
  if (Array.isArray(players)) {
    for (const p of players) {
      playerMap[p.sessionId] = escapeHtml(p.name || 'Unknown Agent');
    }
  }

  const boardMap = {};
  if (Array.isArray(board)) {
    for (const card of board) {
      boardMap[card.index] = card;
    }
  }

  let html = '<div class="debrief-report">';
  html += `<h2>${t('debrief_title_header')}</h2>`;
  html += `<p class="debrief-classification">${t('debrief_classification')}</p>`;
  html += '<hr>';

  let turnNumber = 0;

  for (const entry of history) {
    const agentName = playerMap[entry.by] || 'Unknown';

    switch (entry.type) {
      case 'hint': {
        turnNumber++;
        const teamLabel = entry.team === 'red' ? t('team_red').toUpperCase() : t('team_blue').toUpperCase();
        html += `<div class="debrief-entry hint ${entry.team}">`;
        html += `<p class="debrief-turn">${t('debrief_transmission', { n: turnNumber })}</p>`;
        html += `<p>${t('debrief_hint_entry', { agent: agentName, team: teamLabel, word: escapeHtml(String(entry.word).toUpperCase()), count: entry.count })}</p>`;
        html += '</div>';
        break;
      }
      case 'guess': {
        const card = boardMap[entry.index];
        const wordName = escapeHtml(card ? card.word : `Card #${entry.index}`);
        const colorLabel = entry.color || 'unknown';
        let outcome = '';
        if (entry.color === entry.team) {
          outcome = t('debrief_outcome_correct');
        } else if (entry.color === 'assassin') {
          outcome = t('debrief_outcome_assassin');
        } else if (entry.color === 'neutral') {
          outcome = t('debrief_outcome_neutral');
        } else {
          outcome = t('debrief_outcome_wrong');
        }
        html += `<div class="debrief-entry guess ${colorLabel}">`;
        html += `<p>${t('debrief_guess_entry', { agent: agentName, word: wordName, color: colorLabel.toUpperCase(), outcome })}</p>`;
        html += '</div>';
        break;
      }
      case 'turn_end': {
        html += `<div class="debrief-entry turn-end">`;
        html += `<p class="debrief-divider">${t('debrief_turn_concluded', { reason: formatTurnEndReason(entry.reason || 'unknown') })}</p>`;
        html += '</div>';
        break;
      }
      case 'game_end': {
        const winner = entry.winner === 'red' ? t('team_red').toUpperCase() : t('team_blue').toUpperCase();
        html += `<div class="debrief-entry game-end">`;
        html += '<hr>';
        html += `<p class="debrief-conclusion"><strong>${t('debrief_mission_concluded')}</strong></p>`;
        html += `<p>${t('debrief_victor', { team: winner })}</p>`;
        html += `<p>${t('debrief_reason', { reason: formatGameEndReason(entry.reason) })}</p>`;
        html += '</div>';
        break;
      }
    }
  }

  html += '</div>';
  return html;
}

function formatTurnEndReason(reason) {
  switch (reason) {
    case 'player_ended':       return t('debrief_turn_reason_player_ended');
    case 'guess_limit_reached': return t('debrief_turn_reason_guess_limit');
    case 'neutral_card':       return t('debrief_turn_reason_neutral');
    case 'opponent_card':      return t('debrief_turn_reason_opponent');
    case 'hint_timeout':       return t('debrief_turn_reason_hint_timeout');
    case 'guess_timeout':      return t('debrief_turn_reason_guess_timeout');
    default: return reason;
  }
}

function formatGameEndReason(reason) {
  switch (reason) {
    case 'assassin':              return t('debrief_game_reason_assassin');
    case 'all_agents_revealed':   return t('debrief_game_reason_all_agents');
    case 'opponent_agents_revealed': return t('debrief_game_reason_opponent');
    default: return reason || t('debrief_no_data');
  }
}
