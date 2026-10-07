import { afterEach, expect, it, vi } from 'vitest';
import { accountTokenExpiry, createAccountRenewal, requestAccountSession } from '../account-session';

afterEach(() => { vi.useRealTimers(); delete (window as any).Wleeaf; });
const token = (exp: number) => `header.${btoa(JSON.stringify({ exp }))}.signature`;
function fakeSocket() {
  const handlers = new Map<string, () => void>();
  const emit = vi.fn((_event: string, _payload: unknown, callback: (error: Error | null, response: { ok: boolean; expiresAt: number }) => void) => callback(null, { ok: true, expiresAt: Date.now() + 300_000 }));
  const socket = { connected: true, on: (event: string, fn: () => void) => handlers.set(event, fn), timeout: () => ({ emit }) };
  return { socket, handlers, emit };
}

it('renews before expiry through the existing socket and cancels renewal after disconnect', async () => {
  vi.useFakeTimers();
  const { socket, handlers, emit } = fakeSocket();
  const request = vi.fn(async () => ({ token: token(Math.floor(Date.now() / 1000) + 300) }));
  const renewal = createAccountRenewal(socket, request);
  renewal.setToken(token(Math.floor(Date.now() / 1000) + 300));
  await vi.advanceTimersByTimeAsync(240_000);
  expect(request).toHaveBeenCalledOnce();
  expect(emit).toHaveBeenCalledWith('account:refresh', expect.objectContaining({ token: expect.any(String) }), expect.any(Function));
  socket.connected = false;
  handlers.get('disconnect')!();
  await vi.advanceTimersByTimeAsync(600_000);
  expect(request).toHaveBeenCalledOnce();
});

it('retries gateway outages without dropping the call or assuming guest identity', async () => {
  vi.useFakeTimers();
  const { socket, emit } = fakeSocket();
  const request = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ token: token(Math.floor(Date.now() / 1000) + 300) });
  createAccountRenewal(socket, request).setToken(token(Math.floor(Date.now() / 1000) + 61));
  await vi.advanceTimersByTimeAsync(1000);
  expect(emit).not.toHaveBeenCalled();
  expect(socket.connected).toBe(true);
  await vi.advanceTimersByTimeAsync(5000);
  expect(emit).toHaveBeenCalledOnce();
});

it('discards delayed account responses from a previous connection', async () => {
  vi.useFakeTimers();
  const { socket, handlers, emit } = fakeSocket();
  let resolve!: (value: { token: string }) => void;
  const request = () => new Promise<{ token: string }>(done => { resolve = done; });
  const renewal = createAccountRenewal(socket, request);
  renewal.setToken(token(Math.floor(Date.now() / 1000) + 61));
  await vi.advanceTimersByTimeAsync(1000);
  handlers.get('disconnect')!();
  handlers.get('connect')!();
  resolve({ token: token(Math.floor(Date.now() / 1000) + 300) });
  await vi.advanceTimersByTimeAsync(0);
  expect(emit).not.toHaveBeenCalled();
});

it('standalone guests skip account exchange; gateway failures and timeouts remain errors', async () => {
  expect(await requestAccountSession()).toBeNull();
  (window as any).Wleeaf = { session: async () => { throw new Error('offline'); } };
  await expect(requestAccountSession()).rejects.toThrow('offline');
  vi.useFakeTimers();
  (window as any).Wleeaf = { session: () => new Promise(() => {}) };
  const result = expect(requestAccountSession()).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(5000);
  await result;
  expect(accountTokenExpiry('invalid')).toBe(0);
});
