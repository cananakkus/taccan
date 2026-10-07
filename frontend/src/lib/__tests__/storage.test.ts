import { beforeEach, describe, expect, it } from 'vitest';
import { readSession, writeSession, clearSession, STORAGE_KEY } from '../storage';

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

it('tournament snapshots do not overwrite a standalone reconnect credential',()=>{
 window.history.replaceState(null,'','/murmur/');
 const standalone={code:'ABCD',sessionId:'standalone',name:'Ada',reconnectToken:'proof'};
 writeSession(standalone);
 window.history.replaceState(null,'','/murmur/?party=AABBCCDD&match=tournament');
 expect(readSession()).toBeNull();
 writeSession({code:'WXYZ',sessionId:'tournament',name:'Ada'});clearSession();
 window.history.replaceState(null,'','/murmur/');
 expect(readSession()).toEqual(standalone);
});
