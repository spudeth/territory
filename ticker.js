// The server tick (loop 16): every tickSeconds, timed things (factories, item timers) are brought up to date.
// The free server sleeps, so time is never assumed to have passed in steps: each tick handles everything from
// the last tick saved in the database (server_ticks) up to now, however long that was. A handler gets
// (fromMs, toMs) and must give the same result for one long span as for many short ones.
function createTicker(pool, { seconds, name = 'game' } = {}) {
  const handlers = [];
  let running = null, timer = null;

  async function tick(now = Date.now()) {
    if (running) return running;   // one tick at a time
    running = (async () => {
      const { rows: [t] } = await pool.query(
        `INSERT INTO server_ticks (name, last_at) VALUES ($1, to_timestamp($2 / 1000.0))
         ON CONFLICT (name) DO UPDATE SET last_at = server_ticks.last_at RETURNING (extract(epoch FROM last_at) * 1000)::float AS last`, [name, now]);
      const from = Math.min(t.last, now);
      for (const h of handlers) {
        try { await h(from, now); } catch (err) { console.error(`TICK FAILED (${h.name || 'handler'}): ${err.message}`); }
      }
      await pool.query('UPDATE server_ticks SET last_at = to_timestamp($2 / 1000.0) WHERE name = $1 AND last_at < to_timestamp($2 / 1000.0)', [name, now]);
      return now - from;
    })().finally(() => { running = null; });
    return running;
  }

  return {
    on: handler => handlers.push(handler),
    tick,
    // Starts ticking: once now (the catch-up after a sleep or a deploy), then every `seconds`.
    start() {
      if (timer) return;
      tick().catch(err => console.error(`TICK FAILED: ${err.message}`));
      timer = setInterval(() => tick().catch(err => console.error(`TICK FAILED: ${err.message}`)), seconds * 1000);
      timer.unref?.();
    },
    stop() { clearInterval(timer); timer = null; },
  };
}

module.exports = { createTicker };
