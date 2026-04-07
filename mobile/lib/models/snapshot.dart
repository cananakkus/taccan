import '../core/constants.dart';
import 'board_card.dart';
import 'chat_message.dart';

class ModeConfig {
  final int? hintTimerMs;
  final int? guessTimerMs;
  final int? maxHintCount;

  const ModeConfig({this.hintTimerMs, this.guessTimerMs, this.maxHintCount});

  factory ModeConfig.fromJson(Map<String, dynamic>? json) {
    if (json == null) return const ModeConfig();
    return ModeConfig(
      hintTimerMs: json['hintTimerMs'] as int?,
      guessTimerMs: json['guessTimerMs'] as int?,
      maxHintCount: json['maxHintCount'] as int?,
    );
  }
}

class MatchInfo {
  final String id;
  final int roundNumber;

  const MatchInfo({required this.id, required this.roundNumber});

  factory MatchInfo.fromJson(Map<String, dynamic> json) => MatchInfo(
        id: json['id'] as String? ?? '',
        roundNumber: json['roundNumber'] as int? ?? 1,
      );
}

class RoomView {
  final String code;
  final RoomStatus status;
  final String? hostSessionId;
  final int createdAt;
  final RoomMode mode;
  final ModeConfig modeConfig;
  final MatchInfo? match;
  final List<ChatMessage> chatMessages;

  const RoomView({
    required this.code,
    required this.status,
    this.hostSessionId,
    required this.createdAt,
    required this.mode,
    required this.modeConfig,
    this.match,
    this.chatMessages = const [],
  });

  factory RoomView.fromJson(Map<String, dynamic> json) => RoomView(
        code: json['code'] as String? ?? '',
        status: RoomStatus.fromString(json['status'] as String?),
        hostSessionId: json['hostSessionId'] as String?,
        createdAt: json['createdAt'] as int? ?? 0,
        mode: RoomMode.fromString(json['mode'] as String?),
        modeConfig: ModeConfig.fromJson(json['modeConfig'] as Map<String, dynamic>?),
        match: json['match'] != null
            ? MatchInfo.fromJson(json['match'] as Map<String, dynamic>)
            : null,
        chatMessages: (json['chatMessages'] as List<dynamic>?)
                ?.map((m) => ChatMessage.fromJson(m as Map<String, dynamic>))
                .toList() ??
            const [],
      );
}

class PlayerView {
  final String sessionId;
  final String name;
  final Team team;
  final PlayerRole role;
  final bool connected;
  final int joinedAt;
  final bool isHost;

  const PlayerView({
    required this.sessionId,
    required this.name,
    required this.team,
    required this.role,
    required this.connected,
    required this.joinedAt,
    required this.isHost,
  });

  factory PlayerView.fromJson(Map<String, dynamic> json) => PlayerView(
        sessionId: json['sessionId'] as String? ?? '',
        name: json['name'] as String? ?? '',
        team: Team.fromString(json['team'] as String?),
        role: PlayerRole.fromString(json['role'] as String?),
        connected: json['connected'] as bool? ?? false,
        joinedAt: json['joinedAt'] as int? ?? 0,
        isHost: json['isHost'] as bool? ?? false,
      );
}

class MeView {
  final String sessionId;
  final String name;
  final Team team;
  final PlayerRole role;
  final bool connected;
  final bool isHost;

  const MeView({
    required this.sessionId,
    required this.name,
    required this.team,
    required this.role,
    required this.connected,
    required this.isHost,
  });

  factory MeView.fromJson(Map<String, dynamic> json) => MeView(
        sessionId: json['sessionId'] as String? ?? '',
        name: json['name'] as String? ?? '',
        team: Team.fromString(json['team'] as String?),
        role: PlayerRole.fromString(json['role'] as String?),
        connected: json['connected'] as bool? ?? false,
        isHost: json['isHost'] as bool? ?? false,
      );
}

class HintView {
  final String word;
  final int count;
  final Team team;
  final String by;
  final int at;

  const HintView({
    required this.word,
    required this.count,
    required this.team,
    required this.by,
    required this.at,
  });

  factory HintView.fromJson(Map<String, dynamic> json) => HintView(
        word: json['word'] as String? ?? '',
        count: json['count'] as int? ?? 0,
        team: Team.fromString(json['team'] as String?),
        by: json['by'] as String? ?? '',
        at: json['at'] as int? ?? 0,
      );
}

class PhaseTimer {
  final String phase;
  final int startedAt;
  final int endsAt;
  final int durationMs;

  const PhaseTimer({
    required this.phase,
    required this.startedAt,
    required this.endsAt,
    required this.durationMs,
  });

  factory PhaseTimer.fromJson(Map<String, dynamic> json) => PhaseTimer(
        phase: json['phase'] as String? ?? '',
        startedAt: json['startedAt'] as int? ?? 0,
        endsAt: json['endsAt'] as int? ?? 0,
        durationMs: json['durationMs'] as int? ?? 0,
      );
}

class RemainingAgents {
  final int red;
  final int blue;

  const RemainingAgents({required this.red, required this.blue});

  factory RemainingAgents.fromJson(Map<String, dynamic> json) =>
      RemainingAgents(
        red: json['red'] as int? ?? 0,
        blue: json['blue'] as int? ?? 0,
      );
}

class GameView {
  final String id;
  final String? matchId;
  final int? roundNumber;
  final GamePhase phase;
  final Team currentTeam;
  final Team startingTeam;
  final int turnNumber;
  final RoomMode mode;
  final int? seed;
  final int? maxHintCount;
  final PhaseTimer? phaseTimer;
  final HintView? hint;
  final int? guessesRemaining;
  final RemainingAgents remaining;
  final Team? winner;
  final Team? loser;
  final String? reason;
  final bool showKeycard;
  final List<Map<String, dynamic>> history;
  final List<BoardCard> board;

  const GameView({
    required this.id,
    this.matchId,
    this.roundNumber,
    required this.phase,
    required this.currentTeam,
    required this.startingTeam,
    required this.turnNumber,
    required this.mode,
    this.seed,
    this.maxHintCount,
    this.phaseTimer,
    this.hint,
    this.guessesRemaining,
    required this.remaining,
    this.winner,
    this.loser,
    this.reason,
    this.showKeycard = false,
    this.history = const [],
    this.board = const [],
  });

  factory GameView.fromJson(Map<String, dynamic> json) => GameView(
        id: json['id'] as String? ?? '',
        matchId: json['matchId'] as String?,
        roundNumber: json['roundNumber'] as int?,
        phase: GamePhase.fromString(json['phase'] as String?),
        currentTeam: Team.fromString(json['currentTeam'] as String?),
        startingTeam: Team.fromString(json['startingTeam'] as String?),
        turnNumber: json['turnNumber'] as int? ?? 0,
        mode: RoomMode.fromString(json['mode'] as String?),
        seed: json['seed'] as int?,
        maxHintCount: json['maxHintCount'] as int?,
        phaseTimer: json['phaseTimer'] != null
            ? PhaseTimer.fromJson(json['phaseTimer'] as Map<String, dynamic>)
            : null,
        hint: json['hint'] != null
            ? HintView.fromJson(json['hint'] as Map<String, dynamic>)
            : null,
        guessesRemaining: json['guessesRemaining'] as int?,
        remaining: RemainingAgents.fromJson(
            json['remaining'] as Map<String, dynamic>? ?? {'red': 0, 'blue': 0}),
        winner: json['winner'] != null
            ? Team.fromString(json['winner'] as String)
            : null,
        loser: json['loser'] != null
            ? Team.fromString(json['loser'] as String)
            : null,
        reason: json['reason'] as String?,
        showKeycard: json['showKeycard'] as bool? ?? false,
        history: (json['history'] as List<dynamic>?)
                ?.map((e) => Map<String, dynamic>.from(e as Map))
                .toList() ??
            const [],
        board: (json['board'] as List<dynamic>?)
                ?.map((c) => BoardCard.fromJson(c as Map<String, dynamic>))
                .toList() ??
            const [],
      );
}

class Snapshot {
  final int now;
  final RoomView room;
  final MeView me;
  final List<PlayerView> players;
  final GameView? game;

  const Snapshot({
    required this.now,
    required this.room,
    required this.me,
    required this.players,
    this.game,
  });

  factory Snapshot.fromJson(Map<String, dynamic> json) => Snapshot(
        now: json['now'] as int? ?? 0,
        room: RoomView.fromJson(json['room'] as Map<String, dynamic>? ?? {}),
        me: MeView.fromJson(json['me'] as Map<String, dynamic>? ?? {}),
        players: (json['players'] as List<dynamic>?)
                ?.map((p) => PlayerView.fromJson(p as Map<String, dynamic>))
                .toList() ??
            const [],
        game: json['game'] != null
            ? GameView.fromJson(json['game'] as Map<String, dynamic>)
            : null,
      );
}
