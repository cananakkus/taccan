module.exports = function register(socket, deps) {
  const { metrics, helpers } = deps;
  const { logEvent, markDisconnected } = helpers;

  socket.on('disconnect', () => {
    metrics.disconnect += 1;
    logEvent('socket_disconnected', { socketId: socket.id });
    markDisconnected(socket);
  });
};
