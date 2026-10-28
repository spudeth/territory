// ---------- Accounts and the menu ----------
// Logins go through /api/auth/* on our own site, which passes them on to Neon's managed Better Auth.
// Loaded after game.js and menu.js, and uses their socket, state, toast and menu views. game.js calls loginToken() from here, which is
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

let email = '';   // the address being signed up / verified

// ---------- Settings ----------
const clock = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const nameCount = () => { $('name-count').textContent = `${$('name-input').value.length} / 15`; };
$('name-input').addEventListener('input', nameCount);

fills.settings = () => {
  $('name-input').value = myName;
  nameCount();
  const waiting = renameAt > Date.now();
  $('name-input').disabled = $('name-save').disabled = !myAccount || waiting;
  $('name-note').textContent = !myAccount ? 'Create an account to pick your own name.'
    : waiting ? `You changed your name recently. You can change it again at ${clock(renameAt)}.`
    : 'Letters, numbers, spaces and - _ . only. Names are unique. You can change it every 10 minutes.';

  // This map's choices: locked after the first claim here, until a wipe.
  $('look-title').textContent = `THIS MAP · ${(mapInfo?.name ?? '').toUpperCase()}`;
  $('look-color').style.background = myColor;
  $('look-lock').hidden = !locked;
  $('look-text').textContent = locked ? lookText() : 'Not chosen yet: you pick them before your first block here';
  const blocks = myBlocks();
  $('wipe-open').disabled = !blocks;
  $('wipe-note').textContent = blocks ? 'Clears your territory here so you can start fresh with a new color, skin and coverage.'
    : 'You have no blocks here to wipe.';
  $('menu-logout').hidden = !myAccount;
};
fills.signup = () => { $('signup-keep').hidden = !me; };

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
  const r = await ask('rename', f.get('name'));
  if (r.error) return fail(r.error);
  myName = r.name;
  renameAt = r.renameAt;
  updateUI();
  fills.settings();
  toast('Name changed', 'good');
});

$('menu-logout').addEventListener('click', async () => {
  await authApi('sign-out', {});
  closeMenu();
  toast('Logged out', 'good');
  reconnect();
});

// Links from emails and Google bring the player back with something in the address.
{
  const q = new URLSearchParams(location.search);
  if (q.get('reset') && q.get('token')) { resetToken = q.get('token'); show('reset'); }
  else if (q.get('reset') && q.get('error')) { show('forgot'); fail('That reset link has expired. Ask for a new one.'); }
  else if (q.get('login') === 'failed' || q.get('error')) { show('login'); fail('Google sign-in did not finish. Try again.'); }
  if (location.search) history.replaceState(null, '', location.pathname);
}
