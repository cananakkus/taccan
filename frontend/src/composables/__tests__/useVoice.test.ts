import { defineComponent, ref } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useVoice } from '../useVoice';
import { useVoiceStore } from '../../stores/voice';
import { usePreferencesStore } from '../../stores/preferences';

const signaling = vi.hoisted(() => ({
  handlers: new Map<string, Function>(),
  emit: vi.fn(async (..._args: any[]) => ({ peers: [] })),
}));
vi.mock('../../lib/socket', () => ({
  socket: {
    connected: true,
    on: (event: string, handler: Function) => signaling.handlers.set(event, handler),
    off: (event: string) => signaling.handlers.delete(event),
  },
  emitWithAck: (...args: any[]) => signaling.emit(...args),
  fetchTurnCredentials: async () => ({ iceServers: [] }),
}));

let pcs: any[];
let tracks: any[];
let media: ReturnType<typeof vi.fn>;
let wrapper: ReturnType<typeof mount>;
let api: ReturnType<typeof useVoice>;
function stream() {
  const track = { enabled: true, stop: vi.fn() };
  tracks.push(track);
  return { getTracks: () => [track], getAudioTracks: () => [track] };
}

beforeEach(() => {
  setActivePinia(createPinia());
  usePreferencesStore().noiseSuppression = false;
  pcs = [];
  tracks = [];
  signaling.handlers.clear();
  signaling.emit.mockClear();
  media = vi.fn(async () => stream());
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: media } });
  vi.stubGlobal('AudioContext', class {
    state = 'running';
    createMediaStreamSource() { return { connect: vi.fn(), disconnect: vi.fn() }; }
    createMediaStreamDestination() { return { stream: stream() }; }
    createAnalyser() { return { fftSize: 256 }; }
    close = vi.fn();
  });
  vi.stubGlobal('RTCPeerConnection', class {
    remoteDescription: unknown = null;
    localDescription: unknown = null;
    added: unknown[] = [];
    addTrack = vi.fn();
    close = vi.fn();
    createOffer = vi.fn(async () => ({ type: 'offer', sdp: 'offer' }));
    createAnswer = vi.fn(async () => ({ type: 'answer', sdp: 'answer' }));
    async setLocalDescription(value: unknown) { this.localDescription = value; }
    async setRemoteDescription(value: unknown) { this.remoteDescription = value; }
    async addIceCandidate(value: unknown) {
      if (!this.remoteDescription) throw new Error('No remote description');
      this.added.push(value);
    }
    constructor() { pcs.push(this); }
  });
  wrapper = mount(defineComponent({
    setup() {
      api = useVoice(ref([]), ref('me'), ref(null), key => key);
      return () => null;
    },
  }));
});
afterEach(() => {
  wrapper.unmount();
  vi.unstubAllGlobals();
});

describe('voice lifecycle and signaling', () => {
  it('answers newcomers without creating a competing offer and buffers early ICE', async () => {
    await api.joinVoice();
    signaling.handlers.get('voice:peer_joined')!({ sessionId: 'peer' });
    expect(pcs[0].createOffer).not.toHaveBeenCalled();
    await signaling.handlers.get('voice:signal')!({ fromSessionId: 'peer', type: 'candidate', candidate: '{"candidate":"early"}' });
    expect(pcs[0].added).toEqual([]);
    await signaling.handlers.get('voice:signal')!({ fromSessionId: 'peer', type: 'offer', sdp: 'offer' });
    expect(pcs[0].added).toEqual([{ candidate: 'early' }]);
    expect(pcs[0].createAnswer).toHaveBeenCalledOnce();
  });

  it('keeps ICE received even before peer notification', async () => {
    await api.joinVoice();
    await signaling.handlers.get('voice:signal')!({ fromSessionId: 'peer', type: 'candidate', candidate: '{"candidate":"first"}' });
    await signaling.handlers.get('voice:signal')!({ fromSessionId: 'peer', type: 'offer', sdp: 'offer' });
    expect(pcs).toHaveLength(1);
    expect(pcs[0].added).toHaveLength(1);
  });

  it('releases the microphone and resets voice on disconnect', async () => {
    await api.joinVoice();
    signaling.handlers.get('disconnect')!();
    expect(useVoiceStore().active).toBe(false);
    expect(tracks.every(track => track.stop.mock.calls.length > 0)).toBe(true);
  });

  it('cancels a pending microphone request when leaving', async () => {
    let resolveMedia!: (value: any) => void;
    media.mockImplementation(() => new Promise(resolve => { resolveMedia = resolve; }));
    const pending = api.joinVoice();
    api.leaveVoice(false);
    resolveMedia(stream());
    await pending;
    expect(tracks[0].stop).toHaveBeenCalledOnce();
    expect(useVoiceStore().active).toBe(false);
    expect(signaling.emit).not.toHaveBeenCalled();
  });

  it('cleans up if audio setup fails after microphone permission', async () => {
    vi.stubGlobal('AudioContext', class {
      state = 'running';
      createMediaStreamSource() { throw new Error('audio unavailable'); }
      close = vi.fn();
    });
    await api.joinVoice();
    await flushPromises();
    expect(api.joining.value).toBe(false);
    expect(useVoiceStore().active).toBe(false);
    expect(tracks[0].stop).toHaveBeenCalledOnce();
  });
});
