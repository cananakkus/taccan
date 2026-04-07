import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/constants.dart';
import '../../models/chat_message.dart';
import '../../providers/providers.dart';
import '../../providers/ui_provider.dart';
import '../../theme/card_theme.dart';

class FeedSheet extends ConsumerStatefulWidget {
  const FeedSheet({super.key});

  @override
  ConsumerState<FeedSheet> createState() => _FeedSheetState();
}

class _FeedSheetState extends ConsumerState<FeedSheet> {
  final _chatController = TextEditingController();

  @override
  void dispose() {
    _chatController.dispose();
    super.dispose();
  }

  Future<void> _sendChat() async {
    final text = _chatController.text.trim();
    if (text.isEmpty) return;
    try {
      await ref.read(socketServiceProvider).sendChat(text);
      _chatController.clear();
    } catch (e) {
      ref.read(toastProvider.notifier).show(e.toString(), ToastStyle.error);
    }
  }

  @override
  Widget build(BuildContext context) {
    final room = ref.watch(roomProvider);
    final colors = Theme.of(context).colorScheme;
    final ct = Theme.of(context).extension<TaccanCardTheme>()!;
    final messages = room?.chatMessages ?? [];

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          child: Text(
            'FEED',
            style: GoogleFonts.playfairDisplaySc(
              fontSize: 14,
              letterSpacing: 1,
              color: colors.onSurface,
            ),
          ),
        ),
        Flexible(
          child: messages.isEmpty
              ? Center(
                  child: Text(
                    'No activity yet.',
                    style: TextStyle(
                      fontSize: 12,
                      color: colors.onSurface.withValues(alpha: 0.3),
                    ),
                  ),
                )
              : ListView.builder(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  reverse: true,
                  itemCount: messages.length,
                  itemBuilder: (context, index) {
                    final msg = messages[messages.length - 1 - index];
                    return _ChatBubble(message: msg, ct: ct);
                  },
                ),
        ),
        // Chat input
        Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            border: Border(top: BorderSide(color: colors.outline.withValues(alpha: 0.2))),
          ),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _chatController,
                  decoration: const InputDecoration(
                    hintText: 'Type a message...',
                    isDense: true,
                    contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                    border: InputBorder.none,
                  ),
                  style: const TextStyle(fontSize: 13),
                  maxLength: 200,
                  buildCounter: (_, {required currentLength, required isFocused, maxLength}) => null,
                  onSubmitted: (_) => _sendChat(),
                ),
              ),
              IconButton(
                icon: const Icon(Icons.send, size: 18),
                onPressed: _sendChat,
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _ChatBubble extends StatelessWidget {
  final ChatMessage message;
  final TaccanCardTheme ct;

  const _ChatBubble({required this.message, required this.ct});

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final teamColor = message.team == Team.red
        ? ct.red
        : message.team == Team.blue
            ? ct.blue
            : colors.onSurface.withValues(alpha: 0.5);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            message.name,
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.bold,
              color: teamColor,
            ),
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              message.text,
              style: TextStyle(fontSize: 12, color: colors.onSurface),
            ),
          ),
        ],
      ),
    );
  }
}
