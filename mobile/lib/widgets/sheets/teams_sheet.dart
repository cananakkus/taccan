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
    final tr = ref.watch(trProvider);
    final isHost = me?.isHost ?? false;
    final inGame = game != null;

    final redPlayers = players.where((p) => p.team == Team.red).toList();
    final bluePlayers = players.where((p) => p.team == Team.blue).toList();
    final myTeam = me?.team ?? Team.none;
    final myRole = me?.role ?? PlayerRole.spectator;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Header
          Text(
            tr('teams'),
            style: GoogleFonts.playfairDisplaySc(
              fontSize: 16, letterSpacing: 1, color: colors.onSurface,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 16),

          // ── Team join buttons ──
          Row(
            children: [
              Expanded(
                child: _TeamJoinButton(
                  label: tr('join_red'),
                  color: ct.red,
                  isActive: myTeam == Team.red,
                  onTap: () => ref.read(socketServiceProvider).setTeam('red').catchError((_) => <String, dynamic>{}),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _TeamJoinButton(
                  label: tr('join_blue'),
                  color: ct.blue,
                  isActive: myTeam == Team.blue,
                  onTap: () => ref.read(socketServiceProvider).setTeam('blue').catchError((_) => <String, dynamic>{}),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),

          // ── Role picker ──
          if (myTeam != Team.none) ...[
            Row(
              children: [
                Expanded(
                  child: _RoleButton(
                    label: tr('spymaster'),
                    icon: Icons.visibility,
                    isActive: myRole == PlayerRole.spymaster,
                    color: myTeam == Team.red ? ct.red : ct.blue,
                    onTap: () => ref.read(socketServiceProvider).setRole('spymaster').catchError((_) {}),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _RoleButton(
                    label: tr('operative'),
                    icon: Icons.person,
                    isActive: myRole == PlayerRole.operative,
                    color: myTeam == Team.red ? ct.red : ct.blue,
                    onTap: () => ref.read(socketServiceProvider).setRole('operative').catchError((_) {}),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
          ],

          // ── Player rosters ──
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: _TeamRoster(
                  label: tr('red'),
                  players: redPlayers,
                  color: ct.red,
                  myId: me?.sessionId,
                  tr: tr,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _TeamRoster(
                  label: tr('blue'),
                  players: bluePlayers,
                  color: ct.blue,
                  myId: me?.sessionId,
                  tr: tr,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),

          // ── Actions ──
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () => ref.read(socketServiceProvider).setTeam('none').catchError((_) => <String, dynamic>{}),
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                  ),
                  child: Text(tr('spectator'), style: GoogleFonts.specialElite()),
                ),
              ),
              if (isHost && !inGame) ...[
                const SizedBox(width: 12),
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: () async {
                      try {
                        await ref.read(socketServiceProvider).startGame();
                      } catch (e) {
                        ref.read(toastProvider.notifier).show(e.toString(), ToastStyle.error);
                      }
                    },
                    icon: const Icon(Icons.play_arrow, size: 18),
                    label: Text(tr('start_game'), style: GoogleFonts.specialElite()),
                    style: ElevatedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 12),
                    ),
                  ),
                ),
              ],
              if (isHost) ...[
                const SizedBox(width: 8),
                IconButton(
                  onPressed: () async {
                    try {
                      await ref.read(socketServiceProvider).pruneDisconnected();
                    } catch (e) {
                      ref.read(toastProvider.notifier).show(e.toString(), ToastStyle.error);
                    }
                  },
                  icon: const Icon(Icons.person_remove, size: 18),
                  tooltip: tr('prune_offline'),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }
}

class _TeamJoinButton extends StatelessWidget {
  final String label;
  final Color color;
  final bool isActive;
  final VoidCallback onTap;

  const _TeamJoinButton({
    required this.label,
    required this.color,
    required this.isActive,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: isActive ? color : Colors.transparent,
      borderRadius: BorderRadius.circular(6),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(6),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: const EdgeInsets.symmetric(vertical: 14),
          decoration: BoxDecoration(
            border: Border.all(color: color, width: isActive ? 2 : 1),
            borderRadius: BorderRadius.circular(6),
          ),
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: GoogleFonts.playfairDisplaySc(
              fontSize: 13,
              fontWeight: FontWeight.w700,
              letterSpacing: 1,
              color: isActive ? Colors.white : color,
            ),
          ),
        ),
      ),
    );
  }
}

class _RoleButton extends StatelessWidget {
  final String label;
  final IconData icon;
  final bool isActive;
  final Color color;
  final VoidCallback onTap;

  const _RoleButton({
    required this.label,
    required this.icon,
    required this.isActive,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Material(
      color: isActive ? color.withValues(alpha: 0.15) : Colors.transparent,
      borderRadius: BorderRadius.circular(6),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(6),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(
            border: Border.all(
              color: isActive ? color : colors.outline.withValues(alpha: 0.3),
            ),
            borderRadius: BorderRadius.circular(6),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 16, color: isActive ? color : colors.onSurface.withValues(alpha: 0.5)),
              const SizedBox(width: 6),
              Text(
                label,
                style: GoogleFonts.specialElite(
                  fontSize: 13,
                  fontWeight: isActive ? FontWeight.bold : FontWeight.normal,
                  color: isActive ? color : colors.onSurface,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _TeamRoster extends StatelessWidget {
  final String label;
  final List<PlayerView> players;
  final Color color;
  final String? myId;
  final String Function(String, {Map<String, String>? vars}) tr;

  const _TeamRoster({
    required this.label,
    required this.players,
    required this.color,
    this.myId,
    required this.tr,
  });

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;

    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.06),
        border: Border.all(color: color.withValues(alpha: 0.15)),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label.toUpperCase(),
            style: GoogleFonts.playfairDisplaySc(
              fontSize: 11, fontWeight: FontWeight.w700, color: color, letterSpacing: 1,
            ),
          ),
          const SizedBox(height: 6),
          if (players.isEmpty)
            Text(
              tr('no_agents'),
              style: GoogleFonts.specialElite(
                fontSize: 12, color: colors.onSurface.withValues(alpha: 0.3),
              ),
            )
          else
            ...players.map((p) => _PlayerRow(player: p, color: color, isMe: p.sessionId == myId)),
        ],
      ),
    );
  }
}

class _PlayerRow extends StatelessWidget {
  final PlayerView player;
  final Color color;
  final bool isMe;

  const _PlayerRow({required this.player, required this.color, required this.isMe});

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          Container(
            width: 6, height: 6,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: player.connected ? Colors.green : colors.error,
            ),
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              player.name + (isMe ? ' (you)' : ''),
              style: GoogleFonts.specialElite(
                fontSize: 13,
                color: colors.onSurface,
                fontWeight: isMe ? FontWeight.bold : FontWeight.normal,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (player.isHost)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
              margin: const EdgeInsets.only(left: 4),
              decoration: BoxDecoration(
                color: colors.primary.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(3),
              ),
              child: Text('HOST', style: GoogleFonts.specialElite(fontSize: 8, color: colors.primary)),
            ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
            margin: const EdgeInsets.only(left: 4),
            decoration: BoxDecoration(
              border: Border.all(color: color.withValues(alpha: 0.25)),
              borderRadius: BorderRadius.circular(3),
            ),
            child: Text(
              player.role == PlayerRole.spymaster ? 'SPY' : 'OPS',
              style: GoogleFonts.specialElite(fontSize: 8, color: color),
            ),
          ),
        ],
      ),
    );
  }
}
