import { io } from 'socket.io-client';

import type { AckResponse, TurnCredentialsResponse } from '../types';
import { getBasePath } from './runtime';

export const socket = io({
  path: `${getBasePath()}socket.io`,
});

export function emitWithAck<T extends Record<string, unknown>>(
  event: string,
  payload: Record<string, unknown>,
  timeoutMs = 7000
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`Request timed out (${event}).`));
    }, timeoutMs);

    socket.emit(event, payload, (response: AckResponse<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

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
  const response = await fetch(`${getBasePath()}api/turn-credentials`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) {
    throw new Error(`TURN credentials request failed (${response.status}).`);
  }

  return response.json() as Promise<TurnCredentialsResponse>;
}
