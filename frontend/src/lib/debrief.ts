import type { GameHistoryEntry, PlayerView, BoardCard } from '../types';

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function generateDebriefNarrative(
  t: (key: string, vars?: Record<string, string | number>) => string,
  history: GameHistoryEntry[],
  players: PlayerView[],
  board: BoardCard[]
): string {
  if (!Array.isArray(history) || history.length === 0) {
    return `<p>${t('debrief_no_data')}</p>`;
  }

  const playerMap = Object.fromEntries(players.map((player) => [player.sessionId, escapeHtml(player.name || 'Unknown')]));
  const boardMap = Object.fromEntries(board.map((card) => [card.index, card]));

  let html = '<div class="debrief-report">';
  html += `<h2>${t('debrief_title_header')}</h2>`;
  html += `<p class="debrief-classification">${t('debrief_classification')}</p>`;
  html += '<hr>';

  let turnNumber = 0;

  for (const entry of history) {
    const type = String((entry as { type?: string }).type || '');
    const agentName = playerMap[String((entry as { by?: string }).by || '')] || 'Unknown';

    if (type === 'hint') {
      const hintEntry = entry as {
        team: string;
        word: string;
        count: number;
      };
      turnNumber += 1;
      const teamLabel = hintEntry.team === 'red' ? t('team_red').toUpperCase() : t('team_blue').toUpperCase();
      html += `<div class="debrief-entry hint ${hintEntry.team}">`;
      html += `<p class="debrief-turn">${t('debrief_transmission', { n: turnNumber })}</p>`;
      html += `<p>${t('debrief_hint_entry', {
        agent: agentName,
        team: teamLabel,
        word: escapeHtml(String(hintEntry.word || '').toUpperCase()),
        count: hintEntry.count,
      })}</p>`;
      html += '</div>';
      continue;
    }

    if (type === 'guess') {
      const guessEntry = entry as {
        index: number;
        team: string;
        color: string;
      };
      const card = boardMap[guessEntry.index];
      const wordName = escapeHtml(card ? card.word : `Card #${guessEntry.index}`);
      let outcome = '';
      if (guessEntry.color === guessEntry.team) outcome = t('debrief_outcome_correct');
      else if (guessEntry.color === 'assassin') outcome = t('debrief_outcome_assassin');
      else if (guessEntry.color === 'neutral') outcome = t('debrief_outcome_neutral');
      else outcome = t('debrief_outcome_wrong');

      html += `<div class="debrief-entry guess ${guessEntry.color}">`;
      html += `<p>${t('debrief_guess_entry', {
        agent: agentName,
        word: wordName,
        color: String(guessEntry.color || 'unknown').toUpperCase(),
        outcome,
      })}</p>`;
      html += '</div>';
      continue;
    }

    if (type === 'turn_end') {
      const turnEntry = entry as { reason?: string };
      html += '<div class="debrief-entry turn-end">';
      html += `<p class="debrief-divider">${t('debrief_turn_concluded', { reason: formatTurnEndReason(t, turnEntry.reason || 'unknown') })}</p>`;
      html += '</div>';
      continue;
    }

    if (type === 'game_end') {
      const gameEnd = entry as { winner?: string; reason?: string };
      const winner = gameEnd.winner === 'red' ? t('team_red').toUpperCase() : t('team_blue').toUpperCase();
      html += '<div class="debrief-entry game-end">';
      html += '<hr>';
      html += `<p class="debrief-conclusion"><strong>${t('debrief_mission_concluded')}</strong></p>`;
      html += `<p>${t('debrief_victor', { team: winner })}</p>`;
      html += `<p>${t('debrief_reason', { reason: formatGameEndReason(t, gameEnd.reason || '') })}</p>`;
      html += '</div>';
    }
  }

  html += '</div>';
  return html;
}

function formatTurnEndReason(t: (key: string) => string, reason: string): string {
  switch (reason) {
    case 'player_ended':
      return t('debrief_turn_reason_player_ended');
    case 'guess_limit_reached':
      return t('debrief_turn_reason_guess_limit');
    case 'neutral_card':
      return t('debrief_turn_reason_neutral');
    case 'opponent_card':
      return t('debrief_turn_reason_opponent');
    case 'hint_timeout':
      return t('debrief_turn_reason_hint_timeout');
    case 'guess_timeout':
      return t('debrief_turn_reason_guess_timeout');
    default:
      return reason;
  }
}

function formatGameEndReason(t: (key: string) => string, reason: string): string {
  switch (reason) {
    case 'assassin':
      return t('debrief_game_reason_assassin');
    case 'all_agents_revealed':
      return t('debrief_game_reason_all_agents');
    case 'opponent_agents_revealed':
      return t('debrief_game_reason_opponent');
    default:
      return reason || t('debrief_no_data');
  }
}
