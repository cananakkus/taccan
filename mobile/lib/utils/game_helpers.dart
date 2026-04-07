import 'package:flutter/material.dart' show Color;

import '../core/constants.dart';
import '../models/snapshot.dart';

bool canHint(Snapshot? snapshot) {
  final game = snapshot?.game;
  final me = snapshot?.me;
  if (game == null || me == null) return false;
  return game.phase == GamePhase.hint &&
      me.role == PlayerRole.spymaster &&
      me.team == game.currentTeam;
}

bool canGuess(Snapshot? snapshot) {
  final game = snapshot?.game;
  final me = snapshot?.me;
  if (game == null || me == null) return false;
  return game.phase == GamePhase.guess &&
      me.role == PlayerRole.operative &&
      me.team == game.currentTeam;
}

bool canMark(Snapshot? snapshot) {
  return canGuess(snapshot);
}

bool isSpymaster(Snapshot? snapshot) {
  final me = snapshot?.me;
  return me?.role == PlayerRole.spymaster;
}

String formatTeam(Team? team) => switch (team) {
      Team.red => 'Red',
      Team.blue => 'Blue',
      _ => '',
    };

String formatRole(PlayerRole? role) => switch (role) {
      PlayerRole.spymaster => 'Spymaster',
      PlayerRole.operative => 'Operative',
      PlayerRole.spectator => 'Spectator',
      _ => '',
    };

String formatPhase(GamePhase? phase, Team? team) => switch (phase) {
      GamePhase.hint => '${formatTeam(team)} — Spymaster hinting',
      GamePhase.guess => '${formatTeam(team)} — Operatives guessing',
      GamePhase.finished => 'Game Over',
      _ => '',
    };

String formatTimer(int ms) {
  if (ms <= 0) return '0:00';
  final seconds = (ms / 1000).ceil();
  final m = seconds ~/ 60;
  final s = seconds % 60;
  return '$m:${s.toString().padLeft(2, '0')}';
}

Color teamColor(Team team, dynamic cardTheme) {
  if (team == Team.red) return cardTheme.red as Color;
  if (team == Team.blue) return cardTheme.blue as Color;
  return const Color(0xFF888888);
}
