import { onBeforeUnmount, ref, watch, type Ref } from 'vue';

import { fetchTurnCredentials, emitWithAck, socket } from '../lib/socket';
import { getAssetPath } from '../lib/runtime';
import { createVoiceCredentialRenewal } from '../lib/voice-credentials';
import { usePreferencesStore } from '../stores/preferences';
import { useUiStore } from '../stores/ui';
import { useVoiceStore } from '../stores/voice';
import type { TurnCredentialsResponse } from '../types';

interface VoiceParticipant { sessionId: string; name: string }

interface PeerEntry {
  pc: RTCPeerConnection;
  isInitiator: boolean;
  stream: MediaStream | null;
  analyser: AnalyserNode | null;
  source: MediaStreamAudioSourceNode | null;
  pendingCandidates: RTCIceCandidateInit[];
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
  players: Ref<VoiceParticipant[]>,
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
  let rnnoiseWorkletContext: AudioContext | null = null;
  let rtcConfig: RTCConfiguration | null = null;
  let speakingInterval: number | null = null;
  let lastReportedSpeaking = false;
  let lastSpeechAt = 0;
  let audioCtx: AudioContext | null = null;
  let initialized = false;
  const joining = ref(false);
  let joinGeneration = 0;
  let suppressionGeneration = 0;
  let localAnalyserSource: MediaStreamAudioSourceNode | null = null;
  const subscriptions: Array<[string, (...args: any[]) => void]> = [];

  function listen(event: string, handler: (...args: any[]) => void) {
    socket.on(event, handler);
    subscriptions.push([event, handler]);
  }

  function ensureAudioContext(): AudioContext {
    if (!audioCtx) {
      audioCtx = new AudioContext({ sampleRate: 48000 });
    }
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume();
    }
    return audioCtx;
  }

  function applyCredentials(config: TurnCredentialsResponse, renewing = false) {
    rtcConfig = { iceServers: config.iceServers };
    for (const entry of peers.values()) {
      entry.pc.setConfiguration(rtcConfig);
      // One offerer per pair avoids simultaneous ICE-restart offers. Both
      // participants install new credentials before their old lease expires.
      if (renewing && entry.isInitiator) entry.pc.restartIce();
    }
  }

  const credentials = createVoiceCredentialRenewal(fetchTurnCredentials, applyCredentials, error => {
    leaveVoice();
    ui.showToast(error.message, 'error');
  });

  // ── RNNoise noise suppression pipeline ──

  async function createRnnoiseNode(): Promise<AudioWorkletNode> {
    const ctx = ensureAudioContext();

    if (rnnoiseWorkletContext !== ctx) {
      await ctx.audioWorklet.addModule(getAssetPath('rnnoise-worklet.js'));
      rnnoiseWorkletContext = ctx;
    }
    if (!rnnoiseWasmBinary) {
      const resp = await fetch(getAssetPath('rnnoise.wasm'));
      if (!resp.ok) throw new Error('Noise suppression could not be loaded.');
      rnnoiseWasmBinary = await resp.arrayBuffer();
    }

    return new AudioWorkletNode(ctx, RNNOISE_WORKLET_ID, {
      channelCount: 1,
      channelCountMode: 'explicit',
      outputChannelCount: [1],
      processorOptions: { wasmBinary: rnnoiseWasmBinary, maxChannels: 1 },
    });
  }

  async function setupNoisePipeline(): Promise<void> {
    if (!localStream) return;
    const ctx = ensureAudioContext();

    const stream = localStream;
    const source = ctx.createMediaStreamSource(stream);
    const dest = ctx.createMediaStreamDestination();
    // RNNoise processes one channel; a mono track keeps voices centred for listeners.
    dest.channelCount = 1;
    dest.channelCountMode = 'explicit';
    let worklet: AudioWorkletNode | null = null;

    if (preferences.noiseSuppression) {
      try {
        worklet = await createRnnoiseNode();
        if (preferences.noiseSuppression) source.connect(worklet).connect(dest);
        else {
          worklet.disconnect();
          worklet.port.postMessage('destroy');
          worklet = null;
          source.connect(dest);
        }
      } catch (_error) {
        source.connect(dest);
      }
    } else {
      source.connect(dest);
    }

    if (localStream !== stream) {
      source.disconnect();
      worklet?.disconnect();
      worklet?.port.postMessage('destroy');
      dest.stream.getTracks().forEach((track) => track.stop());
      return;
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
    processedStream?.getTracks().forEach((track) => track.stop());
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

    listen('voice:peer_joined', ({ sessionId }: { sessionId: string }) => {
      if (!voice.active) return;
      createPeerConnection(sessionId, false);
    });

    listen('voice:peer_left', ({ sessionId }: { sessionId: string }) => {
      closePeer(sessionId);
      voice.removePeer(sessionId);
    });

    listen(
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

        try {
          let entry = peers.get(fromSessionId);
          // ICE can arrive before the offer or while setRemoteDescription awaits.
          if (!entry && (type === 'candidate' || type === 'offer')) {
            createPeerConnection(fromSessionId, false);
            entry = peers.get(fromSessionId);
          }
          if (type === 'offer') {
            if (!entry) {
              createPeerConnection(fromSessionId, false);
              entry = peers.get(fromSessionId);
            }
            if (!entry || !sdp) return;
            await entry.pc.setRemoteDescription({ type: 'offer', sdp });
            await flushCandidates(entry);
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
            await flushCandidates(entry);
          }

          if (type === 'candidate' && candidate) {
            try {
              const ice = JSON.parse(candidate) as RTCIceCandidateInit;
              if (entry.pc.remoteDescription) await entry.pc.addIceCandidate(ice);
              else entry.pendingCandidates.push(ice);
            } catch (_error) {}
          }
        } catch (_error) {
          closePeer(fromSessionId);
          ui.showToast(t('voice_join_failed'), 'error');
        }
      }
    );

    listen('voice:mute_changed', ({ sessionId, muted }: { sessionId: string; muted: boolean }) => {
      voice.setPeerMuted(sessionId, muted);
    });

    listen('disconnect', () => {
      leaveVoice(false);
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

    const generation = ++joinGeneration;
    try {
      // Resume during the button gesture, before permission/network awaits.
      ensureAudioContext();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { noiseSuppression: true, echoCancellation: true, autoGainControl: true },
        video: false,
      });
      if (generation !== joinGeneration) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      localStream = stream;
      await setupNoisePipeline();
      if (generation !== joinGeneration) return;
      voice.setActive(true);
      voice.setMuted(false);
      const response = await emitWithAck<TurnCredentialsResponse & { peers?: string[] } & Record<string, unknown>>('voice:join', {});
      if (generation !== joinGeneration) return;
      credentials.start(response);
      startSpeakingDetection();
      for (const peerId of response.peers || []) {
        createPeerConnection(peerId, true);
      }
    } catch (error) {
      if (generation !== joinGeneration) return;
      leaveVoice(socket.connected);
      ui.showToast(error instanceof Error ? error.message : t('voice_join_failed'), 'error');
    } finally {
      if (generation === joinGeneration) joining.value = false;
    }
  }

  function leaveVoice(notify = true) {
    joinGeneration++;
    suppressionGeneration++;
    joining.value = false;
    credentials.stop();
    stopSpeakingDetection();
    destroyAllPeers();
    cleanupNoisePipeline();
    stopLocalStream();
    void audioCtx?.close();
    audioCtx = null;
    rnnoiseWorkletContext = null;
    rtcConfig = null;
    voice.reset();
    if (notify) {
      void emitWithAck('voice:leave', {}).catch(() => {});
    }
  }

  function toggleMute() {
    if (!voice.active || !localStream) return;
    const nextValue = !voice.muted;
    voice.setMuted(nextValue);
    for (const track of [...localStream.getAudioTracks(), ...(processedStream?.getAudioTracks() || [])]) {
      track.enabled = !nextValue;
    }
    void emitWithAck('voice:mute', { muted: nextValue }).catch(() => {});
  }

  async function toggleNoiseSuppression() {
    const generation = ++suppressionGeneration;
    const nextValue = !preferences.noiseSuppression;
    preferences.setNoiseSuppression(nextValue);

    if (!voice.active || !localStream || !noiseNodes) return;

    // Rewire the pipeline live without rejoining
    const pipeline = noiseNodes;
    noiseNodes.source.disconnect();
    if (noiseNodes.worklet) {
      noiseNodes.worklet.disconnect();
      noiseNodes.worklet.port.postMessage('destroy');
      noiseNodes.worklet = null;
    }

    if (nextValue) {
      try {
        const worklet = await createRnnoiseNode();
        if (noiseNodes !== pipeline || generation !== suppressionGeneration) {
          worklet.disconnect();
          worklet.port.postMessage('destroy');
          return;
        }
        noiseNodes.source.connect(worklet).connect(noiseNodes.dest);
        noiseNodes.worklet = worklet;
      } catch (_error) {
        if (noiseNodes === pipeline && generation === suppressionGeneration) noiseNodes.source.connect(noiseNodes.dest);
      }
    } else {
      noiseNodes.source.connect(noiseNodes.dest);
    }
  }

  // ── Peer connections ──

  function createPeerConnection(sessionId: string, isInitiator: boolean) {
    if (peers.has(sessionId)) return;

    const pc = new RTCPeerConnection(rtcConfig || STUN_ONLY_CONFIG);
    const entry: PeerEntry = { pc, isInitiator, stream: null, analyser: null, source: null, pendingCandidates: [] };
    peers.set(sessionId, entry);
    voice.setPeer(sessionId, voice.peers.find((peer) => peer.sessionId === sessionId)?.volume ?? 100);

    const outbound = getOutboundStream();
    if (outbound) {
      for (const track of outbound.getTracks()) {
        pc.addTrack(track, outbound);
      }
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        closePeer(sessionId);
        ui.showToast(t('voice_connect_failed', {
          name: players.value.find((player) => player.sessionId === sessionId)?.name || sessionId,
        }), 'error');
      }
    };

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
      audio.volume = (voice.peers.find((peer) => peer.sessionId === sessionId)?.volume ?? 100) / 100;
      if (!audioElements.has(sessionId)) {
        audioElements.set(sessionId, audio);
        audioContainer.value?.appendChild(audio);
      }
      void audio.play().catch(() => {});
      setupAnalyser(sessionId, remoteStream, entry);
    };

    pc.onnegotiationneeded = () => {
      if (!isInitiator || pc.signalingState !== 'stable') return;
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
    };
  }

  async function flushCandidates(entry: PeerEntry) {
    for (const candidate of entry.pendingCandidates.splice(0)) {
      await entry.pc.addIceCandidate(candidate);
    }
  }

  function setupAnalyser(sessionId: string, stream: MediaStream, entry: PeerEntry) {
    try {
      const context = ensureAudioContext();
      entry.source?.disconnect();
      entry.analyser?.disconnect();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      entry.source = source;
      entry.analyser = analyser;
      voice.setSpeaking(sessionId, false);
    } catch (_error) {}
  }

  function closePeer(sessionId: string) {
    const entry = peers.get(sessionId);
    if (entry) {
      entry.source?.disconnect();
      entry.analyser?.disconnect();
      entry.pc.close();
      peers.delete(sessionId);
      voice.removePeer(sessionId);
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
        localAnalyserSource = source;
        localAnalyser = context.createAnalyser();
        localAnalyser.fftSize = 256;
        source.connect(localAnalyser);
      } catch (_error) {}
    }

    speakingInterval = window.setInterval(() => {
      const myId = meSessionId.value;
      if (myId && localAnalyser) {
        if (!voice.muted && isSpeaking(localAnalyser)) lastSpeechAt = Date.now();
        const speaking = !voice.muted && Date.now() - lastSpeechAt < 250;
        voice.setSpeaking(myId, speaking);
        if (speaking !== lastReportedSpeaking && socket.connected) {
          lastReportedSpeaking = speaking;
          socket.emit('voice:speaking', { speaking });
        }
      }
      for (const [sessionId, entry] of peers) {
        if (!entry.analyser) continue;
        voice.setSpeaking(sessionId, isSpeaking(entry.analyser));
      }
    }, SPEAKING_POLL_MS);
  }

  function stopSpeakingDetection() {
    lastReportedSpeaking = false;
    lastSpeechAt = 0;
    localAnalyserSource?.disconnect();
    localAnalyserSource = null;
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
    leaveVoice(socket.connected);
    for (const [event, handler] of subscriptions) socket.off(event, handler);
    void audioCtx?.close();
  });

  watch(meSessionId, (next, previous) => {
    if (previous && next !== previous) leaveVoice(false);
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
