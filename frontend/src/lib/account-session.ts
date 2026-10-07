interface PlatformSession { token: string }
interface AccountPlatform { session: (game: string) => Promise<PlatformSession | null> }
interface AccountSocket {
  connected: boolean;
  on: (event: string, handler: () => void) => unknown;
  timeout: (milliseconds: number) => {
    emit: (event: string, payload: unknown, callback: (error: Error | null, response: { ok: boolean; expiresAt?: number }) => void) => unknown;
  };
}

export async function requestAccountSession(): Promise<PlatformSession | null> {
  const platform = (window as Window & { Wleeaf?: AccountPlatform }).Wleeaf;
  if (typeof platform?.session !== 'function') return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => platform.session('taccan')),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Account service timed out.')), 5000); }),
    ]);
  } finally { clearTimeout(timer); }
}

export function accountTokenExpiry(token: string): number {
  try {
    const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const { exp } = JSON.parse(atob(encoded));
    return Number.isInteger(exp) ? exp * 1000 : 0;
  } catch { return 0; }
}

// Keep the existing socket (and microphone) while renewing the gateway proof.
// Expiry remains authoritative on the server if the gateway is unavailable.
export function createAccountRenewal(socket: AccountSocket, request = requestAccountSession) {
  let expiresAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  function stop() { generation++; clearTimeout(timer); }
  function schedule(delay = Math.max(1000, expiresAt - Date.now() - 60_000)) {
    clearTimeout(timer);
    if (socket.connected && expiresAt) timer = setTimeout(() => { void refresh(); }, delay);
  }
  async function refresh() {
    const current = generation;
    try {
      const session = await request();
      if (current !== generation || !socket.connected) return;
      if (!session?.token) throw new Error('Account session ended.');
      const response = await new Promise<{ ok: boolean; expiresAt?: number }>((resolve, reject) => {
        socket.timeout(7000).emit('account:refresh', { token: session.token }, (error, result) => {
          if (error || !result?.ok) reject(error || new Error('Account refresh rejected.'));
          else resolve(result);
        });
      });
      if (current !== generation || !socket.connected) return;
      expiresAt = response.expiresAt ?? accountTokenExpiry(session.token);
      schedule();
    } catch {
      if (current === generation && socket.connected) schedule(5000);
    }
  }
  socket.on('connect', () => { generation++; schedule(); });
  socket.on('disconnect', stop);
  return {
    setToken(token?: string) { stop(); expiresAt = token ? accountTokenExpiry(token) : 0; schedule(); },
  };
}
