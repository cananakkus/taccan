import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/constants.dart';
import '../../models/snapshot.dart';
import '../../providers/providers.dart';
import '../../providers/ui_provider.dart';
import '../../theme/card_theme.dart';

class TeamsSheet extends ConsumerWidget {
  const TeamsSheet({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final players = ref.watch(playersProvider);
    final me = ref.watch(meProvider);
    final game = ref.watch(gameProvider);
    final ct = Theme.of(context).extension<TaccanCardTheme>()!;
    final colors = Theme.of(context).colorScheme;
    final isHost = me?.isHost ?? false;
    final inGame = game != null;

    final redPlayers = players.where((p) => p.team == Team.red).toList();
    final bluePlayers = players.where((p) => p.team == Team.blue).toList();

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // Header
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          child: Row(
            children: [
              Text(
                'TEAMS',
                style: GoogleFonts.playfairDisplaySc(
                  fontSize: 14,
                  letterSpacing: 1,
                  color: colors.onSurface,
                ),
              ),
              const Spacer(),
              if (isHost && !inGame)
                ElevatedButton.icon(
                  onPressed: () => _startGame(ref),
                  icon: const Icon(Icons.play_arrow, size: 16),
                  label: const Text('START'),
                  style: ElevatedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                    textStyle: const TextStyle(fontSize: 12),
                  ),
                ),
            ],
          ),
        ),

        // Team panels
        Flexible(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(child: _TeamPanel(team: Team.red, players: redPlayers, color: ct.red, me: me)),
                const SizedBox(width: 8),
                Expanded(child: _TeamPanel(team: Team.blue, players: bluePlayers, color: ct.blue, me: me)),
              ],
            ),
          ),
        ),

        // Actions
        Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              OutlinedButton(
                onPressed: () => ref.read(socketServiceProvider).setTeam('none').catchError((_) {}),
                child: const Text('Spectator'),
              ),
              if (isHost) ...[
                const SizedBox(width: 8),
                OutlinedButton(
                  onPressed: () => _pruneDisconnected(ref),
                  child: const Text('Prune Offline'),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }

  Future<void> _startGame(WidgetRef ref) async {
    try {
      await ref.read(socketServiceProvider).startGame();
      ref.read(uiProvider.notifier).closeSheet();
    } catch (e) {
      ref.read(toastProvider.notifier).show(e.toString(), ToastStyle.error);
    }
  }

  Future<void> _pruneDisconnected(WidgetRef ref) async {
    try {
      await ref.read(socketServiceProvider).pruneDisconnected();
    } catch (e) {
      ref.read(toastProvider.notifier).show(e.toString(), ToastStyle.error);
    }
  }
}

class _TeamPanel extends ConsumerWidget {
  final Team team;
  final List<PlayerView> players;
  final Color color;
  final MeView? me;

  const _TeamPanel({
    required this.team,
    required this.players,
    required this.color,
    this.me,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = Theme.of(context).colorScheme;
    final teamName = team == Team.red ? 'RED' : 'BLUE';

    return Container(
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        border: Border.all(color: color.withValues(alpha: 0.2)),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                teamName,
                style: GoogleFonts.playfairDisplaySc(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  color: color,
                  letterSpacing: 1,
                ),
              ),
              const Spacer(),
              // Join team button
              if (me?.team != team)
                GestureDetector(
                  onTap: () => ref.read(socketServiceProvider).setTeam(team.name).catchError((_) {}),
                  child: Text(
                    'JOIN',
                    style: TextStyle(fontSize: 10, color: color, fontWeight: FontWeight.bold),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 6),
          if (players.isEmpty)
            Text(
              'No agents',
              style: TextStyle(fontSize: 11, color: colors.onSurface.withValues(alpha: 0.3)),
            )
          else
            ...players.map((p) => _PlayerRow(player: p, color: color, isMe: p.sessionId == me?.sessionId)),
        ],
      ),
    );
  }
}

class _PlayerRow extends ConsumerWidget {
  final PlayerView player;
  final Color color;
  final bool isMe;

  const _PlayerRow({required this.player, required this.color, required this.isMe});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = Theme.of(context).colorScheme;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          // Connection dot
          Container(
            width: 5,
            height: 5,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: player.connected ? Colors.green : colors.error,
            ),
          ),
          const SizedBox(width: 4),
          // Name
          Expanded(
            child: Text(
              player.name + (isMe ? ' (you)' : ''),
              style: TextStyle(
                fontSize: 12,
                color: colors.onSurface,
                fontWeight: isMe ? FontWeight.bold : FontWeight.normal,
              ),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          // Host badge
          if (player.isHost)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 3, vertical: 1),
              margin: const EdgeInsets.only(left: 2),
              decoration: BoxDecoration(
                color: colors.primary.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(2),
              ),
              child: Text('HOST', style: TextStyle(fontSize: 7, color: colors.primary)),
            ),
          // Role
          GestureDetector(
            onTap: () {
              final nextRole = player.role == PlayerRole.spymaster ? 'operative' : 'spymaster';
              if (player.sessionId == ref.read(meProvider)?.sessionId) {
                ref.read(socketServiceProvider).setRole(nextRole).catchError((_) {});
              }
            },
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 3, vertical: 1),
              margin: const EdgeInsets.only(left: 2),
              decoration: BoxDecoration(
                border: Border.all(color: color.withValues(alpha: 0.3)),
                borderRadius: BorderRadius.circular(2),
              ),
              child: Text(
                player.role == PlayerRole.spymaster ? 'SPY' : 'OPS',
                style: TextStyle(fontSize: 7, color: color),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
