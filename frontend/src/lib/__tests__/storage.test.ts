import { beforeEach, describe, expect, it } from 'vitest';
import { readSession, STORAGE_KEY } from '../storage';

beforeEach(() => localStorage.clear());
describe('saved room sessions', () => {
  it('rejects corrupt or malformed records without crashing the join screen', () => {
    for (const value of ['invalid json', '{"code":42,"sessionId":"seat"}', '{"code":"ABCD","sessionId":{}}', '{"code":"ABCD","sessionId":"seat","name":42}']) {
      localStorage.setItem(STORAGE_KEY, value);
      expect(readSession()).toBeNull();
    }
  });
  it('accepts legacy lowercase codes and missing names', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ code: 'abcd', sessionId: 'seat' }));
    expect(readSession()).toEqual({ code: 'ABCD', sessionId: 'seat', name: '' });
  });
});
