class SessionRecord {
  final String code;
  final String sessionId;
  final String name;

  const SessionRecord({
    required this.code,
    required this.sessionId,
    required this.name,
  });

  Map<String, dynamic> toJson() => {
        'code': code,
        'sessionId': sessionId,
        'name': name,
      };

  factory SessionRecord.fromJson(Map<String, dynamic> json) => SessionRecord(
        code: json['code'] as String? ?? '',
        sessionId: json['sessionId'] as String? ?? '',
        name: json['name'] as String? ?? '',
      );

  SessionRecord copyWith({String? code, String? sessionId, String? name}) =>
      SessionRecord(
        code: code ?? this.code,
        sessionId: sessionId ?? this.sessionId,
        name: name ?? this.name,
      );
}
