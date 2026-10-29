// Admin commands over HTTP, for npm run admin (scripts/admin.js). Mounted at /admin by app.js.
// Every request needs the secret ADMIN_KEY. Commands run inside the live game, so players see the result at
// once (a wiped map clears, a banned player is disconnected). The command line asks for a preview first, then
// a backup (/admin/backup), then runs the command with that backup's token: the server refuses a destructive
// command without a backup taken in the last 10 minutes. Everything is written to admin_log.
const crypto = require('crypto');
const express = require('express');
const store = require('./store');
const rules = require('./rules');
const { dumpTables, restoreTables } = require('./db');
const { COMMANDS } = require('./admin-spec');
const { isProfane } = require('./profanity');

class Refusal extends Error {}   // a problem to tell the admin about (no such player, too few squares…)
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const BACKUP_MS = 10 * 60 * 1000;

// hooks: what the live game does for admin commands (from app.js): kick, wipePlayer, wipeMap, reloadMaps,
// squaresChanged, reloadAll.
function adminRouter({ pool, key, production, hooks }) {
  const router = express.Router();
  router.use(express.json({ limit: '200mb' }));   // a restore uploads a whole backup
  const backups = new Map();                       // backup token -> when it was taken

  // The key, and the right server: production only with --prod, and --prod only on production.
  router.use(async (req, res, next) => {
    const ip = req.ip;
    if (!key) return res.status(503).json({ error: 'Admin commands are off on this server: ADMIN_KEY is not set.' });
    const given = Buffer.from(String(req.get('authorization') || '').replace(/^Bearer /, ''));
    const want = Buffer.from(key);
    if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
      console.warn(`ADMIN REFUSED: wrong or missing key from ${ip} (${req.path})`);
      await store.logAdmin(pool, { command: req.body?.command ?? req.path.slice(1), ok: false, result: 'refused: wrong or missing key', ip })
        .catch(() => {});
      await new Promise(r => setTimeout(r, 500));   // slows down guessing
      return res.status(401).json({ error: 'Wrong admin key. Check ADMIN_KEY in .env.admin (and in Render for production).' });
    }
    const wantsProduction = req.get('x-admin-target') === 'prod';
    if (wantsProduction !== production) {
      return res.status(400).json({ error: production ? 'This is the production server: add --prod to run commands here.'
        : 'This is not the production server: leave out --prod.' });
    }
    next();
  });

  router.post('/backup', async (req, res) => {
    const tables = await dumpTables(pool);
    const token = crypto.randomUUID();
    backups.set(token, Date.now());
    await store.logAdmin(pool, { command: 'backup', ok: true, result: 'backup taken', ip: req.ip });
    res.json({ token, takenAt: new Date().toISOString(), tables });
  });

  // { command, args: [...], options: {...} } -> { lines: [...], confirm: 'word to type' | null }
  router.post('/preview', (req, res) => handle(req, res, false));
  // the same plus backupToken for destructive commands -> { lines }
  router.post('/run', (req, res) => handle(req, res, true));

  async function handle(req, res, run) {
    const { command, args = [], options = {}, backupToken, tables } = req.body ?? {};
    const spec = COMMANDS[command], impl = IMPL[command];
    if (!spec || !impl) return res.status(400).json({ error: `Unknown command "${command}". Try: npm run admin -- help` });
    let target = null;
    try {
      if (!Array.isArray(args) || args.length < spec.args.length) throw new Refusal(`Usage: ${spec.example}`);
      for (const k of Object.keys(options)) if (!(k in (spec.options ?? {}))) throw new Refusal(`${command} has no --${k} option`);
      const ctx = await impl.prepare({ args, options, tables });
      target = ctx.target ?? null;
      if (!run) return res.json({ lines: ctx.preview ?? [], confirm: spec.kind === 'destructive' ? ctx.confirm : null });
      if (spec.kind === 'destructive') {
        const at = backups.get(backupToken);
        backups.delete(backupToken);
        if (!at || Date.now() - at > BACKUP_MS) throw new Refusal('No backup was taken first: destructive commands need one (the command line takes it for you).');
      }
      const lines = await impl.run(ctx);
      if (spec.kind !== 'read') {
        await store.logAdmin(pool, { command, target, args: { args, options }, ok: true, result: lines.join(' | '), ip: req.ip });
      }
      res.json({ lines });
    } catch (err) {
      const known = err instanceof Refusal;
      if (!known) console.error(`ADMIN ${command} FAILED: ${err.stack}`);
      if (run && spec.kind !== 'read') {
        await store.logAdmin(pool, { command, target, args: { args, options }, ok: false, result: err.message, ip: req.ip }).catch(() => {});
      }
      res.status(known ? 400 : 500).json({ error: known ? err.message : `Something went wrong: ${err.message}` });
    }
  }

  // ---------- The commands: prepare (find things, build the preview) and run ----------
  async function player(ref) {
    const p = await store.findPlayer(pool, String(ref));
    if (!p) throw new Refusal(`No player called "${ref}". Names ignore capitals; you can also use an id like #12.`);
    return p;
  }
  async function map(ref) {
    const m = await store.findMap(pool, String(ref));
    if (!m) throw new Refusal(`No map called "${ref}".`);
    return m;
  }
  const amount = raw => {
    const n = Number(raw);
    if (!(n > 0) || n > 1e9) throw new Refusal(`"${raw}" isn't an amount of squares (a number above 0)`);
    return n;
  };
  const blocksOn = async (mapId, pid) => (await pool.query(
    'SELECT count(*)::int AS n FROM map_cells WHERE map_id = $1 AND owner_id = $2', [mapId, pid])).rows[0].n;
  const sizeOption = options => options['reset-size'] ? { width: rules.NEW_MAP_WIDTH, height: rules.NEW_MAP_HEIGHT } : null;

  const IMPL = {
    help: { prepare: () => ({}), run: () => Object.entries(COMMANDS).map(([n, c]) => `${n}: ${c.about}`) },

    player: {
      async prepare({ args }) { return { p: await player(args[0]) }; },
      async run({ p }) {
        const i = await store.playerInfo(pool, p.id), q = i.player;
        const ban = await store.activeBan(pool, [q.id]);
        return [
          `${q.name} (#${q.id})${q.deleted_at ? ' — DELETED account' : ''}`,
          q.auth_user_id ? `Account${i.email ? `: ${i.email}` : ''}` : 'Guest (no account)',
          `Joined: ${new Date(q.created_at).toISOString().slice(0, 16).replace('T', ' ')} UTC`,
          `Linked profiles: ${i.linked.length ? i.linked.map(l => `${l.name} (#${l.id})`).join(', ') : 'none'}`,
          `Squares: ${Number(q.squares).toLocaleString('en-US', { maximumFractionDigits: 6 })}`,
          `Upgrades: Click Power ${q.click_power}, Defense ${q.defense}, Earnings ${q.earnings}, Growth ${q.growth}`,
          `Blocks: ${i.blocks.length ? i.blocks.map(b => `${b.name} ${b.blocks}`).join(', ') : 'none'}`,
          `Achievements: ${i.achievements.length ? i.achievements.join(', ') : 'none'}`,
          `Ban: ${ban ? `BANNED ${ban.until ? `until ${new Date(ban.until).toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'permanently'}${ban.reason ? ` (${ban.reason})` : ''}` : 'not banned'}`,
        ];
      },
    },

    'bad-names': {
      async prepare() { return {}; },
      async run() {
        const { rows } = await pool.query("SELECT id, name, auth_user_id IS NOT NULL AS account FROM players WHERE deleted_at IS NULL ORDER BY id");
        const bad = rows.filter(p => isProfane(p.name));
        return bad.length
          ? [`${plural(bad.length, 'name')} the filter blocks now (of ${rows.length.toLocaleString()}):`,
            ...bad.map(p => `  ${p.name} (#${p.id}, ${p.account ? 'account' : 'guest'})`)]
          : [`No blocked names among ${plural(rows.length, 'player')}.`];
      },
    },

    map: {
      async prepare({ args }) { return { m: await map(args[0]) }; },
      async run({ m }) {
        const i = await store.mapInfo(pool, m.id);
        return [
          `${m.name} (#${m.id}), ${m.style}, ${m.type}`,
          `Size: ${i.blocks.toLocaleString()} blocks, spanning ${i.x1 - i.x0 + 1} x ${i.y1 - i.y0 + 1}`,
          `Claimed: ${i.claimed.toLocaleString()} blocks by ${plural(i.players, 'player')}`,
          `Top: ${i.top.length ? i.top.map((t, n) => `${n + 1}. ${t.name} ${t.blocks}`).join(', ') : 'nobody yet'}`,
        ];
      },
    },

    kick: {
      async prepare({ args }) {
        const p = await player(args[0]);
        return { p, target: `player ${p.name}`, preview: [`Disconnect ${p.name} (#${p.id}) now. They can come straight back.`] };
      },
      async run({ p }) {
        const n = hooks.kick([p.id], 'kicked', 'You were disconnected by an admin. Reload the page to keep playing.');
        return [`Disconnected ${p.name}: ${plural(n, 'connection')} closed.`];
      },
    },

    'give-squares': {
      async prepare({ args, options }) {
        const p = await player(args[0]), n = amount(args[1]);
        return { p, n, reason: options.reason, target: `player ${p.name}`,
          preview: [`Give ${p.name} ${n.toLocaleString()} squares: ${Number(p.squares)} -> ${Number(p.squares) + n}.`] };
      },
      async run({ p, n, reason }) {
        const r = await store.adjustSquares(pool, p.id, n, `admin give${reason ? `: ${reason}` : ''}`);
        hooks.squaresChanged(p.id, r.squares);
        return [`${p.name} now has ${r.squares.toLocaleString('en-US', { maximumFractionDigits: 6 })} squares.`];
      },
    },

    'take-squares': {
      async prepare({ args, options }) {
        const p = await player(args[0]), n = amount(args[1]), have = Number(p.squares);
        if (n > have) throw new Refusal(`${p.name} has only ${have} squares.`);
        return { p, n, reason: options.reason, target: `player ${p.name}`, confirm: p.name,
          preview: [`Take ${n.toLocaleString()} squares from ${p.name}: ${have} -> ${have - n}.`] };
      },
      async run({ p, n, reason }) {
        const r = await store.adjustSquares(pool, p.id, -n, `admin take${reason ? `: ${reason}` : ''}`);
        if (r.error) throw new Refusal(r.error);
        hooks.squaresChanged(p.id, r.squares);
        return [`${p.name} now has ${r.squares.toLocaleString('en-US', { maximumFractionDigits: 6 })} squares.`];
      },
    },

    'wipe-player': {
      async prepare({ args }) {
        const p = await player(args[0]), m = await map(args[1]), n = await blocksOn(m.id, p.id);
        if (!n) throw new Refusal(`${p.name} has no blocks on ${m.name}.`);
        return { p, m, target: `player ${p.name} on map ${m.name}`, confirm: p.name,
          preview: [`Clear all ${plural(n, 'block')} ${p.name} owns on ${m.name}.`,
            `Their wipe floor there becomes at least ${n}, and their color, skin and coverage there unlock.`] };
      },
      async run({ p, m }) {
        const r = await hooks.wipePlayer(m.id, p.id);
        if (!r) throw new Refusal(`${p.name} has no blocks on ${m.name} any more.`);
        return [`Cleared ${plural(r.cells.length, 'block')} of ${p.name}'s on ${m.name}. Their wipe floor there is ${r.floor}.`];
      },
    },

    'wipe-map': {
      async prepare({ args, options }) {
        const m = await map(args[0]), i = await store.mapInfo(pool, m.id), size = sizeOption(options);
        return { maps: [m], size, target: `map ${m.name}`, confirm: m.name, preview: [
          `Empty all ${i.claimed.toLocaleString()} claimed blocks on ${m.name}, owned by ${plural(i.players, 'player')}${i.top.length ? ` (most: ${i.top.map(t => `${t.name} ${t.blocks}`).join(', ')})` : ''}.`,
          size ? `Reset ${m.name} to a fresh ${size.width} x ${size.height} map (now ${i.blocks.toLocaleString()} blocks).` : `The map keeps its size (${i.blocks.toLocaleString()} blocks).`,
          `Everyone's wipe floor there goes back to 0, and their color, skin and coverage there unlock.`,
          'Squares, upgrades, achievements and accounts are not touched.',
        ] };
      },
      run: wipeMaps,
    },

    'wipe-all-maps': {
      async prepare({ options }) {
        const { rows: maps } = await pool.query('SELECT id, name FROM maps ORDER BY id');
        const size = sizeOption(options), preview = [];
        for (const m of maps) {
          const i = await store.mapInfo(pool, m.id);
          preview.push(`${m.name}: empty ${i.claimed.toLocaleString()} claimed blocks (${plural(i.players, 'player')})${size ? `, reset to ${size.width} x ${size.height}` : ''}.`);
        }
        preview.push(`Everyone's wipe floors go back to 0 and their looks unlock, on all ${plural(maps.length, 'map')}.`,
          'Squares, upgrades, achievements and accounts are not touched.');
        return { maps, size, target: 'all maps', confirm: 'ALL MAPS', preview };
      },
      run: wipeMaps,
    },

    ban: {
      async prepare({ args, options }) {
        const p = await player(args[0]);
        const days = options.days === undefined ? null : Number(options.days);
        if (days !== null && !(days > 0)) throw new Refusal(`--days needs a number of days above 0, not "${options.days}"`);
        const linked = await store.linkedPlayers(pool, p.id);
        const names = linked.length ? (await pool.query('SELECT id, name FROM players WHERE id = ANY($1::bigint[])', [linked])).rows : [];
        const until = days ? new Date(Date.now() + days * 86400000) : null;
        const blocks = options['wipe-blocks'] ? (await pool.query(
          'SELECT count(*)::int AS n FROM map_cells WHERE owner_id = ANY($1::bigint[])', [[p.id, ...linked]])).rows[0].n : 0;
        return { p, ids: [p.id, ...linked], until, reason: options.reason ?? null, wipe: !!options['wipe-blocks'],
          target: `player ${p.name}`, confirm: p.name, preview: [
            `Ban ${p.name} (#${p.id}) ${until ? `for ${plural(days, 'day')}, until ${until.toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'permanently'}.`,
            `Also banned, as linked profiles: ${names.length ? names.map(n => `${n.name} (#${n.id})`).join(', ') : 'none'}.`,
            `They are disconnected now and see "You've been banned"${options.reason ? ` with the reason "${options.reason}"` : ''}.`,
            options['wipe-blocks'] ? `Their ${plural(blocks, 'block')} on every map are cleared.` : 'Their blocks stay (add --wipe-blocks to clear them).',
          ] };
      },
      async run({ p, ids, until, reason, wipe }) {
        await store.banPlayers(pool, ids, reason, until);
        const n = hooks.kick(ids, 'banned', bannedMessage({ reason, until }));
        let cleared = 0;
        if (wipe) {
          const { rows } = await pool.query('SELECT DISTINCT map_id, owner_id FROM map_cells WHERE owner_id = ANY($1::bigint[])', [ids]);
          for (const r of rows) cleared += (await hooks.wipePlayer(r.map_id, r.owner_id))?.cells.length ?? 0;
        }
        return [`Banned ${p.name}${ids.length > 1 ? ` and ${plural(ids.length - 1, 'linked profile')}` : ''}; ${plural(n, 'connection')} closed${wipe ? `; ${plural(cleared, 'block')} cleared` : ''}.`];
      },
    },

    unban: {
      async prepare({ args }) {
        const p = await player(args[0]), ids = [p.id, ...await store.linkedPlayers(pool, p.id)];
        const ban = await store.activeBan(pool, ids);
        if (!ban) throw new Refusal(`${p.name} isn't banned.`);
        return { p, ids, target: `player ${p.name}`, preview: [`Lift the ban on ${p.name}${ids.length > 1 ? ` and ${plural(ids.length - 1, 'linked profile')}` : ''}.`] };
      },
      async run({ p, ids }) {
        const n = await store.unbanPlayers(pool, ids);
        return [`Unbanned ${p.name} (${plural(n, 'ban')} lifted). They can play again.`];
      },
    },

    'delete-account': {
      async prepare({ args }) {
        const p = await player(args[0]);
        if (p.deleted_at) throw new Refusal(`${p.name} is already deleted.`);
        const i = await store.playerInfo(pool, p.id);
        return { p, target: `player ${p.name}`, confirm: p.name, preview: [
          `Delete ${p.name} (#${p.id}) for good${i.email ? `, account ${i.email}` : ' (a guest)'}.`,
          `Their blocks go empty: ${i.blocks.length ? i.blocks.map(b => `${b.name} ${b.blocks}`).join(', ') : 'none'}.`,
          'Erased: their login and email (Neon Auth too), name, devices, settings, stats, achievements, skins and bans. Their name becomes free.',
          `Kept, anonymous: the squares ledger (their ${Number(p.squares)} squares are written off).`,
        ] };
      },
      async run({ p }) {
        hooks.kick([p.id], 'deleted', 'This account has been deleted.');
        const r = await store.deleteAccount(pool, p.id);
        await hooks.reloadMaps(r.maps);
        return [`Deleted ${p.name}. Their blocks are empty on ${plural(r.maps.length, 'map')}; ${r.authDeleted ? 'their login was erased from Neon Auth' : 'there was no Neon Auth login to erase'}. The name "${p.name}" is free.`];
      },
    },

    'create-map': {
      async prepare({ options }) {
        const spec = { name: options.name, style: options.style ?? 'grass',
          width: Number(options.width ?? rules.NEW_MAP_WIDTH), height: Number(options.height ?? rules.NEW_MAP_HEIGHT) };
        if (!spec.name || spec.name === true) throw new Refusal('Give the map a name: --name Snowfield');
        if (await store.findMap(pool, spec.name)) throw new Refusal(`There's already a map called "${spec.name}".`);
        return { spec, target: `map ${spec.name}`, preview: [`Make a new ${spec.style} map "${spec.name}", ${spec.width} x ${spec.height} blocks. Players can switch to it straight away.`] };
      },
      async run({ spec }) {
        try {
          const id = await store.createMap(pool, spec);
          return [`Made map "${spec.name}" (#${id}).`];
        } catch (err) {
          throw /must|needs/.test(err.message) ? new Refusal(err.message) : err;
        }
      },
    },

    restore: {
      async prepare({ tables }) {
        if (!tables || typeof tables !== 'object') throw new Refusal('That file has no tables in it: is it a backup made by npm run admin -- backup?');
        const now = await dumpTables(pool);
        const lines = Object.keys(now).filter(t => t !== 'schema_migrations')
          .map(t => `${t}: ${now[t].length} rows now -> ${(tables[t] ?? []).length} in the backup`);
        return { tables, target: 'the whole game', confirm: 'RESTORE',
          preview: ['Replace everything in the game with the backup:', ...lines, 'Everyone is disconnected and reconnects to the restored game.'] };
      },
      async run({ tables }) {
        let counts;
        try { counts = await restoreTables(pool, tables); } catch (err) {
          throw /different version/.test(err.message) ? new Refusal(err.message) : err;
        }
        hooks.reloadAll();
        return [`Restored ${Object.values(counts).reduce((a, b) => a + b, 0).toLocaleString()} rows in ${plural(Object.keys(counts).length, 'table')}. Everyone was disconnected and will see the restored game when they reload.`];
      },
    },
  };

  async function wipeMaps({ maps, size }) {
    const lines = [];
    for (const m of maps) {
      const r = await hooks.wipeMap(m.id, size);
      lines.push(`${m.name}: emptied ${r.cleared.toLocaleString()} blocks of ${plural(r.players, 'player')}; the map has ${r.blocks.toLocaleString()} blocks.`);
    }
    return lines;
  }

  return router;
}

// What a banned player sees.
function bannedMessage({ reason, until }) {
  return `You've been banned${until ? ` until ${new Date(until).toUTCString().replace(' GMT', ' UTC')}` : ''}.${reason ? ` Reason: ${reason}` : ''}`;
}

module.exports = { adminRouter, bannedMessage };
