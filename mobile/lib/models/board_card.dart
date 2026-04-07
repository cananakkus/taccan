import '../core/constants.dart';

class CardMark {
  final String sessionId;
  final String name;
  final Team team;
  final Confidence confidence;

  const CardMark({
    required this.sessionId,
    required this.name,
    required this.team,
    this.confidence = Confidence.firm,
  });

  factory CardMark.fromJson(Map<String, dynamic> json) => CardMark(
        sessionId: json['sessionId'] as String? ?? '',
        name: json['name'] as String? ?? '',
        team: Team.fromString(json['team'] as String?),
        confidence: Confidence.fromString(json['confidence'] as String?),
      );
}

class BoardCard {
  final int index;
  final String word;
  final bool revealed;
  final String? revealedBy;
  final CardColor? color;
  final List<CardMark> marks;

  const BoardCard({
    required this.index,
    required this.word,
    this.revealed = false,
    this.revealedBy,
    this.color,
    this.marks = const [],
  });

  factory BoardCard.fromJson(Map<String, dynamic> json) => BoardCard(
        index: json['index'] as int? ?? 0,
        word: json['word'] as String? ?? '',
        revealed: json['revealed'] as bool? ?? false,
        revealedBy: json['revealedBy'] as String?,
        color: json['color'] != null
            ? CardColor.fromString(json['color'] as String)
            : null,
        marks: (json['marks'] as List<dynamic>?)
                ?.map((m) => CardMark.fromJson(m as Map<String, dynamic>))
                .toList() ??
            const [],
      );
}
