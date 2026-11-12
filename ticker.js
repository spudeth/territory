// The server tick (loop 16): every tickSeconds, timed things (factories) are brought up to date.
// The free server sleeps, so time is never assumed to have passed in steps: each tick handles everything from
// the last tick saved in the database (server_ticks) up to now, however long that was. A handler gets
// (fromMs, toMs) and must give the same result for one long span as for many short ones.
//
// Loop 19 (sparing Neon hours): a regular tick is skipped, with no database query at all, while `skip()` says so (the
// game: nobody is connected) or while every handler said it has nothing to do (a handler returns 'idle'). Skipped time
// is never lost: the next tick covers it. wake() ticks at once if ticks were being skipped (someone connected, or a
// handler has work again: a factory was built or woken).
function createTicker(pool, { seconds, name = 'game', skip = () => false } = {}) {
  const handlers = [];
  let running = null, timer = null, idle = false, skipped = false;

  async function tick(now = Date.now()) {
    if (running) return running;   // one tick at a time
    running = (async () => {
      const { rows: [t] } = await pool.query(
        `INSERT INTO server_ticks (name, last_at) VALUES ($1, to_timestamp($2 / 1000.0))
         ON CONFLICT (name) DO UPDATE SET last_at = server_ticks.last_at RETURNING (extract(epoch FROM last_at) * 1000)::float AS last`, [name, now]);
      const from = Math.min(t.last, now);
      let allIdle = handlers.length > 0;
      for (const h of handlers) {
        try { if ((await h(from, now)) !== 'idle') allIdle = false; } catch (err) { allIdle = false; console.error(`TICK FAILED (${h.name || 'handler'}): ${err.message}`); }
      }
      idle = allIdle;
      skipped = false;
      await pool.query('UPDATE server_ticks SET last_at = to_timestamp($2 / 1000.0) WHERE name = $1 AND last_at < to_timestamp($2 / 1000.0)', [name, now]);
      return now - from;
    })().finally(() => { running = null; });
    return running;
  }
  const regular = () => {
    if (idle || skip()) { skipped = true; return; }
    tick().catch(err => console.error(`TICK FAILED: ${err.message}`));
  };

  return {
    on: handler => handlers.push(handler),
    tick,
    // Work again (or someone is watching): tick now if ticks were being skipped.
    wake() {
      const was = skipped || idle;
      idle = false;
      if (was && timer) { skipped = false; tick().catch(err => console.error(`TICK FAILED: ${err.message}`)); }
    },
    // Starts ticking: once now (the catch-up after a sleep or a deploy), then every `seconds`.
    start() {
      if (timer) return;
      tick().catch(err => console.error(`TICK FAILED: ${err.message}`));
      timer = setInterval(regular, seconds * 1000);
      timer.unref?.();
    },
    stop() { clearInterval(timer); timer = null; },
  };
}

module.exports = { createTicker };
