import { usePreferencesStore } from '../stores/preferences';
import { createDuckGain } from './voice-duck';

let audioCtx: AudioContext | null = null;
// Every effect leaves through the party voice-chat duck.
let output: AudioNode | null = null;

function getContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!)();
    // effects -> voice duck -> gentle limiter -> speakers. The limiter keeps
    // overlapping effects from stacking into a harsh peak over voice chat.
    const duck = createDuckGain(audioCtx);
    const limiter = audioCtx.createDynamicsCompressor();
    limiter.threshold.value = -16;
    limiter.knee.value = 10;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.2;
    duck.connect(limiter);
    limiter.connect(audioCtx.destination);
    output = duck;
  }
  if (audioCtx.state === 'suspended') {
    void audioCtx.resume();
  }
  return audioCtx;
}

export function unlockSound(): void {
  if (usePreferencesStore().soundMuted) return;
  try { getContext(); } catch (_error) {}
}

export function toggleSoundMute(): boolean {
  const preferences = usePreferencesStore();
  const nextValue = !preferences.soundMuted;
  preferences.setSoundMuted(nextValue);

  if (!nextValue) {
    try {
      const ctx = getContext();
      playTone(ctx, 880, 0.06, 'sine', 0.15);
    } catch (_error) {}
  }

  return nextValue;
}

export function playSound(name: string, volume = 0.3): void {
  const preferences = usePreferencesStore();
  if (preferences.soundMuted) return;

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
        window.setTimeout(() => playTone(ctx, 660, 0.06, 'sine', volume), 80);
        break;
      case 'assassin':
        playDissonantChord(ctx, volume * 1.2);
        break;
      case 'gg':
        playTone(ctx, 523, 0.08, 'sine', volume * 0.4);
        window.setTimeout(() => playTone(ctx, 659, 0.08, 'sine', volume * 0.4), 100);
        window.setTimeout(() => playTone(ctx, 784, 0.12, 'sine', volume * 0.4), 200);
        break;
      case 'cardFlip':
        playTone(ctx, 80, 0.04, 'sine', volume * 0.4);
        playNoiseBurst(ctx, 0.03, volume * 0.15);
        break;
      case 'hint':
        playTone(ctx, 784, 0.09, 'triangle', volume * 0.6);
        window.setTimeout(() => playTone(ctx, 1047, 0.15, 'triangle', volume * 0.6), 100);
        break;
      case 'yourTurn':
        playTone(ctx, 698, 0.1, 'triangle', volume * 0.5);
        window.setTimeout(() => playTone(ctx, 880, 0.14, 'triangle', volume * 0.5), 120);
        break;
      default:
        playTone(ctx, 600, 0.05, 'sine', volume * 0.3);
    }
  } catch (_error) {}
}

function playTone(
  ctx: AudioContext,
  frequency: number,
  duration: number,
  type: OscillatorType,
  volume: number
) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();

  oscillator.type = type;
  oscillator.frequency.value = frequency;
  // A short attack avoids the click of a gain jump from 0.
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(volume, now + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  oscillator.connect(gain);
  gain.connect(output ?? ctx.destination);
  oscillator.start(ctx.currentTime);
  oscillator.stop(ctx.currentTime + duration + 0.01);
}

function playNoiseBurst(ctx: AudioContext, duration: number, volume: number) {
  const bufferSize = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i += 1) {
    data[i] = (Math.random() * 2 - 1) * 0.5;
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  // Paper rustle, not white-noise hiss: keep the top end out.
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 2400;
  const gain = ctx.createGain();
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(volume, now + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(output ?? ctx.destination);
  source.start(now);
}

// The assassin: an ominous low cluster, softened (triangle waves through a
// lowpass, a 30 ms swell) so it reads as dread rather than a harsh buzz.
function playDissonantChord(ctx: AudioContext, volume: number) {
  const now = ctx.currentTime;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1400, now);
  filter.frequency.exponentialRampToValueAtTime(300, now + 0.9);
  filter.connect(output ?? ctx.destination);
  for (const frequency of [110, 116.5, 138.6]) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(volume * 0.28, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.95);
    oscillator.connect(gain);
    gain.connect(filter);
    oscillator.start(now);
    oscillator.stop(now + 1);
  }
}
