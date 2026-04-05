import { usePreferencesStore } from '../stores/preferences';

let audioCtx: AudioContext | null = null;

function getContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!)();
  }
  if (audioCtx.state === 'suspended') {
    void audioCtx.resume();
  }
  return audioCtx;
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
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
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
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  source.connect(gain);
  gain.connect(ctx.destination);
  source.start(ctx.currentTime);
}

function playDissonantChord(ctx: AudioContext, volume: number) {
  for (const frequency of [220, 233, 277]) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sawtooth';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(volume * 0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.81);
  }
}
