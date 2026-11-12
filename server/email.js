// The email updates list (loop 15): Resend, through its HTTP API. Xoren sends the updates from Resend's dashboard to
// the Audience this keeps in sync; the game itself sends only the admin test email.
// Needs RESEND_API_KEY, RESEND_AUDIENCE_ID and RESEND_FROM (e.g. "Territory <updates@territory.sarl>"); without
// them nothing is sent or synced (logged once). Nothing is ever sent while the Game Rules mailingAddress is blank.
const rules = require('./rules');

function createEmail({ key = process.env.RESEND_API_KEY, audience = process.env.RESEND_AUDIENCE_ID, from = process.env.RESEND_FROM,
  publicUrl = process.env.PUBLIC_URL || 'https://territory.sarl', fetchFn = globalThis.fetch } = {}) {
  let warned = false;
  const ready = () => {
    if (key && audience) return true;
    if (!warned) { warned = true; console.log('Email list: RESEND_API_KEY / RESEND_AUDIENCE_ID not set, so the Resend Audience is not synced.'); }
    return false;
  };
  const api = (method, path, body) => fetchFn('https://api.resend.com' + path, {
    method, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body) })
    .then(async r => { if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`); return r.json().catch(() => ({})); });

  return {
    unsubscribeUrl: token => `${publicUrl.replace(/\/$/, '')}/unsubscribe?t=${encodeURIComponent(token)}`,
    // Joining or leaving the list: the contact in the Resend Audience follows.
    async sync(address, subscribed) {
      if (!address || !ready()) return false;
      await api('POST', `/audiences/${audience}/contacts`, { email: address, unsubscribed: !subscribed })
        .catch(() => api('PATCH', `/audiences/${audience}/contacts/${encodeURIComponent(address)}`, { unsubscribed: !subscribed }));
      return true;
    },
    // One email, with the footer the law needs: the mailing address and a one-click unsubscribe link.
    async send(to, subject, text, token) {
      const address = String(rules.MAILING_ADDRESS ?? '').trim();
      if (!address) throw new Error('mailingAddress on the Game Rules tab is blank: no email can be sent until it is filled in');
      if (!key || !from) throw new Error('RESEND_API_KEY and RESEND_FROM are not set on this server');
      const footer = `\n\n--\nTerritory · ${address}\nUnsubscribe: ${token ? this.unsubscribeUrl(token) : '(this is a test; real updates carry your own link)'}`;
      return api('POST', '/emails', { from, to, subject, text: text + footer,
        headers: token ? { 'List-Unsubscribe': `<${this.unsubscribeUrl(token)}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : undefined });
    },
  };
}

module.exports = { createEmail };
