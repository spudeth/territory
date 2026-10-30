// npm run admin -- <command> [words] [--options]: runs an admin command through the live game server.
//   npm run admin -- help                       every command, in plain English (ADMIN.md has more)
//   npm run admin -- wipe-map Grass             the dev server (http://localhost:3030 unless ADMIN_DEV_URL says otherwise)
//   npm run admin -- wipe-map Grass --prod      the live game (https://territory.sarl unless ADMIN_PROD_URL says otherwise)
//   --yes skips typing the name to confirm; never the backup or the log.
// The key comes from .env.admin (ADMIN_KEY=…), which git ignores. The server must have the same ADMIN_KEY.
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { COMMANDS } = require('../admin-spec');

const ROOT = path.join(__dirname, '..');

// Splits the words after the command into its arguments and --options. Flags (true) take no value.
function parse(argv) {
  const [command, ...rest] = argv;
  const spec = COMMANDS[command];
  const args = [], options = {}, flags = { prod: false, yes: false };
  for (let i = 0; i < rest.length; i++) {
    const w = rest[i];
    if (!w.startsWith('--')) { args.push(w); continue; }
    const name = w.slice(2);
    if (name === 'prod' || name === 'yes') { flags[name] = true; continue; }
    const kind = spec?.options?.[name];
    if (kind === true) options[name] = true;
    else if (kind === 'value') options[name] = rest[++i];
    else throw new Error(`${command} has no --${name} option. Try: npm run admin -- help`);
  }
  return { command, spec, args, options, ...flags };
}

// Where commands go: dev unless --prod.
function target(env, prod) {
  return prod ? { name: 'prod', url: (env.ADMIN_PROD_URL || 'https://territory.sarl').replace(/\/$/, '') }
    : { name: 'dev', url: (env.ADMIN_DEV_URL || 'http://localhost:3030').replace(/\/$/, '') };
}

// io: { env, print(line), ask(question) -> answer, backupsDir }. Returns an exit code.
async function main(argv, io) {
  const { env, print } = io;
  let p;
  try { p = parse(argv); } catch (err) { print(err.message); return 1; }
  if (!p.command || p.command === 'help' || !p.spec) {
    if (p.command && p.command !== 'help') print(`Unknown command "${p.command}".\n`);
    print('Admin commands: npm run admin -- <command>   (add --prod for the live game)\n');
    for (const [name, c] of Object.entries(COMMANDS)) {
      print(`  ${name}${c.kind === 'destructive' ? '  [asks you to confirm, backs up first]' : ''}`);
      print(`      ${c.about}`);
      print(`      e.g. npm run admin -- ${c.example}\n`);
    }
    return p.command && p.command !== 'help' ? 1 : 0;
  }
  if (!env.ADMIN_KEY) { print('No ADMIN_KEY: put ADMIN_KEY=… in the .env.admin file (see ADMIN.md, one-time setup).'); return 1; }
  const where = target(env, p.prod);
  print(`[${where.name === 'prod' ? 'PRODUCTION: the live game' : 'dev'} — ${where.url}]`);

  const call = async (route, body = {}) => {
    let res;
    try {
      res = await fetch(`${where.url}/admin/${route}`, { method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${env.ADMIN_KEY}`, 'x-admin-target': where.name },
        body: JSON.stringify(body) });
    } catch {
      throw new Error(`Could not reach ${where.url}. ${where.name === 'dev' ? 'Is the dev server running (npm start)?' : 'Is the site up?'}`);
    }
    const data = await res.json().catch(() => ({ error: `The server answered ${res.status} without details.` }));
    if (!res.ok) throw new Error(data.error);
    return data;
  };
  const saveBackup = async label => {
    const b = await call('backup');
    const dir = io.backupsDir ?? path.join(ROOT, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${where.name}-${b.takenAt.replace(/[:.]/g, '-')}${label ? '-before-' + label : ''}.json`);
    fs.writeFileSync(file, JSON.stringify({ branch: where.name, takenAt: b.takenAt, tables: b.tables }));
    print(`Backup saved: ${path.relative(process.cwd(), file)} (${Object.values(b.tables).reduce((n, t) => n + t.length, 0).toLocaleString()} rows)`);
    return b.token;
  };

  try {
    if (p.command === 'backup') { await saveBackup(''); return 0; }
    const body = { command: p.command, args: p.args, options: p.options };
    if (p.command === 'restore') {
      const file = p.args[0];
      if (!file || !fs.existsSync(file)) { print(`No backup file at "${file}".`); return 1; }
      body.tables = JSON.parse(fs.readFileSync(file, 'utf8')).tables;
    }
    if (p.spec.kind === 'read') {
      const r = await call('run', body);
      for (const line of r.lines) print(line);
      if (r.file) {   // e.g. email-list's CSV
        const dir = io.exportsDir ?? path.join(ROOT, 'exports');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, r.file.name), r.file.content);
        print(`Saved ${path.relative(process.cwd(), path.join(dir, r.file.name))}`);
      }
      return 0;
    }

    // A preview of exactly what will change, then a confirmation.
    const preview = await call('preview', body);
    print('This will:');
    for (const line of preview.lines) print('  ' + line);
    if (!p.yes) {
      if (p.spec.kind === 'destructive') {
        const typed = await io.ask(`Type ${preview.confirm} to go ahead (anything else stops): `);
        if (typed.trim() !== preview.confirm) { print('Stopped. Nothing was changed.'); return 1; }
      } else {
        const ok = await io.ask('Go ahead? (y/N) ');
        if (!/^y(es)?$/i.test(ok.trim())) { print('Stopped. Nothing was changed.'); return 1; }
      }
    }
    if (p.spec.kind === 'destructive') body.backupToken = await saveBackup(p.command);
    for (const line of (await call('run', body)).lines) print(line);
    return 0;
  } catch (err) {
    print(`Refused: ${err.message}`);
    return 1;
  }
}

module.exports = { main, parse, target };

if (require.main === module) {
  const env = { ...process.env };
  try {
    for (const line of fs.readFileSync(path.join(ROOT, '.env.admin'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
    }
  } catch {}
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = q => new Promise(resolve => rl.question(q, resolve));
  main(process.argv.slice(2), { env, print: line => console.log(line), ask })
    .then(code => { rl.close(); process.exitCode = code; });
}
