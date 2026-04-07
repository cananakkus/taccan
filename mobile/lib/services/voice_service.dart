import 'dart:async';
import 'dart:convert';

import 'package:flutter_webrtc/flutter_webrtc.dart';

import 'socket_service.dart';

const _stunConfig = <String, dynamic>{
  'iceServers': [
    {'urls': 'stun:stun.l.google.com:19302'},
    {'urls': 'stun:stun1.l.google.com:19302'},
  ],
};

class _PeerEntry {
  final RTCPeerConnection pc;
  MediaStream? remoteStream;

  _PeerEntry({required this.pc});
}

class VoiceService {
  final SocketService _socket;

  final Map<String, _PeerEntry> _peers = {};
  MediaStream? _localStream;
  StreamSubscription<SocketEvent>? _eventSub;
  bool _initialized = false;

  // Callbacks
  void Function(String sessionId)? onPeerJoined;
  void Function(String sessionId)? onPeerLeft;
  void Function(String sessionId, bool muted)? onPeerMuteChanged;
  void Function(String sessionId, MediaStream stream)? onRemoteStream;

  VoiceService(this._socket);

  void initialize() {
    if (_initialized) return;
    _initialized = true;

    _eventSub = _socket.events.listen((event) {
      switch (event.name) {
        case 'voice:peer_joined':
          final sessionId = event.data['sessionId'] as String? ?? '';
          if (sessionId.isEmpty || _localStream == null) return;
          onPeerJoined?.call(sessionId);
          _createPeerConnection(sessionId, true);

        case 'voice:peer_left':
          final sessionId = event.data['sessionId'] as String? ?? '';
          _closePeer(sessionId);
          onPeerLeft?.call(sessionId);

        case 'voice:signal':
          _handleSignal(event.data);

        case 'voice:mute_changed':
          final sessionId = event.data['sessionId'] as String? ?? '';
          final muted = event.data['muted'] as bool? ?? false;
          onPeerMuteChanged?.call(sessionId, muted);

        case 'disconnect':
          destroyAllPeers();
      }
    });
  }

  Future<List<String>> join() async {
    // Get microphone
    _localStream = await navigator.mediaDevices.getUserMedia({
      'audio': {
        'noiseSuppression': true,
        'echoCancellation': true,
        'autoGainControl': true,
      },
      'video': false,
    });

    // Join voice channel
    final response = await _socket.emitWithAck('voice:join', {});
    final peers = (response['peers'] as List?)?.cast<String>() ?? [];

    // Create peer connections for existing peers
    for (final peerId in peers) {
      await _createPeerConnection(peerId, true);
    }

    return peers;
  }

  void leave() {
    destroyAllPeers();
    _stopLocalStream();
    _socket.emitWithAck('voice:leave', {}).catchError((_) => <String, dynamic>{});
  }

  void setMuted(bool muted) {
    if (_localStream == null) return;
    for (final track in _localStream!.getAudioTracks()) {
      track.enabled = !muted;
    }
    _socket.emitWithAck('voice:mute', {'muted': muted}).catchError((_) => <String, dynamic>{});
  }

  Future<void> _createPeerConnection(String sessionId, bool isInitiator) async {
    if (_peers.containsKey(sessionId)) return;

    final pc = await createPeerConnection(_stunConfig);
    final entry = _PeerEntry(pc: pc);
    _peers[sessionId] = entry;

    // Add local tracks
    if (_localStream != null) {
      for (final track in _localStream!.getTracks()) {
        await pc.addTrack(track, _localStream!);
      }
    }

    // ICE candidates
    pc.onIceCandidate = (candidate) {
      if (candidate.candidate == null) return;
      _socket.emitWithAck('voice:signal', {
        'targetSessionId': sessionId,
        'type': 'candidate',
        'candidate': jsonEncode(candidate.toMap()),
      }).catchError((_) => <String, dynamic>{});
    };

    // Remote stream
    pc.onTrack = (event) {
      if (event.streams.isNotEmpty) {
        entry.remoteStream = event.streams[0];
        onRemoteStream?.call(sessionId, event.streams[0]);
      }
    };

    // Connection state
    pc.onConnectionState = (state) {
      if (state == RTCPeerConnectionState.RTCPeerConnectionStateFailed) {
        _closePeer(sessionId);
      }
    };

    // Initiate offer if we're the initiator
    if (isInitiator) {
      try {
        final offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await _socket.emitWithAck('voice:signal', {
          'targetSessionId': sessionId,
          'type': 'offer',
          'sdp': offer.sdp ?? '',
        });
      } catch (_) {
        _closePeer(sessionId);
      }
    }
  }

  Future<void> _handleSignal(Map<String, dynamic> data) async {
    final fromSessionId = data['fromSessionId'] as String? ?? '';
    final type = data['type'] as String? ?? '';
    final sdp = data['sdp'] as String?;
    final candidateStr = data['candidate'] as String?;

    if (type == 'offer') {
      // Create peer if doesn't exist, then handle offer
      if (!_peers.containsKey(fromSessionId)) {
        await _createPeerConnection(fromSessionId, false);
      }
      final entry = _peers[fromSessionId];
      if (entry == null || sdp == null) return;

      await entry.pc.setRemoteDescription(
        RTCSessionDescription(sdp, 'offer'),
      );
      final answer = await entry.pc.createAnswer();
      await entry.pc.setLocalDescription(answer);
      await _socket.emitWithAck('voice:signal', {
        'targetSessionId': fromSessionId,
        'type': 'answer',
        'sdp': answer.sdp ?? '',
      }).catchError((_) => <String, dynamic>{});
      return;
    }

    final entry = _peers[fromSessionId];
    if (entry == null) return;

    if (type == 'answer' && sdp != null) {
      await entry.pc.setRemoteDescription(
        RTCSessionDescription(sdp, 'answer'),
      );
    }

    if (type == 'candidate' && candidateStr != null) {
      try {
        final map = jsonDecode(candidateStr) as Map<String, dynamic>;
        await entry.pc.addCandidate(RTCIceCandidate(
          map['candidate'] as String?,
          map['sdpMid'] as String?,
          map['sdpMLineIndex'] as int?,
        ));
      } catch (_) {}
    }
  }

  void _closePeer(String sessionId) {
    final entry = _peers.remove(sessionId);
    if (entry != null) {
      entry.pc.close();
      entry.remoteStream?.dispose();
    }
  }

  void destroyAllPeers() {
    for (final sessionId in [..._peers.keys]) {
      _closePeer(sessionId);
    }
  }

  void _stopLocalStream() {
    if (_localStream == null) return;
    for (final track in _localStream!.getTracks()) {
      track.stop();
    }
    _localStream?.dispose();
    _localStream = null;
  }

  void dispose() {
    _eventSub?.cancel();
    destroyAllPeers();
    _stopLocalStream();
  }
}
