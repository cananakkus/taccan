import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../providers/providers.dart';
import '../../providers/ui_provider.dart';

class HintControls extends ConsumerStatefulWidget {
  const HintControls({super.key});

  @override
  ConsumerState<HintControls> createState() => _HintControlsState();
}

class _HintControlsState extends ConsumerState<HintControls> {
  final _wordController = TextEditingController();
  int _count = 1;
  bool _submitting = false;

  @override
  void dispose() {
    _wordController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final word = _wordController.text.trim();
    if (word.isEmpty) return;
    setState(() => _submitting = true);
    try {
      await ref.read(socketServiceProvider).submitHint(word, _count);
      _wordController.clear();
      setState(() => _count = 1);
    } catch (e) {
      ref.read(toastProvider.notifier).show(e.toString(), ToastStyle.error);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final game = ref.watch(gameProvider);
    final colors = Theme.of(context).colorScheme;
    final tr = ref.watch(trProvider);
    final maxCount = game?.maxHintCount ?? 25;

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: colors.surface,
        border: Border(top: BorderSide(color: colors.outline.withValues(alpha: 0.3))),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            tr('spymaster_hint'),
            style: GoogleFonts.playfairDisplaySc(
              fontSize: 11,
              letterSpacing: 1,
              color: colors.onSurface.withValues(alpha: 0.5),
            ),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _wordController,
                  decoration: InputDecoration(
                    hintText: tr('one_word_hint'),
                    hintStyle: GoogleFonts.crimsonPro(),
                    isDense: true,
                    contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                  ),
                  style: GoogleFonts.crimsonPro(fontSize: 16),
                  textCapitalization: TextCapitalization.characters,
                  enabled: !_submitting,
                ),
              ),
              const SizedBox(width: 8),
              Container(
                decoration: BoxDecoration(
                  border: Border.all(color: colors.outline),
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    _StepperBtn(
                      icon: Icons.remove,
                      onTap: !_submitting && _count > 1 ? () => setState(() => _count--) : null,
                    ),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                      child: Text('$_count', style: GoogleFonts.specialElite(fontSize: 16)),
                    ),
                    _StepperBtn(
                      icon: Icons.add,
                      onTap: !_submitting && _count < maxCount ? () => setState(() => _count++) : null,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              ElevatedButton(
                onPressed: _submitting ? null : _submit,
                child: Text(_submitting ? '...' : tr('transmit')),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _StepperBtn extends StatelessWidget {
  final IconData icon;
  final VoidCallback? onTap;

  const _StepperBtn({required this.icon, this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.all(6),
        child: Icon(icon, size: 16, color: onTap != null ? null : Colors.grey),
      ),
    );
  }
}
