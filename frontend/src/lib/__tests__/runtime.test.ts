import { describe, expect, it } from 'vitest';

import { getBasePath, getInitialRoomCode } from '../runtime';

describe('runtime helpers', () => {
  it('detects room routes under root and subpath deployments', () => {
    expect(getBasePath('/room/ABCD')).toBe('/');
    expect(getBasePath('/taccan/room/ABCD')).toBe('/taccan/');
    expect(getBasePath('/taccan')).toBe('/taccan/');
  });

  it('extracts room codes from deep links', () => {
    expect(getInitialRoomCode('/room/ABCD')).toBe('ABCD');
    expect(getInitialRoomCode('/taccan/room/wxyz')).toBe('WXYZ');
    expect(getInitialRoomCode('/')).toBe('');
  });
});
