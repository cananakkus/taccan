import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/constants.dart';
import '../../providers/providers.dart';
import '../../providers/ui_provider.dart';
import '../../theme/card_theme.dart';
import '../../utils/game_helpers.dart';

class ResultControls extends ConsumerStatefulWidget {
  const ResultControls({super.key});

  @override
  ConsumerState<ResultControls> createState() => _ResultControlsState();
}

class _ResultControlsState extends ConsumerState<ResultControls>
    with SingleTickerProviderStateMixin {
  late final AnimationController _bannerController;
  late final Animation<double> _bannerFade;
  late final Animation<Offset> _bannerSlide;

  @override
  void initState() {
    super.initState();
    _bannerController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 400),
    );
    _bannerFade = CurvedAnimation(parent: _bannerController, curve: Curves.easeOut);
    _bannerSlide = Tween<Offset>(
      begin: const Offset(0, 0.3),
      end: Offset.zero,
    ).animate(CurvedAnimation(parent: _bannerController, curve: Curves.easeOutCubic));
    _bannerController.forward();
  }

  @override
  void dispose() {
    _bannerController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final game = ref.watch(gameProvider);
    final me = ref.watch(meProvider);
    final colors = Theme.of(context).colorScheme;
    final ct = Theme.of(context).extension<TaccanCardTheme>()!;
    final tr = ref.watch(trProvider);
    if (game == null) return const SizedBox.shrink();

    final isHost = me?.isHost ?? false;
    final isAssassin = game.reason == 'assassin';
    final winnerTeam = game.winner;
    final bannerColor = isAssassin
        ? ct.assassin
        : winnerTeam == Team.red
            ? ct.red
            : winnerTeam == Team.blue
                ? ct.blue
                : colors.onSurface;
    final bannerText = isAssassin
        ? tr('banner_assassin')
        : tr('banner_wins', vars: {'winner': formatTeam(winnerTeam).toUpperCase()});
    final reasonText = _buildResultText(game, tr);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: colors.surface,
        border: Border(top: BorderSide(color: colors.outline.withValues(alpha: 0.3))),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          FadeTransition(
            opacity: _bannerFade,
            child: SlideTransition(
              position: _bannerSlide,
              child: Text(
                bannerText,
                style: GoogleFonts.specialElite(
                  fontSize: 22,
                  fontWeight: FontWeight.w900,
                  color: bannerColor,
                  letterSpacing: 2,
                ),
                textAlign: TextAlign.center,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ),
          const SizedBox(height: 4),
          Text(
            reasonText,
            style: GoogleFonts.specialElite(
              fontSize: 13,
              color: colors.onSurface.withValues(alpha: 0.7),
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            alignment: WrapAlignment.center,
            children: [
              if (isHost)
                ElevatedButton(
                  onPressed: () => _rematch(ref, 'same_teams'),
                  child: Text(tr('rematch'), style: GoogleFonts.specialElite()),
                ),
              if (isHost)
                OutlinedButton(
                  onPressed: () => _rematch(ref, 'swap_teams'),
                  child: Text(tr('swap_rematch'), style: GoogleFonts.specialElite()),
                ),
              OutlinedButton(onPressed: () => _sendGG(ref), child: Text(tr('gg'), style: GoogleFonts.specialElite())),
              OutlinedButton(
                onPressed: () => ref.read(uiProvider.notifier).toggleSheet(SheetPanel.debrief),
                child: Text(tr('debrief'), style: GoogleFonts.specialElite()),
              ),
            ],
          ),
        ],
      ),
    );
  }

  String _buildResultText(dynamic game, String Function(String, {Map<String, String>? vars}) tr) {
    final winner = formatTeam(game.winner);
    final loser = formatTeam(game.loser);
    return switch (game.reason) {
      'assassin' => tr('result_assassin', vars: {'loser': loser}),
      'all_agents_revealed' => tr('result_all_agents', vars: {'winner': winner}),
      _ => tr('result_generic', vars: {'winner': winner}),
    };
  }

  Future<void> _rematch(WidgetRef ref, String mode) async {
    try {
      await ref.read(socketServiceProvider).rematch(mode);
    } catch (e) {
      if (!mounted) return;
      ref.read(toastProvider.notifier).show(e.toString(), ToastStyle.error);
    }
  }

  Future<void> _sendGG(WidgetRef ref) async {
    try {
      await ref.read(socketServiceProvider).sendGG();
    } catch (e) {
      if (!mounted) return;
      ref.read(toastProvider.notifier).show(e.toString(), ToastStyle.error);
    }
  }
}
