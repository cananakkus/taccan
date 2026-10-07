const { accountSessionActive, verifyAccountToken } = require('./account');

function createAccountSessions({ secret, audience = 'murmur' }) {
  const timers = new WeakMap();
  function verify(token) { return verifyAccountToken(token, audience, secret); }
  function attach(socket, account) {
    clearTimeout(timers.get(socket));
    socket.data.account = account;
    const timer = setTimeout(() => socket.conn.close(), Math.max(1, account.expires * 1000 - Date.now()));
    timer.unref();
    timers.set(socket, timer);
  }
  async function middleware(socket, next) {
    socket.use(async(_packet,next)=>{if(socket.data.account&&!await accountSessionActive(socket.data.account,secret,audience)){socket.conn.close();return next(new Error('Session expired'));}next();});
    let checking=false;
    const monitor=setInterval(async()=>{if(checking||!socket.data.account)return;checking=true;try{if(!await accountSessionActive(socket.data.account,secret,audience))socket.conn.close();}finally{checking=false;}},15000);monitor.unref();
    socket.once('disconnect',()=>clearInterval(monitor));
    socket.once('disconnect', () => { clearTimeout(timers.get(socket)); timers.delete(socket); });
    const token = socket.handshake.auth?.accountToken;
    if (socket.handshake.auth?.accountUnavailable) return next(new Error('Wleeaf account service is unavailable. Retrying sign-in.'));
    if (!token) return next();
    const account = verify(token);
    if (!account || !await accountSessionActive(account,secret,audience)) return next(new Error('Your account session expired. Reconnect to continue.'));
    attach(socket, account);
    next();
  }
  function register(socket, helpers) {
    socket.on('account:refresh', async (payload = {}, callback) => {
      const data = helpers.preflightAction(socket, 'account:refresh', payload, callback);
      if (!data) return;
      const account = verify(data.token);
      if (!account || !await accountSessionActive(account,secret,audience) || (socket.data.account && socket.data.account.id !== account.id)) {
        helpers.ackError(callback, 'Account proof is invalid or belongs to another account.');
        return;
      }
      const wasBound = Boolean(socket.data.roomCode);
      const context = wasBound ? helpers.getContext(socket, 'account:refresh') : null;
      if (wasBound && !context) {
        helpers.ackError(callback, 'Your room session has changed.');
        return;
      }
      if (context?.player.accountId && context.player.accountId !== account.id) {
        helpers.ackError(callback, 'Sign in with the account that joined this room.');
        return;
      }
      attach(socket, account);
      if (context) {
        context.player.accountId = account.id;
        context.player.name = helpers.sanitizeName(account.name);
        helpers.emitStateToRoom(context.room);
      }
      helpers.ackOk(callback, { expiresAt: account.expires * 1000 });
    });
  }
  return { middleware, register };
}

module.exports = { createAccountSessions };
