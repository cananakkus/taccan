const int boardSize = 25;
const int boardColumns = 5;
const int playerNameMax = 24;
const int roomConnectedLimit = 20;
const int chatMaxLength = 200;
const int hintMaxLength = 64;

enum Team {
  red,
  blue,
  none;

  factory Team.fromString(String? value) => switch (value) {
        'red' => Team.red,
        'blue' => Team.blue,
        _ => Team.none,
      };
}

enum PlayerRole {
  spymaster,
  operative,
  spectator;

  factory PlayerRole.fromString(String? value) => switch (value) {
        'spymaster' => PlayerRole.spymaster,
        'operative' => PlayerRole.operative,
        _ => PlayerRole.spectator,
      };
}

enum RoomMode {
  casual,
  blitz;

  factory RoomMode.fromString(String? value) => switch (value) {
        'blitz' => RoomMode.blitz,
        _ => RoomMode.casual,
      };
}

enum RoomStatus {
  lobby,
  inGame,
  finished;

  factory RoomStatus.fromString(String? value) => switch (value) {
        'in_game' => RoomStatus.inGame,
        'finished' => RoomStatus.finished,
        _ => RoomStatus.lobby,
      };
}

enum GamePhase {
  hint,
  guess,
  finished;

  factory GamePhase.fromString(String? value) => switch (value) {
        'hint' => GamePhase.hint,
        'guess' => GamePhase.guess,
        'finished' => GamePhase.finished,
        _ => GamePhase.hint,
      };
}

enum CardColor {
  red,
  blue,
  neutral,
  assassin;

  factory CardColor.fromString(String? value) => switch (value) {
        'red' => CardColor.red,
        'blue' => CardColor.blue,
        'neutral' => CardColor.neutral,
        'assassin' => CardColor.assassin,
        _ => CardColor.neutral,
      };
}

enum Confidence {
  firm,
  tentative;

  factory Confidence.fromString(String? value) => switch (value) {
        'tentative' => Confidence.tentative,
        _ => Confidence.firm,
      };
}
