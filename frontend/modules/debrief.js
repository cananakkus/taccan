export function generateDebriefNarrative(history, players, board) {
  if (!history || !Array.isArray(history)) return '<p>No mission data available.</p>';

  const playerMap = {};
  if (Array.isArray(players)) {
    for (const p of players) {
      playerMap[p.sessionId] = p.name || 'Unknown Agent';
    }
  }

  const boardMap = {};
  if (Array.isArray(board)) {
    for (const card of board) {
      boardMap[card.index] = card;
    }
  }

  let html = '<div class="debrief-report">';
  html += '<h2>INTELLIGENCE DEBRIEF</h2>';
  html += '<p class="debrief-classification">CLASSIFICATION: TOP SECRET</p>';
  html += '<hr>';

  let turnNumber = 0;

  for (const entry of history) {
    const agentName = playerMap[entry.by] || 'Unknown';

    switch (entry.type) {
      case 'hint': {
        turnNumber++;
        const teamLabel = entry.team === 'red' ? 'RED' : 'BLUE';
        html += `<div class="debrief-entry hint ${entry.team}">`;
        html += `<p class="debrief-turn">TRANSMISSION #${turnNumber}</p>`;
        html += `<p>Handler <strong>${agentName}</strong> (${teamLabel}) transmitted coded signal: `;
        html += `<strong>"${String(entry.word).toUpperCase()}"</strong> &mdash; ${entry.count} targets.</p>`;
        html += '</div>';
        break;
      }
      case 'guess': {
        const card = boardMap[entry.index];
        const wordName = card ? card.word : `Card #${entry.index}`;
        const colorLabel = entry.color || 'unknown';
        let outcome = '';
        if (entry.color === entry.team) {
          outcome = 'Positive identification confirmed.';
        } else if (entry.color === 'assassin') {
          outcome = 'CRITICAL FAILURE: Assassin contact triggered.';
        } else if (entry.color === 'neutral') {
          outcome = 'Civilian contact. Operation paused.';
        } else {
          outcome = 'Compromised! Enemy agent exposed.';
        }
        html += `<div class="debrief-entry guess ${colorLabel}">`;
        html += `<p>Field Agent <strong>${agentName}</strong> investigated <strong>${wordName}</strong> `;
        html += `[${colorLabel.toUpperCase()}]. ${outcome}</p>`;
        html += '</div>';
        break;
      }
      case 'turn_end': {
        const reason = entry.reason || 'unknown';
        html += `<div class="debrief-entry turn-end">`;
        html += `<p class="debrief-divider">&mdash; Turn concluded: ${formatTurnEndReason(reason)} &mdash;</p>`;
        html += '</div>';
        break;
      }
      case 'game_end': {
        const winner = entry.winner === 'red' ? 'RED' : 'BLUE';
        html += `<div class="debrief-entry game-end">`;
        html += '<hr>';
        html += `<p class="debrief-conclusion"><strong>MISSION CONCLUDED</strong></p>`;
        html += `<p>Victor: <strong>${winner} DIVISION</strong></p>`;
        html += `<p>Reason: ${formatGameEndReason(entry.reason)}</p>`;
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
    case 'player_ended': return 'Voluntary stand-down';
    case 'guess_limit_reached': return 'Intelligence budget exhausted';
    case 'neutral_card': return 'Civilian interference';
    case 'opponent_card': return 'Enemy contact';
    case 'hint_timeout': return 'Signal window expired';
    case 'guess_timeout': return 'Field operation timed out';
    default: return reason;
  }
}

function formatGameEndReason(reason) {
  switch (reason) {
    case 'assassin': return 'Assassin protocol activated';
    case 'all_agents_revealed': return 'All agents successfully identified';
    case 'opponent_agents_revealed': return 'Opposing agents exposed by error';
    default: return reason || 'Unknown';
  }
}
