const { getIceServers } = require('./turn-config');

// Game adapters own membership and coverage. The credential provider can be
// local Coturn or the shared Wleeaf broker, without changing WebRTC signaling.
function createVoiceInfrastructure(options = {}) {
  const env = options.env ?? process.env;
  const application = options.application ?? 'murmur';
  const ttlSeconds = Number(env.VOICE_CREDENTIAL_TTL_SECONDS || 600);
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 120 || ttlSeconds > 3600) {
    throw new Error('Voice credential TTL must be between 120 and 3600 seconds.');
  }
  const serviceUrl = env.VOICE_SERVICE_URL;
  const serviceKey = env.VOICE_SERVICE_KEY;
  if (Boolean(serviceUrl) !== Boolean(serviceKey)) throw new Error('Voice service URL and key must be configured together.');
  if (serviceUrl) {
    const url = new URL(serviceUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('Invalid voice service URL.');
    }
  }

  return {
    async authorize(context) {
      // Default is free voice. A future entitlement adapter can evaluate all
      // verified accounts present in the room, including those outside voice.
      if (!options.authorize) return { allowed: true };
      const decision = await options.authorize(context);
      if (decision?.allowed !== true) throw new Error(decision?.error || 'Voice chat is not available in this room.');
      return decision;
    },
    async credentials({ roomId, playerId }) {
      if (serviceUrl) {
        const response = await fetch(`${serviceUrl.replace(/\/$/, '')}/v1/credentials`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({ application, roomId, playerId }),
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error('Voice service is temporarily unavailable. Try again.');
        const result = await response.json();
        if (!Array.isArray(result.iceServers) || !result.iceServers.length || !Number.isSafeInteger(result.expiresAt) || result.expiresAt <= Date.now() + 60_000 || result.expiresAt > Date.now() + 3_605_000) {
          throw new Error('Voice service returned invalid credentials.');
        }
        return { iceServers: result.iceServers, expiresAt: result.expiresAt };
      }
      const now = Date.now();
      return {
        iceServers: getIceServers(env, now, { ttlSeconds, subject: JSON.stringify([application, roomId, playerId]) }),
        expiresAt: (Math.floor(now / 1000) + ttlSeconds) * 1000,
      };
    },
  };
}

module.exports = { createVoiceInfrastructure };
