import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/constants.dart';
import '../../providers/providers.dart';
import '../../providers/ui_provider.dart';

class BottomBar extends ConsumerWidget {
  const BottomBar({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final room = ref.watch(roomProvider);
    final ui = ref.watch(uiProvider);
    final game = ref.watch(gameProvider);
    final connected = ref.watch(connectionProvider);
    final colors = Theme.of(context).colorScheme;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: colors.surface,
        border: Border(top: BorderSide(color: colors.outline.withValues(alpha: 0.3))),
      ),
      child: SafeArea(
        top: false,
        child: Row(
          children: [
            // Room code
            GestureDetector(
              onTap: () {
                // TODO: copy to clipboard
              },
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  border: Border.all(color: colors.outline.withValues(alpha: 0.5)),
                  borderRadius: BorderRadius.circular(2),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 6,
                      height: 6,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: connected ? Colors.green : colors.error,
                      ),
                    ),
                    const SizedBox(width: 4),
                    Text(
                      room?.code ?? '',
                      style: GoogleFonts.specialElite(
                        fontSize: 11,
                        letterSpacing: 2,
                        color: colors.onSurface,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const Spacer(),

            // Sheet tabs
            _TabButton(
              icon: Icons.groups_outlined,
              label: 'Teams',
              isActive: ui.openPanel == SheetPanel.teams,
              onTap: () => ref.read(uiProvider.notifier).toggleSheet(SheetPanel.teams),
            ),
            _TabButton(
              icon: Icons.chat_outlined,
              label: 'Feed',
              isActive: ui.openPanel == SheetPanel.feed,
              onTap: () => ref.read(uiProvider.notifier).toggleSheet(SheetPanel.feed),
            ),
            _TabButton(
              icon: Icons.settings_outlined,
              label: 'Settings',
              isActive: ui.openPanel == SheetPanel.settings,
              onTap: () => ref.read(uiProvider.notifier).toggleSheet(SheetPanel.settings),
            ),
            _TabButton(
              icon: Icons.mic_outlined,
              label: 'Voice',
              isActive: ui.openPanel == SheetPanel.voice,
              onTap: () => ref.read(uiProvider.notifier).toggleSheet(SheetPanel.voice),
            ),
            if (game?.phase == GamePhase.finished)
              _TabButton(
                icon: Icons.description_outlined,
                label: 'Debrief',
                isActive: ui.openPanel == SheetPanel.debrief,
                onTap: () => ref.read(uiProvider.notifier).toggleSheet(SheetPanel.debrief),
              ),

            const Spacer(),

            // Leave
            IconButton(
              icon: const Icon(Icons.logout, size: 18),
              onPressed: () async {
                try {
                  await ref.read(socketServiceProvider).leaveRoom();
                } catch (_) {}
                ref.read(snapshotProvider.notifier).clear();
                await ref.read(sessionProvider.notifier).clear();
              },
              tooltip: 'Leave',
              iconSize: 18,
              padding: EdgeInsets.zero,
              constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
            ),
          ],
        ),
      ),
    );
  }
}

class _TabButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool isActive;
  final VoidCallback onTap;

  const _TabButton({
    required this.icon,
    required this.label,
    required this.isActive,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(4),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
          child: Icon(
            icon,
            size: 20,
            color: isActive ? colors.primary : colors.onSurface.withValues(alpha: 0.5),
          ),
        ),
      ),
    );
  }
}
