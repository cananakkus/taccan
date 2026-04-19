import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

enum SheetPanel { teams, feed, settings, debrief, voice }

class UiState {
  final SheetPanel? openPanel;
  final int? selectedGuessIndex;
  final List<int> spymasterSelected;

  const UiState({
    this.openPanel,
    this.selectedGuessIndex,
    this.spymasterSelected = const [],
  });

  UiState copyWith({
    SheetPanel? Function()? openPanel,
    int? Function()? selectedGuessIndex,
    List<int>? spymasterSelected,
  }) =>
      UiState(
        openPanel: openPanel != null ? openPanel() : this.openPanel,
        selectedGuessIndex: selectedGuessIndex != null
            ? selectedGuessIndex()
            : this.selectedGuessIndex,
        spymasterSelected: spymasterSelected ?? this.spymasterSelected,
      );
}

final uiProvider = StateNotifierProvider<UiNotifier, UiState>((ref) {
  return UiNotifier();
});

class UiNotifier extends StateNotifier<UiState> {
  UiNotifier() : super(const UiState());

  void openSheet(SheetPanel panel) {
    state = state.copyWith(openPanel: () => panel);
  }

  void closeSheet() {
    state = state.copyWith(openPanel: () => null);
  }

  void toggleSheet(SheetPanel panel) {
    if (state.openPanel == panel) {
      closeSheet();
    } else {
      openSheet(panel);
    }
  }

  void selectGuess(int index) {
    if (state.selectedGuessIndex == index) {
      state = state.copyWith(selectedGuessIndex: () => null);
    } else {
      state = state.copyWith(selectedGuessIndex: () => index);
    }
  }

  void clearGuessSelection() {
    state = state.copyWith(selectedGuessIndex: () => null);
  }

  void toggleSpymasterCard(int index) {
    final list = [...state.spymasterSelected];
    if (list.contains(index)) {
      list.remove(index);
    } else {
      list.add(index);
    }
    state = state.copyWith(spymasterSelected: list);
  }

  void clearSpymasterSelection() {
    state = state.copyWith(spymasterSelected: const []);
  }
}

// Toast system
class ToastMessage {
  final String message;
  final ToastStyle style;
  final DateTime createdAt;

  ToastMessage({
    required this.message,
    this.style = ToastStyle.info,
  }) : createdAt = DateTime.now();
}

enum ToastStyle { info, success, error }

const _toastDisplayDuration = Duration(milliseconds: 2400);
const _toastMaxQueue = 4;

final toastProvider =
    StateNotifierProvider<ToastNotifier, List<ToastMessage>>((ref) {
  return ToastNotifier();
});

class ToastNotifier extends StateNotifier<List<ToastMessage>> {
  Timer? _timer;

  ToastNotifier() : super(const []);

  void show(String message, [ToastStyle style = ToastStyle.info]) {
    final next = [...state, ToastMessage(message: message, style: style)];
    // Drop oldest if the queue grows past the cap (e.g. error flood).
    state = next.length > _toastMaxQueue
        ? next.sublist(next.length - _toastMaxQueue)
        : next;
    _ensureTimer();
  }

  void _ensureTimer() {
    if (_timer != null || state.isEmpty) return;
    _timer = Timer(_toastDisplayDuration, _advance);
  }

  void _advance() {
    _timer = null;
    if (state.isEmpty) return;
    state = state.sublist(1);
    _ensureTimer();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }
}
