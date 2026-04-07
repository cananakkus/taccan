import { onBeforeUnmount, ref, type Ref } from 'vue';

import { fetchTurnCredentials, emitWithAck, socket } from '../lib/socket';
import { getAssetPath } from '../lib/runtime';
import { usePreferencesStore } from '../stores/preferences';
import { useUiStore } from '../stores/ui';
import { useVoiceStore } from '../stores/voice';
import type { PlayerView } from '../types';

interface PeerEntry {
  pc: RTCPeerConnection;
  stream: MediaStream | null;
  analyser: AnalyserNode | null;
}

interface NoiseNodes {
  source: MediaStreamAudioSourceNode;
  worklet: AudioWorkletNode | null;
  dest: MediaStreamAudioDestinationNode;
}

const STUN_ONLY_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

const SPEAKING_THRESHOLD = 15;
const SPEAKING_POLL_MS = 100;
const RNNOISE_WORKLET_ID = '@sapphi-red/web-noise-suppressor/rnnoise';

export function useVoice(
  players: Ref<PlayerView[]>,
  meSessionId: Ref<string | null>,
  audioContainer: Ref<HTMLElement | null>,
  t: (key: string, vars?: Record<string, string | number>) => string
) {
  const preferences = usePreferencesStore();
  const ui = useUiStore();
  const voice = useVoiceStore();

  const peers = new Map<string, PeerEntry>();
  const audioElements = new Map<string, HTMLAudioElement>();
  let localStream: MediaStream | null = null;
  let processedStream: MediaStream | null = null;
  let noiseNodes: NoiseNodes | null = null;
  let rnnoiseWasmBinary: ArrayBuffer | null = null;
  let rnnoiseWorkletReady = false;
  let rtcConfig: RTCConfiguration | null = null;
  let speakingInterval: number | null = null;
  let audioCtx: AudioContext | null = null;
  let initialized = false;
  const joining = ref(false);

  function ensureAudioContext(): AudioContext {
    if (!audioCtx) {
      audioCtx = new AudioContext();
    }
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume();
    }
    return audioCtx;
  }

  async function getRtcConfig(): Promise<RTCConfiguration> {
    if (rtcConfig) return rtcConfig;
    try {
      rtcConfig = await fetchTurnCredentials();
      return rtcConfig;
    } catch (_error) {
      rtcConfig = STUN_ONLY_CONFIG;
      return rtcConfig;
    }
  }

  // ── RNNoise noise suppression pipeline ──

  async function createRnnoiseNode(): Promise<AudioWorkletNode> {
    const ctx = ensureAudioContext();

    if (!rnnoiseWorkletReady) {
      await ctx.audioWorklet.addModule(getAssetPath('rnnoise-worklet.js'));
      rnnoiseWorkletReady = true;
    }
    if (!rnnoiseWasmBinary) {
      const resp = await fetch(getAssetPath('rnnoise.wasm'));
      rnnoiseWasmBinary = await resp.arrayBuffer();
    }

    return new AudioWorkletNode(ctx, RNNOISE_WORKLET_ID, {
      processorOptions: { wasmBinary: rnnoiseWasmBinary, maxChannels: 1 },
    });
  }

  async function setupNoisePipeline(): Promise<void> {
    if (!localStream) return;
    const ctx = ensureAudioContext();

    const source = ctx.createMediaStreamSource(localStream);
    const dest = ctx.createMediaStreamDestination();
    let worklet: AudioWorkletNode | null = null;

    if (preferences.noiseSuppression) {
      try {
        worklet = await createRnnoiseNode();
        source.connect(worklet).connect(dest);
      } catch (_error) {
        source.connect(dest);
      }
    } else {
      source.connect(dest);
    }

    noiseNodes = { source, worklet, dest };
    processedStream = dest.stream;
  }

  function cleanupNoisePipeline(): void {
    if (noiseNodes) {
      noiseNodes.source.disconnect();
      if (noiseNodes.worklet) {
        noiseNodes.worklet.disconnect();
        noiseNodes.worklet.port.postMessage('destroy');
      }
    }
    noiseNodes = null;
    processedStream = null;
  }

  function getOutboundStream(): MediaStream | null {
    return processedStream || localStream;
  }

  // ── Socket event handlers ──

  function initialize() {
    if (initialized) return;
    initialized = true;

    socket.on('voice:peer_joined', ({ sessionId }: { sessionId: string }) => {
      if (!voice.active) return;
      createPeerConnection(sessionId, true);
    });

    socket.on('voice:peer_left', ({ sessionId }: { sessionId: string }) => {
      closePeer(sessionId);
      voice.removePeer(sessionId);
    });

    socket.on(
      'voice:signal',
      async ({
        fromSessionId,
        type,
        sdp,
        candidate,
      }: {
        fromSessionId: string;
        type: 'offer' | 'answer' | 'candidate';
        sdp?: string;
        candidate?: string;
      }) => {
        if (!voice.active) return;

        let entry = peers.get(fromSessionId);
        if (type === 'offer') {
          if (!entry) {
            createPeerConnection(fromSessionId, false);
            entry = peers.get(fromSessionId);
          }
          if (!entry || !sdp) return;
          await entry.pc.setRemoteDescription({ type: 'offer', sdp });
          const answer = await entry.pc.createAnswer();
          await entry.pc.setLocalDescription(answer);
          await emitWithAck('voice:signal', {
            targetSessionId: fromSessionId,
            type: 'answer',
            sdp: entry.pc.localDescription?.sdp || '',
          }).catch(() => {});
          return;
        }

        if (!entry) return;

        if (type === 'answer' && sdp) {
          await entry.pc.setRemoteDescription({ type: 'answer', sdp });
        }

        if (type === 'candidate' && candidate) {
          try {
            await entry.pc.addIceCandidate(JSON.parse(candidate));
          } catch (_error) {}
        }
      }
    );

    socket.on('voice:mute_changed', ({ sessionId, muted }: { sessionId: string; muted: boolean }) => {
      voice.setPeerMuted(sessionId, muted);
    });

    socket.on('disconnect', () => {
      destroyAllPeers();
    });
  }

  // ── Join / Leave / Mute ──

  async function joinVoice() {
    initialize();
    if (voice.active) {
      leaveVoice();
      return;
    }
    if (joining.value) return;
    joining.value = true;

    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          noiseSuppression: true,
          echoCancellation: true,
          autoGainControl: true,
        },
        video: false,
      });
    } catch (error) {
      joining.value = false;
      ui.showToast(t('voice_mic_error', { error: error instanceof Error ? error.name : 'UnknownError' }), 'error');
      return;
    }

    await Promise.all([setupNoisePipeline(), getRtcConfig()]);

    voice.setActive(true);
    voice.setMuted(false);
    startSpeakingDetection();

    try {
      const response = await emitWithAck<{ peers?: string[] }>('voice:join', {});
      for (const peerId of response.peers || []) {
        voice.setPeer(peerId);
        createPeerConnection(peerId, true);
      }
    } catch (error) {
      leaveVoice(false);
      ui.showToast(error instanceof Error ? error.message : t('voice_join_failed'), 'error');
    } finally {
      joining.value = false;
    }
  }

  function leaveVoice(notify = true) {
    stopSpeakingDetection();
    destroyAllPeers();
    cleanupNoisePipeline();
    stopLocalStream();
    voice.reset();
    if (notify) {
      void emitWithAck('voice:leave', {}).catch(() => {});
    }
  }

  function toggleMute() {
    if (!voice.active || !localStream) return;
    const nextValue = !voice.muted;
    voice.setMuted(nextValue);
    for (const track of localStream.getAudioTracks()) {
      track.enabled = !nextValue;
    }
    void emitWithAck('voice:mute', { muted: nextValue }).catch(() => {});
  }

  async function toggleNoiseSuppression() {
    const nextValue = !preferences.noiseSuppression;
    preferences.setNoiseSuppression(nextValue);

    if (!voice.active || !localStream || !noiseNodes) return;

    // Rewire the pipeline live without rejoining
    noiseNodes.source.disconnect();
    if (noiseNodes.worklet) {
      noiseNodes.worklet.disconnect();
      noiseNodes.worklet.port.postMessage('destroy');
      noiseNodes.worklet = null;
    }

    if (nextValue) {
      try {
        const worklet = await createRnnoiseNode();
        noiseNodes.source.connect(worklet).connect(noiseNodes.dest);
        noiseNodes.worklet = worklet;
      } catch (_error) {
        noiseNodes.source.connect(noiseNodes.dest);
      }
    } else {
      noiseNodes.source.connect(noiseNodes.dest);
    }
  }

  // ── Peer connections ──

  function createPeerConnection(sessionId: string, isInitiator: boolean) {
    if (peers.has(sessionId)) return;

    const pc = new RTCPeerConnection(rtcConfig || STUN_ONLY_CONFIG);
    const entry: PeerEntry = { pc, stream: null, analyser: null };
    peers.set(sessionId, entry);
    voice.setPeer(sessionId, voice.peers.find((peer) => peer.sessionId === sessionId)?.volume || 100);

    const outbound = getOutboundStream();
    if (outbound) {
      for (const track of outbound.getTracks()) {
        pc.addTrack(track, outbound);
      }
    }

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      void emitWithAck('voice:signal', {
        targetSessionId: sessionId,
        type: 'candidate',
        candidate: JSON.stringify(event.candidate),
      }).catch(() => {});
    };

    pc.ontrack = (event) => {
      const remoteStream = event.streams[0] || new MediaStream([event.track]);
      entry.stream = remoteStream;
      const audio = audioElements.get(sessionId) || document.createElement('audio');
      audio.autoplay = true;
      audio.srcObject = remoteStream;
      audio.volume = (voice.peers.find((peer) => peer.sessionId === sessionId)?.volume || 100) / 100;
      if (!audioElements.has(sessionId)) {
        audioElements.set(sessionId, audio);
        audioContainer.value?.appendChild(audio);
      }
      void audio.play().catch(() => {});
      setupAnalyser(sessionId, remoteStream, entry);
    };

    if (isInitiator) {
      void pc
        .createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() =>
          emitWithAck('voice:signal', {
            targetSessionId: sessionId,
            type: 'offer',
            sdp: pc.localDescription?.sdp || '',
          })
        )
        .catch(() => closePeer(sessionId));
    }
  }

  function setupAnalyser(sessionId: string, stream: MediaStream, entry: PeerEntry) {
    try {
      const context = ensureAudioContext();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      entry.analyser = analyser;
      voice.setSpeaking(sessionId, false);
    } catch (_error) {}
  }

  function closePeer(sessionId: string) {
    const entry = peers.get(sessionId);
    if (entry) {
      entry.pc.close();
      peers.delete(sessionId);
    }
    const audio = audioElements.get(sessionId);
    if (audio) {
      audio.srcObject = null;
      audio.remove();
      audioElements.delete(sessionId);
    }
  }

  function destroyAllPeers() {
    for (const sessionId of [...peers.keys()]) {
      closePeer(sessionId);
    }
  }

  function stopLocalStream() {
    if (!localStream) return;
    for (const track of localStream.getTracks()) {
      track.stop();
    }
    localStream = null;
  }

  // ── Speaking detection ──

  function startSpeakingDetection() {
    if (speakingInterval) return;
    let localAnalyser: AnalyserNode | null = null;

    if (localStream) {
      try {
        const context = ensureAudioContext();
        const source = context.createMediaStreamSource(localStream);
        localAnalyser = context.createAnalyser();
        localAnalyser.fftSize = 256;
        source.connect(localAnalyser);
      } catch (_error) {}
    }

    speakingInterval = window.setInterval(() => {
      const myId = meSessionId.value;
      if (myId && localAnalyser) {
        voice.setSpeaking(myId, isSpeaking(localAnalyser));
      }
      for (const [sessionId, entry] of peers) {
        if (!entry.analyser) continue;
        voice.setSpeaking(sessionId, isSpeaking(entry.analyser));
      }
    }, SPEAKING_POLL_MS);
  }

  function stopSpeakingDetection() {
    if (!speakingInterval) return;
    window.clearInterval(speakingInterval);
    speakingInterval = null;
  }

  function isSpeaking(analyser: AnalyserNode): boolean {
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i += 1) {
      sum += data[i];
    }
    return sum / data.length > SPEAKING_THRESHOLD;
  }

  function setPeerVolume(sessionId: string, volume: number) {
    voice.setPeerVolume(sessionId, volume);
    const audio = audioElements.get(sessionId);
    if (audio) {
      audio.volume = volume / 100;
    }
  }

  onBeforeUnmount(() => {
    leaveVoice(false);
  });

  return {
    joining,
    joinVoice,
    leaveVoice,
    toggleMute,
    toggleNoiseSuppression,
    setPeerVolume,
  };
}
