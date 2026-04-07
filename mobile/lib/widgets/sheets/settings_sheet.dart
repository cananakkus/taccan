import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/constants.dart';
import '../../providers/providers.dart';

class SettingsSheet extends ConsumerWidget {
  const SettingsSheet({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final prefs = ref.watch(preferencesProvider);
    final me = ref.watch(meProvider);
    final room = ref.watch(roomProvider);
    final game = ref.watch(gameProvider);
    final colors = Theme.of(context).colorScheme;
    final isHost = me?.isHost ?? false;
    final inLobby = game == null;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'SETTINGS',
            style: GoogleFonts.playfairDisplaySc(
              fontSize: 14,
              letterSpacing: 1,
              color: colors.onSurface,
            ),
          ),
          const SizedBox(height: 16),

          // Mode selection (host only, lobby only)
          if (isHost && inLobby) ...[
            Text(
              'Game Mode',
              style: TextStyle(fontSize: 12, color: colors.onSurface.withValues(alpha: 0.6)),
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                _ModeChip(
                  label: 'Casual',
                  selected: room?.mode == RoomMode.casual,
                  onTap: () => ref.read(socketServiceProvider).setMode('casual').catchError((_) {}),
                ),
                const SizedBox(width: 8),
                _ModeChip(
                  label: 'Blitz',
                  selected: room?.mode == RoomMode.blitz,
                  onTap: () => ref.read(socketServiceProvider).setMode('blitz').catchError((_) {}),
                ),
              ],
            ),
            const SizedBox(height: 16),
          ],

          // Toggle row
          _ToggleRow(
            icon: Theme.of(context).brightness == Brightness.dark
                ? Icons.wb_sunny_outlined
                : Icons.nightlight_outlined,
            label: 'Theme',
            onTap: () => ref.read(preferencesProvider.notifier).toggleTheme(Theme.of(context).brightness),
          ),
          _ToggleRow(
            icon: prefs.soundMuted ? Icons.volume_off : Icons.volume_up,
            label: prefs.soundMuted ? 'Sound Off' : 'Sound On',
            onTap: () => ref.read(preferencesProvider.notifier).toggleSound(),
          ),
          _ToggleRow(
            icon: Icons.palette_outlined,
            label: prefs.colorblindMode ? 'Patterns On' : 'Patterns Off',
            onTap: () => ref.read(preferencesProvider.notifier).toggleColorblind(),
          ),

          const SizedBox(height: 16),

          // Language
          Text(
            'Language',
            style: TextStyle(fontSize: 12, color: colors.onSurface.withValues(alpha: 0.6)),
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              _ModeChip(
                label: 'English',
                selected: prefs.language == 'en',
                onTap: () => ref.read(preferencesProvider.notifier).setLanguage('en'),
              ),
              const SizedBox(width: 8),
              _ModeChip(
                label: 'Turkce',
                selected: prefs.language == 'tr',
                onTap: () => ref.read(preferencesProvider.notifier).setLanguage('tr'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ModeChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _ModeChip({required this.label, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: selected ? colors.primary.withValues(alpha: 0.15) : Colors.transparent,
          border: Border.all(
            color: selected ? colors.primary : colors.outline.withValues(alpha: 0.3),
          ),
          borderRadius: BorderRadius.circular(4),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 12,
            color: selected ? colors.primary : colors.onSurface,
            fontWeight: selected ? FontWeight.bold : FontWeight.normal,
          ),
        ),
      ),
    );
  }
}

class _ToggleRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  const _ToggleRow({required this.icon, required this.label, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Row(
          children: [
            Icon(icon, size: 18, color: colors.onSurface.withValues(alpha: 0.6)),
            const SizedBox(width: 10),
            Text(label, style: TextStyle(fontSize: 13, color: colors.onSurface)),
          ],
        ),
      ),
    );
  }
}
