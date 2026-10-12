// Play's party page runs voice chat around this game's iframe and posts
// { type: 'play:voice', active, talking, level } on every change. `level` is
// the game volume the hub suggests (0.4 in a call, 0.15 while someone talks);
// older hubs omit it, and then 0.6/0.22 apply. Game audio ducks under the
// voices: one shared level drives a duck gain that every effect passes
// through, so it combines with the mute toggle and never replaces it.
export const DUCK = { idle: 1, active: 0.6, talking: 0.22 } as const;
const ATTACK = 0.12; // seconds to settle when ducking
const RELEASE = 0.7; // seconds to settle when recovering

export type VoiceState = { active?: boolean; talking?: boolean; level?: unknown };

export function duckLevel(voice?: VoiceState | null) {
  const level = voice?.level;
  if (typeof level === 'number' && Number.isFinite(level)) return Math.min(1, Math.max(0, level));
  return voice?.talking
    ? DUCK.talking
    : voice?.active
      ? DUCK.active
      : DUCK.idle;
}

let level: number = DUCK.idle;
const gains = new Set<GainNode>();

export function voiceDuckLevel() {
  return level;
}

// A gain node starting at the current level; route the master through it.
export function createDuckGain(ctx: BaseAudioContext) {
  const node = ctx.createGain();
  node.gain.value = level;
  gains.add(node);
  return node;
}

export function setVoiceDuck(next: number) {
  if (next === level) return;
  // setTargetAtTime glides from wherever the gain is now: no clicks.
  const timeConstant = (next < level ? ATTACK : RELEASE) / 3;
  level = next;
  for (const node of gains) {
    if (node.context.state === 'closed') {
      gains.delete(node);
      continue;
    }
    node.gain.setTargetAtTime(next, node.context.currentTime, timeConstant);
  }
}

type MessageTarget = Pick<
  Window,
  'addEventListener' | 'removeEventListener' | 'location'
>;

export function listenForVoice(target: MessageTarget = window) {
  const onMessage = (event: MessageEvent) => {
    if (
      event.origin !== target.location.origin ||
      event.data?.type !== 'play:voice'
    )
      return;
    setVoiceDuck(duckLevel(event.data));
  };
  target.addEventListener('message', onMessage);
  return () => target.removeEventListener('message', onMessage);
}

// Listen from the first import so the message sent on iframe load is not missed.
if (typeof window !== 'undefined') listenForVoice();
