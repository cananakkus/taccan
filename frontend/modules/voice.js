import { state, NOISE_SUPPRESSION_KEY } from './state.js';
import { ui } from './ui.js';
import { socket, emitWithAck } from './socket.js';
import { showToast } from './helpers.js';
import { render } from './render.js';

// --- Private state ---
let localStream = null;
let joining = false;
const peers = new Map(); // sessionId → { pc, stream, analyser, restarts, disconnectedTimer }
const audioElements = new Map(); // sessionId → HTMLAudioElement
let speakingInterval = null;
let audioCtx = null;

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:46.225.102.80:3478' },
    {
      urls: ['turn:46.225.102.80:3478', 'turn:46.225.102.80:3478?transport=tcp'],
      username: 'taccan',
      credential: 'taccanturn2026',
    },
  ],
};

const MAX_ICE_RESTARTS = 2;
const DISCONNECT_TIMEOUT_MS = 5000;
const SPEAKING_THRESHOLD = 15;
const SPEAKING_POLL_MS = 100;

// --- Exports ---

export function initVoice() {
  if (typeof RTCPeerConnection === 'undefined') {
    if (ui.voiceJoinBtn) ui.voiceJoinBtn.classList.add('hidden');
    return;
  }

  try {
    const stored = localStorage.getItem(NOISE_SUPPRESSION_KEY);
    if (stored !== null) state.noiseSuppression = stored !== 'false';
  } catch (_e) {}

  socket.on('voice:peer_joined', ({ sessionId }) => {
    if (!state.voiceActive) return;
    createPeerConnection(sessionId, true);
  });

  socket.on('voice:peer_left', ({ sessionId }) => {
    if (!state.voiceActive) return;
    closePeer(sessionId);
    state.voicePeers.delete(sessionId);
    state.voiceSpeaking.delete(sessionId);
    state.voiceMutedPeers.delete(sessionId);
    render();
  });

  socket.on('voice:signal', async ({ fromSessionId, type, sdp, candidate }) => {
    if (!state.voiceActive) return;

    try {
      let entry = peers.get(fromSessionId);

      if (type === 'offer') {
        if (entry) {
          if (entry.pc.signalingState === 'have-local-offer') {
            // Glare: both sides sent offers simultaneously
            const myId = state.snapshot?.me?.sessionId || '';
            const polite = myId < fromSessionId;
            if (!polite) return; // ignore incoming offer, we're impolite
            await entry.pc.setLocalDescription({ type: 'rollback' });
          }
          // stable state: accept directly (e.g. ICE restart offer)
        } else {
          createPeerConnection(fromSessionId, false);
          entry = peers.get(fromSessionId);
        }
        if (!entry) return;
        await entry.pc.setRemoteDescription({ type: 'offer', sdp });
        const answer = await entry.pc.createAnswer();
        await entry.pc.setLocalDescription(answer);
        emitWithAck('voice:signal', {
          targetSessionId: fromSessionId,
          type: 'answer',
          sdp: entry.pc.localDescription.sdp,
        }).catch(() => {});
      } else if (type === 'answer') {
        if (!entry) return;
        await entry.pc.setRemoteDescription({ type: 'answer', sdp });
      } else if (type === 'candidate') {
        if (!entry) return;
        if (candidate) {
          try {
            await entry.pc.addIceCandidate(JSON.parse(candidate));
          } catch (_e) {}
        }
      }
    } catch (_err) {
      // WebRTC negotiation error — peer connection may be in bad state
      const entry = peers.get(fromSessionId);
      if (entry) {
        closePeer(fromSessionId);
        state.voicePeers.delete(fromSessionId);
        render();
      }
    }
  });

  socket.on('voice:mute_changed', ({ sessionId, muted }) => {
    if (!state.voiceActive) return;
    if (muted) {
      state.voiceMutedPeers.add(sessionId);
    } else {
      state.voiceMutedPeers.delete(sessionId);
    }
    render();
  });

  socket.on('disconnect', () => {
    destroyAllPeers();
  });
}

export async function joinVoice() {
  if (state.voiceActive) {
    leaveVoice();
    return;
  }

  if (joining) return;
  joining = true;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        noiseSuppression: state.noiseSuppression,
        echoCancellation: true,
        autoGainControl: true,
      },
      video: false,
    });
  } catch (_err) {
    showToast('Microphone access denied');
    joining = false;
    return;
  }

  state.voiceActive = true;
  state.voiceMuted = false;
  updateVoiceButtons();

  try {
    const response = await emitWithAck('voice:join', {});
    const existingPeers = response.peers || [];
    for (const peerId of existingPeers) {
      state.voicePeers.add(peerId);
      createPeerConnection(peerId, true);
    }
  } catch (err) {
    console.error('[voice] join failed:', err);
    showToast(err.message || 'Failed to join voice');
    stopLocalStream();
    state.voiceActive = false;
    updateVoiceButtons();
    joining = false;
    return;
  }

  joining = false;
  startSpeakingDetection();
  render();
}

export function leaveVoice() {
  if (!state.voiceActive) return;

  // Clean up local state without the server-notify path in destroyAllPeers
  for (const [sessionId] of peers) {
    closePeer(sessionId);
  }
  stopLocalStream();
  stopSpeakingDetection();

  state.voiceActive = false;
  state.voiceMuted = false;
  state.voicePeers.clear();
  state.voiceSpeaking.clear();
  state.voiceMutedPeers.clear();

  updateVoiceButtons();

  emitWithAck('voice:leave', {}).catch(() => {});
  render();
}

export function toggleMute() {
  if (!state.voiceActive || !localStream) return;

  state.voiceMuted = !state.voiceMuted;
  for (const track of localStream.getAudioTracks()) {
    track.enabled = !state.voiceMuted;
  }
  updateVoiceButtons();

  emitWithAck('voice:mute', { muted: state.voiceMuted }).catch(() => {});
}

export function toggleNoiseSuppression() {
  if (!state.voiceActive || !localStream) return;

  state.noiseSuppression = !state.noiseSuppression;
  try { localStorage.setItem(NOISE_SUPPRESSION_KEY, String(state.noiseSuppression)); } catch (_e) {}

  for (const track of localStream.getAudioTracks()) {
    track.applyConstraints({ noiseSuppression: state.noiseSuppression }).catch(() => {});
  }
  updateVoiceButtons();
}

export function destroyAllPeers() {
  for (const [sessionId] of peers) {
    closePeer(sessionId);
  }
  state.voicePeers.clear();
  state.voiceSpeaking.clear();
  state.voiceMutedPeers.clear();

  if (state.voiceActive) {
    stopLocalStream();
    stopSpeakingDetection();
    state.voiceActive = false;
    state.voiceMuted = false;
    updateVoiceButtons();
    render();
  }
}

// --- Internal ---

function createPeerConnection(sessionId, isInitiator) {
  if (peers.has(sessionId)) return;

  const pc = new RTCPeerConnection(RTC_CONFIG);
  const entry = { pc, stream: null, analyser: null, restarts: 0, disconnectedTimer: null };
  peers.set(sessionId, entry);
  state.voicePeers.add(sessionId);

  // Add local tracks
  if (localStream) {
    for (const track of localStream.getTracks()) {
      pc.addTrack(track, localStream);
    }
  }

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      emitWithAck('voice:signal', {
        targetSessionId: sessionId,
        type: 'candidate',
        candidate: JSON.stringify(event.candidate),
      }).catch(() => {});
    }
  };

  pc.ontrack = (event) => {
    const remoteStream = event.streams[0] || new MediaStream([event.track]);
    entry.stream = remoteStream;

    // Create audio element for playback
    let audio = audioElements.get(sessionId);
    if (!audio) {
      audio = document.createElement('audio');
      audio.autoplay = true;
      audioElements.set(sessionId, audio);
      if (ui.voiceAudioContainer) ui.voiceAudioContainer.appendChild(audio);
    }
    audio.srcObject = remoteStream;
    audio.play().catch(() => {});

    // Set up analyser for speaking detection
    setupAnalyser(sessionId, remoteStream, entry);
  };

  pc.oniceconnectionstatechange = () => {
    const iceState = pc.iceConnectionState;

    if (entry.disconnectedTimer) {
      clearTimeout(entry.disconnectedTimer);
      entry.disconnectedTimer = null;
    }

    if (iceState === 'disconnected') {
      entry.disconnectedTimer = setTimeout(() => {
        if (pc.iceConnectionState !== 'disconnected') return;
        attemptIceRestart(sessionId, entry);
      }, DISCONNECT_TIMEOUT_MS);
    } else if (iceState === 'failed') {
      attemptIceRestart(sessionId, entry);
    } else if (iceState === 'connected') {
      entry.restarts = 0;
    }
  };

  if (isInitiator) {
    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .then(() => {
        emitWithAck('voice:signal', {
          targetSessionId: sessionId,
          type: 'offer',
          sdp: pc.localDescription.sdp,
        }).catch(() => {});
      })
      .catch(() => {});
  }

  render();
}

function attemptIceRestart(sessionId, entry) {
  if (entry.restarts >= MAX_ICE_RESTARTS) {
    showToast(`Could not connect to ${getPlayerName(sessionId)}`);
    closePeer(sessionId);
    state.voicePeers.delete(sessionId);
    state.voiceSpeaking.delete(sessionId);
    render();
    return;
  }
  entry.restarts++;
  entry.pc.createOffer({ iceRestart: true })
    .then((offer) => entry.pc.setLocalDescription(offer))
    .then(() => {
      emitWithAck('voice:signal', {
        targetSessionId: sessionId,
        type: 'offer',
        sdp: entry.pc.localDescription.sdp,
      }).catch(() => {});
    })
    .catch(() => {});
}

function closePeer(sessionId) {
  const entry = peers.get(sessionId);
  if (entry) {
    if (entry.disconnectedTimer) {
      clearTimeout(entry.disconnectedTimer);
      entry.disconnectedTimer = null;
    }
    entry.pc.onicecandidate = null;
    entry.pc.ontrack = null;
    entry.pc.oniceconnectionstatechange = null;
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

function stopLocalStream() {
  if (localStream) {
    for (const track of localStream.getTracks()) {
      track.stop();
    }
    localStream = null;
  }
}

function setupAnalyser(sessionId, stream, entry) {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    entry.analyser = analyser;
  } catch (_err) {
    // AudioContext not supported — speaking detection won't work for this peer
  }
}

function startSpeakingDetection() {
  if (speakingInterval) return;

  // Set up analyser for local stream
  if (localStream && !audioCtx) {
    try { audioCtx = new AudioContext(); } catch (_e) {}
  }

  let localAnalyser = null;
  if (localStream && audioCtx) {
    try {
      const source = audioCtx.createMediaStreamSource(localStream);
      localAnalyser = audioCtx.createAnalyser();
      localAnalyser.fftSize = 256;
      source.connect(localAnalyser);
    } catch (_e) {}
  }

  speakingInterval = setInterval(() => {
    const myId = state.snapshot?.me?.sessionId;
    let changed = false;

    // Check local speaking
    if (myId && localAnalyser) {
      const speaking = isSpeaking(localAnalyser);
      const wasSpeaking = state.voiceSpeaking.get(myId) || false;
      if (speaking !== wasSpeaking) {
        if (speaking) {
          state.voiceSpeaking.set(myId, true);
        } else {
          state.voiceSpeaking.delete(myId);
        }
        changed = true;
      }
    }

    // Check remote peers
    for (const [sessionId, entry] of peers) {
      if (!entry.analyser) continue;
      const speaking = isSpeaking(entry.analyser);
      const wasSpeaking = state.voiceSpeaking.get(sessionId) || false;
      if (speaking !== wasSpeaking) {
        if (speaking) {
          state.voiceSpeaking.set(sessionId, true);
        } else {
          state.voiceSpeaking.delete(sessionId);
        }
        changed = true;
      }
    }

    if (changed) {
      updateSpeakingClasses();
    }
  }, SPEAKING_POLL_MS);
}

function stopSpeakingDetection() {
  if (speakingInterval) {
    clearInterval(speakingInterval);
    speakingInterval = null;
  }
}

function isSpeaking(analyser) {
  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(data);
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i];
  return (sum / data.length) > SPEAKING_THRESHOLD;
}

function updateSpeakingClasses() {
  const items = document.querySelectorAll('.team-player-item');
  for (const item of items) {
    const sid = item.dataset.sessionId;
    if (!sid) continue;
    item.classList.toggle('speaking', state.voiceSpeaking.has(sid));
  }
}

function updateVoiceButtons() {
  if (ui.voiceJoinBtn) {
    ui.voiceJoinBtn.textContent = state.voiceActive ? 'Leave Voice' : 'Voice';
    ui.voiceJoinBtn.classList.toggle('in-voice', state.voiceActive);
  }
  if (ui.voiceMuteBtn) {
    ui.voiceMuteBtn.classList.toggle('hidden', !state.voiceActive);
    ui.voiceMuteBtn.textContent = state.voiceMuted ? 'Unmute' : 'Mute';
    ui.voiceMuteBtn.classList.toggle('muted', state.voiceMuted);
  }
  if (ui.voiceNoiseBtn) {
    ui.voiceNoiseBtn.classList.toggle('hidden', !state.voiceActive);
    ui.voiceNoiseBtn.textContent = state.noiseSuppression ? 'Noise Off' : 'Noise On';
    ui.voiceNoiseBtn.classList.toggle('noise-active', state.noiseSuppression);
  }
}

function getPlayerName(sessionId) {
  const players = state.snapshot?.players;
  if (!players) return sessionId;
  const player = players.find(p => p.sessionId === sessionId);
  return player ? player.name : sessionId;
}
