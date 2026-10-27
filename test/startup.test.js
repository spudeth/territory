const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const path = require('path');

test('the server exits instead of starting when the database is unreachable', { timeout: 60000 }, async () => {
  // Port 1 on this machine refuses connections, so every attempt fails fast.
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, DATABASE_URL: 'postgresql://nobody:nothing@127.0.0.1:1/none', PORT: '0' },
  });
  let output = '';
  child.stdout.on('data', d => output += d);
  child.stderr.on('data', d => output += d);
  const code = await new Promise(r => child.on('exit', r));
  assert.equal(code, 1);
  assert.match(output, /Startup failed: database unreachable after 5 attempts/);
  assert.doesNotMatch(output, /Territory running/);
});
