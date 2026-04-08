import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/constants.dart';
import '../../providers/providers.dart';
import '../../providers/ui_provider.dart';

class BottomBar extends ConsumerWidget {
  final void Function(SheetPanel panel) onToggleSheet;

  const BottomBar({super.key, required this.onToggleSheet});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final room = ref.watch(roomProvider);
    final ui = ref.watch(uiProvider);
    final game = ref.watch(gameProvider);
    final connected = ref.watch(connectionProvider);
    final colors = Theme.of(context).colorScheme;
    final tr = ref.watch(trProvider);

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
            // Room code (tap to copy) with ripple
            Material(
              color: Colors.transparent,
              child: InkWell(
                borderRadius: BorderRadius.circular(4),
                onTap: () {
                  final code = room?.code ?? '';
                  if (code.isNotEmpty) {
                    Clipboard.setData(ClipboardData(text: code));
                    ref.read(toastProvider.notifier).show(tr('room_code_copied'), ToastStyle.success);
                  }
                },
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    border: Border.all(color: colors.outline.withValues(alpha: 0.5)),
                    borderRadius: BorderRadius.circular(4),
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
                      const SizedBox(width: 6),
                      Text(
                        room?.code ?? '',
                        style: GoogleFonts.specialElite(
                          fontSize: 12,
                          letterSpacing: 2,
                          color: colors.onSurface,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            const Spacer(),
            _TabButton(
              icon: Icons.groups_outlined,
              isActive: ui.openPanel == SheetPanel.teams,
              onTap: () => onToggleSheet(SheetPanel.teams),
            ),
            _TabButton(
              icon: Icons.chat_outlined,
              isActive: ui.openPanel == SheetPanel.feed,
              onTap: () => onToggleSheet(SheetPanel.feed),
            ),
            _TabButton(
              icon: Icons.mic_outlined,
              isActive: ui.openPanel == SheetPanel.voice,
              onTap: () => onToggleSheet(SheetPanel.voice),
            ),
            _TabButton(
              icon: Icons.settings_outlined,
              isActive: ui.openPanel == SheetPanel.settings,
              onTap: () => onToggleSheet(SheetPanel.settings),
            ),
            if (game?.phase == GamePhase.finished)
              _TabButton(
                icon: Icons.description_outlined,
                isActive: ui.openPanel == SheetPanel.debrief,
                onTap: () => onToggleSheet(SheetPanel.debrief),
              ),
            const Spacer(),
            // Leave with confirmation
            IconButton(
              icon: const Icon(Icons.logout, size: 20),
              onPressed: () async {
                final confirmed = await showDialog<bool>(
                  context: context,
                  builder: (ctx) => AlertDialog(
                    title: Text(tr('leave'), style: GoogleFonts.specialElite(fontSize: 16)),
                    content: Text(tr('leave_confirm'), style: GoogleFonts.specialElite()),
                    actions: [
                      TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(tr('cancel'))),
                      TextButton(onPressed: () => Navigator.pop(ctx, true), child: Text(tr('confirm'))),
                    ],
                  ),
                );
                if (confirmed != true) return;
                try {
                  await ref.read(socketServiceProvider).leaveRoom();
                } catch (_) {}
                ref.read(snapshotProvider.notifier).clear();
                await ref.read(sessionProvider.notifier).clear();
              },
              tooltip: tr('leave'),
              padding: EdgeInsets.zero,
              constraints: const BoxConstraints(minWidth: 40, minHeight: 40),
            ),
          ],
        ),
      ),
    );
  }
}

class _TabButton extends StatelessWidget {
  final IconData icon;
  final bool isActive;
  final VoidCallback onTap;

  const _TabButton({required this.icon, required this.isActive, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(6),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          child: Icon(
            icon,
            size: 22,
            color: isActive ? colors.primary : colors.onSurface.withValues(alpha: 0.5),
          ),
        ),
      ),
    );
  }
}
