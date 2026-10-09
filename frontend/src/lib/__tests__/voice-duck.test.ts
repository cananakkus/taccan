import { expect, it } from 'vitest';
import { DUCK, createDuckGain, duckLevel, listenForVoice, voiceDuckLevel } from '../voice-duck';

function fakeContext() {
  const calls: Array<{ value: number; at: number; constant: number }> = [];
  const ctx = {
    state: 'running',
    currentTime: 5,
    createGain: () => ({
      context: ctx,
      gain: { value: 1, setTargetAtTime: (value: number, at: number, constant: number) => calls.push({ value, at, constant }) },
    }),
  };
  return { ctx: ctx as unknown as BaseAudioContext, calls, last: () => calls[calls.length - 1] };
}

function fakeWindow(origin: string) {
  const target = Object.assign(new EventTarget(), { location: { origin } });
  const post = (data: unknown, from = origin) => target.dispatchEvent(new MessageEvent('message', { data, origin: from }));
  return { target: target as unknown as Window, post };
}

it('maps the party voice state to a duck level', () => {
  expect(duckLevel()).toBe(DUCK.idle);
  expect(duckLevel({ active: false, talking: false })).toBe(1);
  expect(duckLevel({ active: true, talking: false })).toBe(0.6);
  expect(duckLevel({ active: true, talking: true })).toBe(0.22);
});

it('ducks fast, recovers slowly and ignores other origins', () => {
  const { ctx, calls, last } = fakeContext();
  const { target, post } = fakeWindow('https://play.test');
  const node = createDuckGain(ctx);
  const stop = listenForVoice(target);
  expect(node.gain.value).toBe(1);
  post({ type: 'play:voice', active: true, talking: true }, 'https://evil.test');
  post({ type: 'other', active: true, talking: true });
  expect(calls).toHaveLength(0);
  post({ type: 'play:voice', active: true, talking: true });
  expect(voiceDuckLevel()).toBe(0.22);
  expect(last()).toEqual({ value: 0.22, at: 5, constant: 0.04 });
  post({ type: 'play:voice', active: true, talking: false });
  expect(last().value).toBe(0.6);
  expect(last().constant).toBeCloseTo(0.7 / 3);
  post({ type: 'play:voice', active: false, talking: false });
  expect(last().value).toBe(1);
  stop();
  post({ type: 'play:voice', active: true, talking: true });
  expect(voiceDuckLevel()).toBe(1);
});
