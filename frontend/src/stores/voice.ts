import { defineStore } from 'pinia';

import type { VoicePeerEntry } from '../types';

export const useVoiceStore = defineStore('voice', {
  state: () => ({
    active: false,
    muted: false,
    peers: [] as VoicePeerEntry[],
    speakingIds: [] as string[],
    mutedPeerIds: [] as string[],
  }),
  getters: {
    peerIds(state): string[] {
      return state.peers.map((peer) => peer.sessionId);
    },
  },
  actions: {
    reset() {
      this.active = false;
      this.muted = false;
      this.peers = [];
      this.speakingIds = [];
      this.mutedPeerIds = [];
    },
    setActive(value: boolean) {
      this.active = value;
    },
    setMuted(value: boolean) {
      this.muted = value;
    },
    setPeer(sessionId: string, volume = 100) {
      const existing = this.peers.find((peer) => peer.sessionId === sessionId);
      if (existing) {
        existing.volume = volume;
        return;
      }
      this.peers.push({ sessionId, volume });
    },
    setPeerVolume(sessionId: string, volume: number) {
      const peer = this.peers.find((entry) => entry.sessionId === sessionId);
      if (peer) peer.volume = volume;
    },
    removePeer(sessionId: string) {
      this.peers = this.peers.filter((peer) => peer.sessionId !== sessionId);
      this.speakingIds = this.speakingIds.filter((id) => id !== sessionId);
      this.mutedPeerIds = this.mutedPeerIds.filter((id) => id !== sessionId);
    },
    setSpeaking(sessionId: string, speaking: boolean) {
      if (speaking) {
        if (!this.speakingIds.includes(sessionId)) {
          this.speakingIds.push(sessionId);
        }
        return;
      }
      this.speakingIds = this.speakingIds.filter((id) => id !== sessionId);
    },
    setPeerMuted(sessionId: string, muted: boolean) {
      if (muted) {
        if (!this.mutedPeerIds.includes(sessionId)) {
          this.mutedPeerIds.push(sessionId);
        }
        return;
      }
      this.mutedPeerIds = this.mutedPeerIds.filter((id) => id !== sessionId);
    },
  },
});
