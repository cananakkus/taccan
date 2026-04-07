import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../providers/providers.dart';

/// Placeholder game screen — will be built out in Phase 2+
class GameScreen extends ConsumerWidget {
  const GameScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final me = ref.watch(meProvider);
    final room = ref.watch(roomProvider);
    final game = ref.watch(gameProvider);
    final players = ref.watch(playersProvider);
    final theme = Theme.of(context);
    final colors = theme.colorScheme;

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            // Top bar
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              color: colors.surface,
              child: Row(
                children: [
                  // Room code
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(
                      border: Border.all(color: colors.outline),
                    ),
                    child: Text(
                      room?.code ?? '',
                      style: GoogleFonts.specialElite(
                        fontSize: 14,
                        letterSpacing: 3,
                        color: colors.onSurface,
                      ),
                    ),
                  ),
                  const Spacer(),
                  // Player count
                  Text(
                    '${players.where((p) => p.connected).length} online',
                    style: TextStyle(
                      fontSize: 12,
                      color: colors.onSurface.withValues(alpha: 0.6),
                    ),
                  ),
                  const SizedBox(width: 12),
                  // Leave button
                  IconButton(
                    icon: const Icon(Icons.logout, size: 20),
                    onPressed: () async {
                      try {
                        await ref.read(socketServiceProvider).leaveRoom();
                      } catch (_) {}
                      ref.read(snapshotProvider.notifier).clear();
                      await ref.read(sessionProvider.notifier).clear();
                    },
                    tooltip: 'Leave room',
                  ),
                ],
              ),
            ),

            // Main area
            Expanded(
              child: Center(
                child: game == null
                    ? _buildLobby(context, ref, players, me, room)
                    : _buildGamePlaceholder(context, game),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildLobby(
    BuildContext context,
    WidgetRef ref,
    List players,
    me,
    room,
  ) {
    final colors = Theme.of(context).colorScheme;
    final isHost = me?.isHost ?? false;

    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            'LOBBY',
            style: GoogleFonts.playfairDisplaySc(
              fontSize: 24,
              fontWeight: FontWeight.w700,
              color: colors.onSurface,
            ),
          ),
          const SizedBox(height: 16),
          Text(
            '${players.length} agents in room',
            style: TextStyle(color: colors.onSurface.withValues(alpha: 0.7)),
          ),
          const SizedBox(height: 24),
          if (isHost)
            ElevatedButton(
              onPressed: () async {
                try {
                  await ref.read(socketServiceProvider).startGame();
                } catch (e) {
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text(e.toString())),
                    );
                  }
                }
              },
              child: Text(
                'START GAME',
                style: GoogleFonts.playfairDisplaySc(letterSpacing: 1),
              ),
            )
          else
            Text(
              'Waiting for host to start...',
              style: GoogleFonts.specialElite(
                color: colors.onSurface.withValues(alpha: 0.5),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildGamePlaceholder(BuildContext context, game) {
    final colors = Theme.of(context).colorScheme;

    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            'Game in progress',
            style: GoogleFonts.playfairDisplaySc(
              fontSize: 20,
              color: colors.onSurface,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Phase: ${game.phase.name} | Team: ${game.currentTeam.name}',
            style: TextStyle(color: colors.onSurface.withValues(alpha: 0.7)),
          ),
          const SizedBox(height: 8),
          Text(
            'Board: ${game.board.length} cards',
            style: TextStyle(color: colors.onSurface.withValues(alpha: 0.5)),
          ),
          const SizedBox(height: 4),
          Text(
            'Red: ${game.remaining.red} | Blue: ${game.remaining.blue}',
            style: TextStyle(color: colors.onSurface.withValues(alpha: 0.5)),
          ),
        ],
      ),
    );
  }
}
