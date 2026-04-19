import 'package:flutter_riverpod/flutter_riverpod.dart';

class VoicePeer {
  final String sessionId;

  const VoicePeer({required this.sessionId});
}

class VoiceState {
  final bool active;
  final bool muted;
  final bool joining;
  final List<VoicePeer> peers;
  final Set<String> speakingIds;
  final Set<String> mutedPeerIds;

  const VoiceState({
    this.active = false,
    this.muted = false,
    this.joining = false,
    this.peers = const [],
    this.speakingIds = const {},
    this.mutedPeerIds = const {},
  });

  VoiceState copyWith({
    bool? active,
    bool? muted,
    bool? joining,
    List<VoicePeer>? peers,
    Set<String>? speakingIds,
    Set<String>? mutedPeerIds,
  }) =>
      VoiceState(
        active: active ?? this.active,
        muted: muted ?? this.muted,
        joining: joining ?? this.joining,
        peers: peers ?? this.peers,
        speakingIds: speakingIds ?? this.speakingIds,
        mutedPeerIds: mutedPeerIds ?? this.mutedPeerIds,
      );
}

final voiceProvider = StateNotifierProvider<VoiceNotifier, VoiceState>((ref) {
  return VoiceNotifier();
});

class VoiceNotifier extends StateNotifier<VoiceState> {
  VoiceNotifier() : super(const VoiceState());

  void setActive(bool value) => state = state.copyWith(active: value);
  void setMuted(bool value) => state = state.copyWith(muted: value);
  void setJoining(bool value) => state = state.copyWith(joining: value);

  void setPeer(String sessionId) {
    if (state.peers.any((p) => p.sessionId == sessionId)) return;
    state = state.copyWith(peers: [...state.peers, VoicePeer(sessionId: sessionId)]);
  }

  void removePeer(String sessionId) {
    state = state.copyWith(
      peers: state.peers.where((p) => p.sessionId != sessionId).toList(),
      speakingIds: {...state.speakingIds}..remove(sessionId),
      mutedPeerIds: {...state.mutedPeerIds}..remove(sessionId),
    );
  }

  void setSpeaking(String sessionId, bool speaking) {
    final ids = {...state.speakingIds};
    if (speaking) {
      ids.add(sessionId);
    } else {
      ids.remove(sessionId);
    }
    state = state.copyWith(speakingIds: ids);
  }

  void setPeerMuted(String sessionId, bool muted) {
    final ids = {...state.mutedPeerIds};
    if (muted) {
      ids.add(sessionId);
    } else {
      ids.remove(sessionId);
    }
    state = state.copyWith(mutedPeerIds: ids);
  }

  void reset() => state = const VoiceState();
}
