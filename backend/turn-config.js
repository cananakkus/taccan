const { createHmac, createHash } = require('node:crypto');

function getIceServers(env = process.env, now = Date.now(), options = {}) {
  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];
  const host = env.TURN_HOST;
  let username = env.TURN_USERNAME;
  let credential = env.TURN_CREDENTIAL;
  if (host && env.TURN_SHARED_SECRET) {
    const ttl = Number(options.ttlSeconds ?? env.VOICE_CREDENTIAL_TTL_SECONDS ?? 600);
    if (!Number.isInteger(ttl) || ttl < 120 || ttl > 3600) throw new Error('Voice credential TTL must be between 120 and 3600 seconds.');
    const subject = createHash('sha256').update(options.subject || 'murmur').digest('hex').slice(0, 32);
    username = `${Math.floor(now / 1000) + ttl}:${subject}`;
    credential = createHmac('sha1', env.TURN_SHARED_SECRET).update(username).digest('base64');
  }
  if (host && username && credential) {
    iceServers.push(
      { urls: `stun:${host}:3478` },
      {
        urls: [`turn:${host}:3478`, `turn:${host}:3478?transport=tcp`],
        username,
        credential,
      },
    );
  }
  return iceServers;
}

module.exports = { getIceServers };
