// ---------- Accounts and the menu ----------
// Logins go through /api/auth/* on our own site, which passes them on to Neon's managed Better Auth.
// Loaded after game.js and uses its socket, toast and state. game.js calls loginToken() from here, which is
// fine because the connection only asks for it once the network is open, after this file has run.

// Calls one auth endpoint. Resolves with { data } or { error: message, code }.
async function authApi(path, body) {
  try {
    const res = await fetch('/api/auth/' + path, body === undefined ? {} : {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (res.ok) return { data };
    if (res.status === 429) return { error: 'Too many login attempts right now. Wait a minute and try again.', code: 'RATE_LIMITED' };
    return { error: data?.message || 'Something went wrong. Try again.', code: data?.code };
  } catch {
    return { error: 'Could not reach the server. Check your connection.' };
  }
}

// A fresh login token for the game connection, or null when not logged in (or accounts are off).
async function loginToken() {
  const { data } = await authApi('token');
  return data?.token || null;
}

// The game connection has to start over to pick up a login or logout.
function reconnect() {
  socket.disconnect().connect();
}

// A guest who signs up (or uses Google) from their own profile keeps their blocks. This marks that intent
// for the next connection; the server only honours it for an account that has never played.
const UPGRADE = 'territory-upgrade';
function markUpgrade() {
  if (me && !myAccount) sessionStorage.setItem(UPGRADE, '1');
}

const menu = $('menu');
let email = '';   // the address being signed up / verified

function show(view) {
  for (const v of menu.querySelectorAll('[data-view]')) v.hidden = v.dataset.view !== view;
  menu.hidden = false;
  $('menu-error').textContent = '';
  if (view === 'main') fillMain();
  if (view === 'settings') fillSettings();
  menu.querySelector(`[data-view="${view}"] input`)?.focus();
}
function closeMenu() { menu.hidden = true; }
const fail = msg => { $('menu-error').textContent = msg; };

async function fillMain() {
  $('menu-who').textContent = myAccount ? `Logged in as ${myName}` : me ? `Playing as guest ${myName}` : 'Playing as a visitor';
  $('menu-email').textContent = '';
  $('menu-login').hidden = myAccount || !accountsOn;
  $('menu-logout').hidden = !myAccount;
  $('menu-off').hidden = accountsOn;
  if (myAccount) {
    const { data } = await authApi('get-session');
    $('menu-email').textContent = data?.user?.email || '';
  }
}

function fillSettings() {
  $('name-input').value = myName;
  const can = myAccount;
  $('name-input').disabled = $('name-save').disabled = !can;
  $('name-note').textContent = !can ? 'Create an account to change your name.'
    : renameAt > Date.now() ? `You can change your name again at ${new Date(renameAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
    : 'Up to 15 letters and numbers. You can change it every 10 minutes.';
}

// Runs a form's action with its button disabled, so a double tap doesn't send it twice.
function onSubmit(form, action) {
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    try { await action(new FormData(form)); } finally { button.disabled = false; }
  });
}

function loggedIn() {
  closeMenu();
  reconnect();
}

onSubmit($('form-login'), async f => {
  email = f.get('email').trim();
  const r = await authApi('sign-in/email', { email, password: f.get('password') });
  if (r.code === 'EMAIL_NOT_VERIFIED') { show('verify'); return fail('Check your email for a code to finish setting up your account.'); }
  if (r.error) return fail(r.error);
  toast('Logged in', 'good');
  loggedIn();
});

onSubmit($('form-signup'), async f => {
  email = f.get('email').trim();
  markUpgrade();
  const r = await authApi('sign-up/email', { email, password: f.get('password'), name: 'Player' });
  if (r.error) return fail(r.error);
  show('verify');
});

onSubmit($('form-verify'), async f => {
  const r = await authApi('email-otp/verify-email', { email, otp: f.get('code').trim() });
  if (r.error) return fail(r.error);
  toast('Account ready', 'good');
  loggedIn();
});

$('verify-resend').addEventListener('click', async e => {
  e.preventDefault();
  const r = await authApi('email-otp/send-verification-otp', { email, type: 'email-verification' });
  fail(r.error || 'A new code is on its way.');
});

onSubmit($('form-forgot'), async f => {
  const r = await authApi('request-password-reset', { email: f.get('email').trim(), redirectTo: location.origin + '/?reset=1' });
  if (r.error) return fail(r.error);
  fail('If that email has an account, a reset link is on its way. It works for 15 minutes.');
});

let resetToken = null;
onSubmit($('form-reset'), async f => {
  const r = await authApi('reset-password', { newPassword: f.get('password'), token: resetToken });
  if (r.error) return fail(r.error);
  show('login');
  fail('Password saved. Log in with your new password.');
});

for (const b of menu.querySelectorAll('.google')) {
  b.addEventListener('click', async () => {
    markUpgrade();
    const back = location.origin + '/';
    const r = await authApi('sign-in/social', { provider: 'google', callbackURL: back, errorCallbackURL: back + '?login=failed' });
    if (r.error) return fail(r.error);
    location.href = r.data.url;
  });
}

onSubmit($('form-name'), async f => {
  const r = await new Promise(resolve => socket.timeout(10000).emit('rename', f.get('name'), (err, res) => resolve(err ? { error: 'No answer from the server. Try again.' } : res)));
  if (r.error) return fail(r.error);
  myName = r.name;
  renameAt = r.renameAt;
  updateUI();
  fillSettings();
  toast('Name changed', 'good');
});

$('menu-logout').addEventListener('click', async () => {
  await authApi('sign-out', {});
  closeMenu();
  toast('Logged out', 'good');
  reconnect();
});

$('menu-button').addEventListener('click', () => show('main'));
for (const b of menu.querySelectorAll('[data-go]')) b.addEventListener('click', e => { e.preventDefault(); show(b.dataset.go); });
for (const b of menu.querySelectorAll('.close')) b.addEventListener('click', closeMenu);
menu.addEventListener('click', e => { if (e.target === menu) closeMenu(); });
addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });

// Links from emails and Google bring the player back with something in the address.
{
  const q = new URLSearchParams(location.search);
  if (q.get('reset') && q.get('token')) { resetToken = q.get('token'); show('reset'); }
  else if (q.get('reset') && q.get('error')) { show('forgot'); fail('That reset link has expired. Ask for a new one.'); }
  else if (q.get('login') === 'failed' || q.get('error')) { show('login'); fail('Google sign-in did not finish. Try again.'); }
  if (location.search) history.replaceState(null, '', location.pathname);
}
