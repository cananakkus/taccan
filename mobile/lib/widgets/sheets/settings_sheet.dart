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
    final tr = ref.watch(trProvider);
    final isHost = me?.isHost ?? false;
    final inLobby = game == null;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            tr('settings'),
            style: GoogleFonts.specialElite(
              fontSize: 14,
              letterSpacing: 1,
              color: colors.onSurface,
            ),
          ),
          const SizedBox(height: 16),

          if (isHost && inLobby) ...[
            Text(
              tr('game_mode'),
              style: GoogleFonts.specialElite(fontSize: 12, color: colors.onSurface.withValues(alpha: 0.6)),
            ),
            const SizedBox(height: 6),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _ModeChip(
                  label: tr('casual'),
                  selected: room?.mode == RoomMode.casual,
                  onTap: () => ref.read(socketServiceProvider).setMode('casual').catchError((_) => <String, dynamic>{}),
                ),
                _ModeChip(
                  label: tr('blitz'),
                  selected: room?.mode == RoomMode.blitz,
                  onTap: () => ref.read(socketServiceProvider).setMode('blitz').catchError((_) => <String, dynamic>{}),
                ),
              ],
            ),
            const SizedBox(height: 16),
          ],

          _ToggleRow(
            icon: Theme.of(context).brightness == Brightness.dark
                ? Icons.wb_sunny_outlined
                : Icons.nightlight_outlined,
            label: tr('theme'),
            onTap: () {
              final isDark = Theme.of(context).brightness == Brightness.dark;
              ref.read(preferencesProvider.notifier).setThemeMode(isDark ? ThemeMode.light : ThemeMode.dark);
            },
          ),
          _ToggleRow(
            icon: prefs.soundMuted ? Icons.volume_off : Icons.volume_up,
            label: prefs.soundMuted ? tr('sound_off') : tr('sound_on'),
            onTap: () => ref.read(preferencesProvider.notifier).toggleSound(),
          ),
          _ToggleRow(
            icon: Icons.palette_outlined,
            label: prefs.colorblindMode ? tr('patterns_on') : tr('patterns_off'),
            onTap: () => ref.read(preferencesProvider.notifier).toggleColorblind(),
          ),

          const SizedBox(height: 16),
          Text(
            tr('language'),
            style: GoogleFonts.specialElite(fontSize: 12, color: colors.onSurface.withValues(alpha: 0.6)),
          ),
          const SizedBox(height: 6),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _ModeChip(
                label: tr('english'),
                selected: prefs.language == 'en',
                onTap: () => ref.read(preferencesProvider.notifier).setLanguage('en'),
              ),
              _ModeChip(
                label: tr('turkish'),
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
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
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
          style: GoogleFonts.specialElite(
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
            Text(label, style: GoogleFonts.specialElite(fontSize: 13, color: colors.onSurface)),
          ],
        ),
      ),
    );
  }
}
