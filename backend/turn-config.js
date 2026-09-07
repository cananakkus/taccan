const { createHmac } = require('node:crypto');

function getIceServers(env = process.env, now = Date.now()) {
  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];
  const host = env.TURN_HOST;
  let username = env.TURN_USERNAME;
  let credential = env.TURN_CREDENTIAL;
  if (host && env.TURN_SHARED_SECRET) {
    // Coturn REST credentials: valid for a day, longer than a room's 8h TTL.
    // Only the derived credential is sent to clients, never the signing secret.
    username = `${Math.floor(now / 1000) + 86400}:taccan`;
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
