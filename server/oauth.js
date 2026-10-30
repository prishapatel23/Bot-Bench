// Sign in with Google, GitHub and Apple: the OAuth authorization code flow, by hand.
// A provider is switched on by setting its environment variables (see README).

import { createHash, sign } from 'node:crypto';
import { query } from './db.js';
import { fail } from './http.js';

const env = name => process.env[name] || '';

// The ID token comes straight from the provider's token endpoint over TLS, so its
// signature doesn't need checking (OpenID Connect Core 3.1.3.7). Issuer and audience still do.
function idClaims(token, issuers, audience) {
  let claims;
  try { claims = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8')); } catch { claims = null; }
  if (!claims || !issuers.includes(claims.iss) || claims.aud !== audience) fail(502, 'The sign-in answer could not be checked.');
  return claims;
}

async function getJson(url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) fail(502, 'The sign-in service did not answer properly.');
  return res.json();
}

// Apple wants the client secret as a short-lived JWT signed with your .p8 key
function appleSecret() {
  const now = Math.floor(Date.now() / 1000);
  const part = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const body = `${part({ alg: 'ES256', kid: env('APPLE_KEY_ID') })}.${part({
    iss: env('APPLE_TEAM_ID'), iat: now, exp: now + 300, aud: 'https://appleid.apple.com', sub: env('APPLE_CLIENT_ID'),
  })}`;
  // Vercel keeps the key on one line, so allow \n in place of real line breaks
  const key = env('APPLE_PRIVATE_KEY').replace(/\\n/g, '\n');
  return `${body}.${sign('sha256', Buffer.from(body), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}

export const providers = {
  google: {
    label: 'Google',
    on: () => !!(env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET')),
    clientId: () => env('GOOGLE_CLIENT_ID'),
    clientSecret: () => env('GOOGLE_CLIENT_SECRET'),
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    pkce: true,
    async profile(tokens) {
      const c = idClaims(tokens.id_token, ['https://accounts.google.com', 'accounts.google.com'], env('GOOGLE_CLIENT_ID'));
      return { subject: c.sub, email: c.email, verified: c.email_verified === true, name: c.name };
    },
  },

  github: {
    label: 'GitHub',
    on: () => !!(env('GITHUB_CLIENT_ID') && env('GITHUB_CLIENT_SECRET')),
    clientId: () => env('GITHUB_CLIENT_ID'),
    clientSecret: () => env('GITHUB_CLIENT_SECRET'),
    authorize: 'https://github.com/login/oauth/authorize',
    token: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
    pkce: true,
    async profile(tokens) {
      const headers = { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'BotBench' };
      const user = await getJson('https://api.github.com/user', headers);
      const emails = await getJson('https://api.github.com/user/emails', headers);
      const email = emails.find(e => e.primary && e.verified) || emails.find(e => e.verified);
      return { subject: String(user.id), email: email?.email, verified: !!email, name: user.name || user.login };
    },
  },

  apple: {
    label: 'Apple',
    on: () => !!(env('APPLE_CLIENT_ID') && env('APPLE_TEAM_ID') && env('APPLE_KEY_ID') && env('APPLE_PRIVATE_KEY')),
    clientId: () => env('APPLE_CLIENT_ID'),
    clientSecret: appleSecret,
    authorize: 'https://appleid.apple.com/auth/authorize',
    token: 'https://appleid.apple.com/auth/token',
    scope: 'name email',
    // Asking for name or email makes Apple post the answer back instead of redirecting
    extra: { response_mode: 'form_post' },
    async profile(tokens, answer) {
      const c = idClaims(tokens.id_token, ['https://appleid.apple.com'], env('APPLE_CLIENT_ID'));
      // Apple only sends the name the very first time someone signs in
      let name = '';
      try {
        const n = JSON.parse(answer.user).name;
        name = [n.firstName, n.lastName].filter(Boolean).join(' ');
      } catch { /* no name this time */ }
      return { subject: c.sub, email: c.email, verified: c.email_verified === true || c.email_verified === 'true', name };
    },
  },
};

export const enabledProviders = () => Object.keys(providers).filter(k => providers[k].on());

export const challengeFor = verifier => createHash('sha256').update(verifier).digest('base64url');

export async function exchangeCode(p, { code, redirectUri, verifier }) {
  const form = new URLSearchParams({
    grant_type: 'authorization_code', code, redirect_uri: redirectUri,
    client_id: p.clientId(), client_secret: p.clientSecret(),
  });
  if (p.pkce) form.set('code_verifier', verifier);
  const res = await fetch(p.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: form,
  });
  const tokens = await res.json().catch(() => ({}));
  if (!res.ok || tokens.error) fail(502, 'The sign-in service turned the request down. Try again.');
  return tokens;
}

// Finds the user for an outside sign-in, linking it to an existing account with the
// same verified email, or making a new account.
export async function userForIdentity(provider, profile) {
  const subject = String(profile.subject || '');
  if (!subject) fail(502, 'The sign-in service did not say who you are.');

  const linked = await query(
    `select u.id, u.name, u.email from identities i join users u on u.id = i.user_id where i.provider = $1 and i.subject = $2`,
    [provider, subject],
  );
  if (linked.rows[0]) return linked.rows[0];

  const email = profile.verified && profile.email ? String(profile.email).toLowerCase() : null;
  let user = null;
  if (email) user = (await query('select id, name, email from users where email = $1', [email])).rows[0];
  if (!user) {
    const name = String(profile.name || '').trim().slice(0, 60) || (email ? email.split('@')[0] : 'Robot builder');
    user = (await query('insert into users (email, name) values ($1, $2) returning id, name, email', [email, name])).rows[0];
  }
  await query('insert into identities (provider, subject, user_id) values ($1, $2, $3) on conflict do nothing', [provider, subject, user.id]);
  return user;
}
