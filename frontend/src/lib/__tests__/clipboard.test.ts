import { afterEach, expect, it, vi } from 'vitest';
import { copyText } from '../clipboard';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('copies invitations on LAN pages without the secure clipboard API', async () => {
  vi.stubGlobal('navigator', { clipboard: undefined });
  const exec = vi.fn(() => true);
  Object.defineProperty(document, 'execCommand', { configurable: true, value: exec });
  await copyText('http://192.168.1.2/room/ABCD');
  expect(exec).toHaveBeenCalledWith('copy');
  expect(document.querySelector('textarea')).toBeNull();
});
it('returns a handled failure when no clipboard API can copy', async () => {
  vi.stubGlobal('navigator', { clipboard: undefined });
  Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false });
  await expect(copyText('invite')).rejects.toThrow('Clipboard unavailable');
  expect(document.querySelector('textarea')).toBeNull();
});
