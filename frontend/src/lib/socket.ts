import { io } from 'socket.io-client';

import type { AckResponse, TurnCredentialsResponse } from '../types';
import { getBasePath } from './runtime';
import { createAccountRenewal, requestAccountSession } from './account-session';

export const socket = io({
  path: `${getBasePath()}socket.io`,
  auth: (done) => {
    if(new URLSearchParams(location.search).has('party')){done({});return;}
    requestAccountSession().then(session => {
      accountRenewal.setToken(session?.token);
      done(session?.token ? { accountToken: session.token } : {});
    }).catch(() => { accountRenewal.setToken(); done({ accountUnavailable: true }); });
  },
});
const accountRenewal = createAccountRenewal(socket);
let accountRetryTimer: ReturnType<typeof setTimeout> | undefined;
socket.on('connect', () => clearTimeout(accountRetryTimer));
socket.on('connect_error', () => {
  // Socket.IO retries transport failures itself, but middleware rejections
  // require an explicit reconnect with a freshly obtained account proof.
  if (socket.active) return;
  clearTimeout(accountRetryTimer);
  accountRetryTimer = setTimeout(() => socket.connect(), 5000);
});

export function emitWithAck<T extends Record<string, unknown>>(
  event: string,
  payload: Record<string, unknown>,
  timeoutMs = 7000
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!socket.connected) {
      reject(new Error('Disconnected. Wait for the connection to recover.'));
      return;
    }
    socket.timeout(timeoutMs).emit(event, payload, (error: Error | null, response: AckResponse<T>) => {
      if (error) {
        reject(new Error(`Request timed out (${event}).`));
        return;
      }

      if (!response) {
        reject(new Error('No response from server.'));
        return;
      }

      if (response.ok) {
        resolve(response);
        return;
      }

      reject(new Error(response.error || 'Request rejected.'));
    });
  });
}

export async function fetchTurnCredentials(): Promise<TurnCredentialsResponse> {
  return emitWithAck<TurnCredentialsResponse & Record<string, unknown>>('voice:credentials', {});
}
