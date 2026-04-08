import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../core/constants.dart';
import '../models/session_record.dart';
import '../providers/providers.dart';

class JoinScreen extends ConsumerStatefulWidget {
  const JoinScreen({super.key});

  @override
  ConsumerState<JoinScreen> createState() => _JoinScreenState();
}

class _JoinScreenState extends ConsumerState<JoinScreen> {
  final _nameController = TextEditingController();
  final _codeController = TextEditingController();
  bool _loading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final session = ref.read(sessionProvider);
    if (session != null) {
      _nameController.text = session.name;
      _codeController.text = session.code;
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    _codeController.dispose();
    super.dispose();
  }

  Future<void> _createRoom() async {
    final name = _nameController.text.trim();
    final tr = ref.read(trProvider);
    if (name.isEmpty) {
      setState(() => _error = tr('enter_name'));
      return;
    }
    setState(() { _loading = true; _error = null; });
    try {
      final socket = ref.read(socketServiceProvider);
      final response = await socket.createRoom(name);
      final code = response['roomCode'] as String;
      final sessionId = response['sessionId'] as String;
      await ref.read(sessionProvider.notifier).save(
            SessionRecord(code: code, sessionId: sessionId, name: name),
          );
      if (mounted) _codeController.text = code;
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _joinRoom() async {
    final name = _nameController.text.trim();
    final code = _codeController.text.trim().toUpperCase();
    final tr = ref.read(trProvider);
    if (name.isEmpty) {
      setState(() => _error = tr('enter_name'));
      return;
    }
    if (code.isEmpty) {
      setState(() => _error = tr('enter_code'));
      return;
    }
    setState(() { _loading = true; _error = null; });
    try {
      final socket = ref.read(socketServiceProvider);
      final response = await socket.joinRoom(code, name);
      final sessionId = response['sessionId'] as String;
      await ref.read(sessionProvider.notifier).save(
            SessionRecord(code: code, sessionId: sessionId, name: name),
          );
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final prefs = ref.watch(preferencesProvider);
    final connected = ref.watch(connectionProvider);
    final tr = ref.watch(trProvider);

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Container(
              constraints: const BoxConstraints(maxWidth: 400),
              padding: const EdgeInsets.all(32),
              decoration: BoxDecoration(
                color: colors.surface,
                border: Border.all(color: colors.outline),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.15),
                    blurRadius: 16,
                    offset: const Offset(2, 4),
                  ),
                ],
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    'DOC. NO. TC-4782',
                    style: GoogleFonts.specialElite(
                      fontSize: 10,
                      color: colors.onSurface.withValues(alpha: 0.4),
                      letterSpacing: 2,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'TACCAN',
                    style: GoogleFonts.playfairDisplaySc(
                      fontSize: 32,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 4,
                      color: colors.onSurface,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Container(height: 2, width: 60, color: colors.primary),
                  const SizedBox(height: 24),
                  TextField(
                    controller: _nameController,
                    maxLength: playerNameMax,
                    decoration: InputDecoration(
                      labelText: tr('agent_name'),
                      counterText: '',
                    ),
                    style: GoogleFonts.crimsonPro(fontSize: 16),
                    textCapitalization: TextCapitalization.words,
                  ),
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _codeController,
                          maxLength: 8,
                          decoration: InputDecoration(
                            labelText: tr('room_code'),
                            counterText: '',
                          ),
                          style: GoogleFonts.crimsonPro(fontSize: 18, letterSpacing: 2),
                          textCapitalization: TextCapitalization.characters,
                        ),
                      ),
                      const SizedBox(width: 12),
                      ElevatedButton(
                        onPressed: _loading ? null : _joinRoom,
                        child: Text(_loading ? '...' : tr('join')),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      onPressed: _loading ? null : _createRoom,
                      style: ElevatedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 14),
                      ),
                      child: Text(
                        tr('create_room'),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  if (_error != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Text(
                        _error!,
                        style: GoogleFonts.crimsonPro(color: colors.error, fontSize: 13),
                        textAlign: TextAlign.center,
                      ),
                    ),
                  if (!connected)
                    Text(
                      tr('connecting'),
                      style: GoogleFonts.specialElite(
                        fontSize: 11,
                        color: colors.onSurface.withValues(alpha: 0.5),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 8),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              IconButton(
                icon: Icon(
                  theme.brightness == Brightness.dark
                      ? Icons.wb_sunny_outlined
                      : Icons.nightlight_outlined,
                ),
                onPressed: () {
                  // Resolve current effective brightness, then flip
                  final isDark = theme.brightness == Brightness.dark;
                  ref.read(preferencesProvider.notifier).setThemeMode(isDark ? ThemeMode.light : ThemeMode.dark);
                },
                tooltip: tr('theme'),
              ),
              const SizedBox(width: 16),
              TextButton(
                onPressed: () {
                  final next = prefs.language == 'en' ? 'tr' : 'en';
                  ref.read(preferencesProvider.notifier).setLanguage(next);
                },
                child: Text(
                  prefs.language == 'en' ? 'TR' : 'EN',
                  style: GoogleFonts.specialElite(letterSpacing: 2, color: colors.onSurface),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
