import { defineStore } from 'pinia';

import { clearSession, readSession, writeSession } from '../lib/storage';
import type { SessionRecord, Snapshot } from '../types';

export const useAppStore = defineStore('app', {
  state: () => ({
    snapshot: null as Snapshot | null,
    session: readSession() as SessionRecord | null,
    connected: false,
    connectionLabel: 'Disconnected',
    rejoinAttempted: false,
    wasDisconnected: false,
    previousIsMyTurn: false,
  }),
  actions: {
    setSnapshot(snapshot: Snapshot | null) {
      this.snapshot = snapshot;
      if (snapshot) {
        this.session = {
          code: snapshot.room.code,
          sessionId: snapshot.me.sessionId,
          name: snapshot.me.name,
        };
        writeSession(this.session);
      }
    },
    clearSnapshot() {
      this.snapshot = null;
    },
    clearSession() {
      this.session = null;
      clearSession();
    },
    setConnection(connected: boolean, label: string) {
      this.connected = connected;
      this.connectionLabel = label;
    },
  },
});
