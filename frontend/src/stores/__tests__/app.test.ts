import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useAppStore } from '../app';

describe('session reconnection', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it('allows another rejoin after every disconnect without losing the session', () => {
    const app = useAppStore();
    app.session = { code: 'ABCD', sessionId: 'session-1', name: 'Host' };
    for (let attempt = 0; attempt < 3; attempt++) {
      app.rejoinAttempted = true;
      app.setConnection(false, 'Disconnected');
      app.setConnection(true, 'Connected');
      expect(app.rejoinAttempted).toBe(false);
      expect(app.session?.sessionId).toBe('session-1');
    }
  });
});
