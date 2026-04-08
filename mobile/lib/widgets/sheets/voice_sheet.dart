import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../providers/providers.dart';
import '../../providers/ui_provider.dart';
import '../../providers/voice_provider.dart';
import '../../services/voice_service.dart';

final voiceServiceProvider = Provider<VoiceService>((ref) {
  final socket = ref.watch(socketServiceProvider);
  final service = VoiceService(socket);
  ref.onDispose(() => service.dispose());
  return service;
});

class VoiceSheet extends ConsumerStatefulWidget {
  const VoiceSheet({super.key});

  @override
  ConsumerState<VoiceSheet> createState() => _VoiceSheetState();
}

class _VoiceSheetState extends ConsumerState<VoiceSheet> {
  @override
  void initState() {
    super.initState();
    final voiceSvc = ref.read(voiceServiceProvider);
    final voiceNotifier = ref.read(voiceProvider.notifier);

    voiceSvc.initialize();
    voiceSvc.onPeerJoined = (sessionId) => voiceNotifier.setPeer(sessionId);
    voiceSvc.onPeerLeft = (sessionId) => voiceNotifier.removePeer(sessionId);
    voiceSvc.onPeerMuteChanged = (sessionId, muted) => voiceNotifier.setPeerMuted(sessionId, muted);
  }

  Future<void> _toggleVoice() async {
    final voice = ref.read(voiceProvider);
    final voiceSvc = ref.read(voiceServiceProvider);
    final voiceNotifier = ref.read(voiceProvider.notifier);

    if (voice.active) {
      voiceSvc.leave();
      voiceNotifier.reset();
      return;
    }

    if (voice.joining) return;
    voiceNotifier.setJoining(true);

    try {
      final peers = await voiceSvc.join();
      voiceNotifier.setActive(true);
      voiceNotifier.setMuted(false);
      for (final peerId in peers) {
        voiceNotifier.setPeer(peerId);
      }
    } catch (e) {
      ref.read(toastProvider.notifier).show(e.toString(), ToastStyle.error);
      voiceSvc.leave();
      voiceNotifier.reset();
    } finally {
      voiceNotifier.setJoining(false);
    }
  }

  void _toggleMute() {
    final voice = ref.read(voiceProvider);
    if (!voice.active) return;
    final next = !voice.muted;
    ref.read(voiceProvider.notifier).setMuted(next);
    ref.read(voiceServiceProvider).setMuted(next);
  }

  @override
  Widget build(BuildContext context) {
    final voice = ref.watch(voiceProvider);
    final players = ref.watch(playersProvider);
    final colors = Theme.of(context).colorScheme;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'VOICE',
            style: GoogleFonts.playfairDisplaySc(
              fontSize: 14, letterSpacing: 1, color: colors.onSurface,
            ),
          ),
          const SizedBox(height: 12),
          if (!voice.active)
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: voice.joining ? null : _toggleVoice,
                icon: const Icon(Icons.call, size: 18),
                label: Text(
                  voice.joining ? '...' : 'Join Voice',
                  style: GoogleFonts.crimsonPro(),
                ),
              ),
            ),
          if (voice.active) ...[
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _toggleVoice,
                    icon: const Icon(Icons.call_end, size: 16),
                    label: Text('Leave', style: GoogleFonts.crimsonPro()),
                    style: OutlinedButton.styleFrom(foregroundColor: colors.error, side: BorderSide(color: colors.error)),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _toggleMute,
                    icon: Icon(voice.muted ? Icons.mic_off : Icons.mic, size: 16),
                    label: Text(voice.muted ? 'Unmute' : 'Mute', style: GoogleFonts.crimsonPro()),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            if (voice.peers.isEmpty)
              Text(
                'No one else in voice',
                style: GoogleFonts.crimsonPro(fontSize: 12, color: colors.onSurface.withValues(alpha: 0.4)),
              )
            else
              ...voice.peers.map((peer) {
                final player = players.where((p) => p.sessionId == peer.sessionId).firstOrNull;
                final name = player?.name ?? 'Unknown';
                final isSpeaking = voice.speakingIds.contains(peer.sessionId);
                final isMuted = voice.mutedPeerIds.contains(peer.sessionId);

                return Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(
                    children: [
                      AnimatedContainer(
                        duration: const Duration(milliseconds: 200),
                        width: 8, height: 8,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: isSpeaking ? Colors.green : colors.onSurface.withValues(alpha: 0.2),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          name,
                          style: GoogleFonts.crimsonPro(
                            fontSize: 13,
                            color: colors.onSurface,
                            fontWeight: isSpeaking ? FontWeight.bold : FontWeight.normal,
                          ),
                        ),
                      ),
                      if (isMuted) Icon(Icons.mic_off, size: 14, color: colors.onSurface.withValues(alpha: 0.4)),
                      const SizedBox(width: 8),
                      SizedBox(
                        width: 80,
                        child: Slider(
                          value: peer.volume.toDouble(),
                          min: 0, max: 100,
                          onChanged: (v) {
                            ref.read(voiceProvider.notifier).setPeerVolume(peer.sessionId, v.round());
                          },
                        ),
                      ),
                    ],
                  ),
                );
              }),
          ],
        ],
      ),
    );
  }
}
