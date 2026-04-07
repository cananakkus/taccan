import '../core/constants.dart';

class ChatMessage {
  final String sessionId;
  final String name;
  final Team team;
  final String text;
  final int ts;

  const ChatMessage({
    required this.sessionId,
    required this.name,
    required this.team,
    required this.text,
    required this.ts,
  });

  factory ChatMessage.fromJson(Map<String, dynamic> json) => ChatMessage(
        sessionId: json['sessionId'] as String? ?? '',
        name: json['name'] as String? ?? '',
        team: Team.fromString(json['team'] as String?),
        text: json['text'] as String? ?? '',
        ts: json['ts'] as int? ?? 0,
      );
}
