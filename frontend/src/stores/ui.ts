import { defineStore } from 'pinia';

import type { ToastState } from '../types';

let nextConfirmId = 1;

export const useUiStore = defineStore('ui', {
  state: () => ({
    openPanel: null as null | 'teams' | 'feed' | 'settings' | 'debrief',
    selectedGuessIndex: null as number | null,
    toast: {
      message: '',
      type: '',
      visible: false,
    } as ToastState,
    toastTimer: null as number | null,
    confirmMessage: '',
    confirmId: 0,
    confirmResolver: null as null | ((value: boolean) => void),
    unreadChat: 0,
  }),
  actions: {
    showToast(message: string, type: ToastState['type'] = '') {
      this.toast = { message, type, visible: true };
      if (this.toastTimer) window.clearTimeout(this.toastTimer);
      this.toastTimer = window.setTimeout(() => {
        this.toast.visible = false;
        this.toastTimer = null;
      }, 2400);
    },
    async confirm(message: string) {
      this.confirmMessage = message;
      this.confirmId = nextConfirmId++;
      return new Promise<boolean>((resolve) => {
        this.confirmResolver = resolve;
      });
    },
    resolveConfirm(value: boolean) {
      this.confirmResolver?.(value);
      this.confirmResolver = null;
      this.confirmMessage = '';
      this.confirmId = 0;
    },
    togglePanel(panel: 'teams' | 'feed' | 'settings' | 'debrief') {
      this.openPanel = this.openPanel === panel ? null : panel;
      if (this.openPanel === 'feed') this.unreadChat = 0;
    },
    closePanel() {
      this.openPanel = null;
    },
  },
});
