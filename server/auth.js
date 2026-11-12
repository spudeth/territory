// Accounts, through Neon's managed Better Auth. The browser talks to /api/auth/* on our own site and we pass
// those requests on to Neon, so the login cookie belongs to our domain (no third-party cookies), using Neon's
// own server toolkit (the same code its Next.js adapter is built on).
// When a game connection starts, the browser sends a short-lived login token (a JWT signed by Neon), which we check here.
const express = require('express');
const { createRemoteJWKSet, jwtVerify } = require('jose');
const { handleAuthProxyRequest, processAuthMiddleware } = require('@neondatabase/auth/server');

const VERIFIER_PARAM = 'neon_auth_session_verifier';   // added to the page address when Google sign-in returns

// Turns an Express request into the standard Request the toolkit expects.
function toFetchRequest(req) {
  const url = new URL(req.originalUrl, `${req.protocol}://${req.get('host')}`);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  const hasBody = Buffer.isBuffer(req.body) && req.body.length > 0;
  return new Request(url, { method: req.method, headers, body: hasBody ? req.body : undefined, duplex: hasBody ? 'half' : undefined });
}

// Copies a toolkit Response back out, keeping each Set-Cookie separate.
async function sendFetchResponse(res, response) {
  res.status(response.status);
  for (const [k, v] of response.headers) if (k !== 'set-cookie') res.setHeader(k, v);
  res.setHeader('set-cookie', response.headers.getSetCookie());
  res.send(Buffer.from(await response.arrayBuffer()));
}

// Returns null when accounts aren't set up (NEON_AUTH_BASE_URL missing); the game then runs with guests only.
//   baseUrl:      the branch's Auth URL from Neon
//   cookieSecret: 32+ random characters, for the session cache cookie the toolkit signs
function createAuth({ baseUrl, cookieSecret }) {
  if (!baseUrl) return null;
  if (!cookieSecret || cookieSecret.length < 32) throw new Error('NEON_AUTH_COOKIE_SECRET must be at least 32 characters');
  const proxy = { baseUrl, cookieSecret };
  const jwks = createRemoteJWKSet(new URL(baseUrl + '/.well-known/jwks.json'));
  const issuer = new URL(baseUrl).origin;

  const router = express.Router();
  // Bodies are passed on to Neon exactly as sent.
  router.use('/api/auth', express.raw({ type: () => true, limit: '20kb' }), (req, res, next) => {
    handleAuthProxyRequest({ ...proxy, request: toFetchRequest(req), path: req.path.slice(1) })
      .then(r => sendFetchResponse(res, r)).catch(next);
  });

  // Google sign-in ends by sending the player back to the game with a one-time code in the address. Swap it for
  // the login cookie, then reload the page without it.
  router.get('/', (req, res, next) => {
    if (!(VERIFIER_PARAM in req.query)) return next();
    processAuthMiddleware({ ...proxy, request: toFetchRequest(req), pathname: req.path, skipRoutes: [req.path], loginUrl: '/login' })
      .then(result => {
        if (result.cookies?.length) res.append('set-cookie', result.cookies);
        if (result.action === 'redirect_oauth') return res.redirect(302, result.redirectUrl.pathname + result.redirectUrl.search);
        next();
      }).catch(next);
  });

  // The account id ("sub") of a valid login token, or null.
  async function verify(token) {
    if (typeof token !== 'string' || !token || token.length > 4096) return null;
    try {
      const { payload } = await jwtVerify(token, jwks, { issuer, audience: issuer });
      return typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
    } catch {
      return null;
    }
  }

  return { router, verify };
}

module.exports = { createAuth };
