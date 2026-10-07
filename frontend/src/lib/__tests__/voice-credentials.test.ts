import { afterEach, expect, it, vi } from 'vitest';
import { createVoiceCredentialRenewal } from '../voice-credentials';

afterEach(() => vi.useRealTimers());
const config = (remaining = 120_000) => ({ iceServers: [{ urls: 'turn:example.test' }], expiresAt: Date.now() + remaining });

it('keeps a valid lease during a temporary outage and installs renewed credentials', async () => {
  vi.useFakeTimers();
  const request = vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementation(async () => config());
  const apply = vi.fn(), expired = vi.fn();
  createVoiceCredentialRenewal(request, apply, expired).start(config());
  await vi.advanceTimersByTimeAsync(60_000);
  expect(request).toHaveBeenCalledOnce();
  expect(expired).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(apply).toHaveBeenLastCalledWith(expect.objectContaining({ expiresAt: Date.now() + 120_000 }), true);
  expect(expired).not.toHaveBeenCalled();
});

it('expires on time even while the credential request is stuck', async () => {
  vi.useFakeTimers();
  const request = () => new Promise<never>(() => {});
  const expired = vi.fn();
  createVoiceCredentialRenewal(request, vi.fn(), expired).start(config());
  await vi.advanceTimersByTimeAsync(120_000);
  expect(expired).toHaveBeenCalledOnce();
});

it('stopped calls discard late credentials and never restart their timers', async () => {
  vi.useFakeTimers();
  let resolve!: (value: ReturnType<typeof config>) => void;
  const request = () => new Promise<ReturnType<typeof config>>(done => { resolve = done; });
  const apply = vi.fn(), expired = vi.fn();
  const renewal = createVoiceCredentialRenewal(request, apply, expired);
  renewal.start(config());
  await vi.advanceTimersByTimeAsync(60_000);
  renewal.stop();
  resolve(config());
  await vi.advanceTimersByTimeAsync(300_000);
  expect(apply).toHaveBeenCalledOnce();
  expect(expired).not.toHaveBeenCalled();
});
