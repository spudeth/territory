// A test plug-in (loop 19): its part of the welcome, one socket event, and its data.json.
module.exports = api => {
  api.on('welcome', (map, pid) => ({ greeting: `hello from ${api.plugin.name}`, mapId: map.id, pid, size: api.variables['hello.size'], data: api.plugin.data }));
  api.socket('ping', (ctx, n, reply) => reply({ pong: n + 1, pid: ctx.me.pid }));
};
