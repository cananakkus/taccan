import { state, SOUND_MUTE_KEY } from './state.js';
import { ui } from './ui.js';
import { t } from './i18n.js';

let audioCtx = null;

function getContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

// Load mute state
try {
  state.soundMuted = localStorage.getItem(SOUND_MUTE_KEY) === '1';
} catch (_e) {}

export function toggleMute() {
  state.soundMuted = !state.soundMuted;
  try { localStorage.setItem(SOUND_MUTE_KEY, state.soundMuted ? '1' : '0'); } catch (_e) {}
  if (ui.soundToggleButton) {
    ui.soundToggleButton.textContent = state.soundMuted ? t('sound_off') : t('sound_on');
  }
  if (!state.soundMuted) {
    try {
      const ctx = getContext();
      playTone(ctx, 880, 0.06, 'sine', 0.15);
    } catch (_e) {}
  }
}

export function playSound(name, volume = 0.3) {
  if (state.soundMuted) return;
  try {
    const ctx = getContext();
    switch (name) {
      case 'reveal':
        playNoiseBurst(ctx, 0.05, volume);
        break;
      case 'mark':
        playTone(ctx, 1200, 0.04, 'sine', volume * 0.5);
        break;
      case 'correct':
        playTone(ctx, 440, 0.06, 'sine', volume);
        setTimeout(() => playTone(ctx, 660, 0.06, 'sine', volume), 80);
        break;
      case 'assassin':
        playDissonantChord(ctx, volume * 1.2);
        break;
      case 'countdown':
        playHeartbeat(ctx, volume * 0.6);
        break;
      case 'gg':
        playTone(ctx, 523, 0.08, 'sine', volume * 0.4);
        setTimeout(() => playTone(ctx, 659, 0.08, 'sine', volume * 0.4), 100);
        setTimeout(() => playTone(ctx, 784, 0.12, 'sine', volume * 0.4), 200);
        break;
      case 'timerWarning':
        playTone(ctx, 800, 0.1, 'sawtooth', volume * 0.3);
        break;
      case 'cardFlip':
        playTone(ctx, 80, 0.04, 'sine', volume * 0.4);
        playNoiseBurst(ctx, 0.03, volume * 0.15);
        break;
      case 'yourTurn':
        playTone(ctx, 698, 0.1, 'triangle', volume * 0.5);
        setTimeout(() => playTone(ctx, 880, 0.14, 'triangle', volume * 0.5), 120);
        break;
      default:
        playTone(ctx, 600, 0.05, 'sine', volume * 0.3);
    }
  } catch (_e) {}
}

function playTone(ctx, freq, duration, type, volume) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + duration + 0.01);
}

function playNoiseBurst(ctx, duration, volume) {
  const bufferSize = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * 0.5;
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  source.connect(gain);
  gain.connect(ctx.destination);
  source.start(ctx.currentTime);
}

function playDissonantChord(ctx, volume) {
  const freqs = [220, 233, 277];
  for (const freq of freqs) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume * 0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.81);
  }
}

function playHeartbeat(ctx, volume) {
  playTone(ctx, 60, 0.08, 'sine', volume);
  setTimeout(() => playTone(ctx, 60, 0.08, 'sine', volume * 0.7), 150);
}

// Expose for actions.js lazy toggle
window._taccanSoundEngine = { SoundEngine: { toggleMute } };
