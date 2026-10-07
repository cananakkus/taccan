import type { TurnCredentialsResponse } from '../types';

// Transport-independent lease renewal. Temporary broker outages can use the
// current credential until its expiry; a stale response cannot revive a call.
export function createVoiceCredentialRenewal(
  request: () => Promise<TurnCredentialsResponse>,
  apply: (config: TurnCredentialsResponse, renewing: boolean) => void,
  expired: (error: Error) => void
) {
  let generation = 0;
  let renewalTimer: ReturnType<typeof setTimeout> | undefined;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let expiresAt = 0;
  let lastError = new Error('Voice credentials expired. Rejoin voice chat.');
  function stop() {
    generation++;
    clearTimeout(renewalTimer);
    clearTimeout(expiryTimer);
  }
  function install(config: TurnCredentialsResponse, renewing: boolean) {
    if (!Number.isFinite(config.expiresAt) || config.expiresAt <= Date.now()) throw new Error('Voice credentials expired.');
    apply(config, renewing);
    expiresAt = config.expiresAt;
    lastError = new Error('Voice credentials expired. Rejoin voice chat.');
    clearTimeout(renewalTimer);
    clearTimeout(expiryTimer);
    const current = generation;
    expiryTimer = setTimeout(() => {
      if (current !== generation) return;
      stop();
      expired(lastError);
    }, expiresAt - Date.now());
    schedule(Math.max(1000, expiresAt - Date.now() - 60_000));
  }
  function schedule(delay: number) {
    const current = generation;
    renewalTimer = setTimeout(async () => {
      try {
        const config = await request();
        if (current === generation) install(config, true);
      } catch (error) {
        if (current !== generation) return;
        lastError = error instanceof Error ? error : new Error('Voice service is unavailable.');
        if (Date.now() < expiresAt) schedule(Math.min(10_000, expiresAt - Date.now()));
      }
    }, delay);
  }
  return {
    start(config: TurnCredentialsResponse) { stop(); install(config, false); },
    stop,
  };
}
