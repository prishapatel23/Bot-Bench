// /api/oauth/google, /api/oauth/github, /api/oauth/apple
// Without a code it sends the browser to the provider; with one it finishes the sign-in.

import { route, redirect, readForm, cookies, setCookie, siteUrl, safeNext } from '../../server/http.js';
import { startSession, newToken } from '../../server/auth.js';
import { providers, challengeFor, exchangeCode, userForIdentity } from '../../server/oauth.js';

const COOKIE = 'bb_oauth';

const toLogin = (res, message) => redirect(res, `/login?error=${encodeURIComponent(message)}`);

export default route(async (req, res) => {
  const name = req.query.provider;
  const p = Object.hasOwn(providers, name) ? providers[name] : null;
  if (!p || !p.on()) return toLogin(res, 'That way of signing in isn\'t switched on.');

  const redirectUri = `${siteUrl(req)}/api/oauth/${name}`;
  const answer = req.method === 'POST' ? await readForm(req) : req.query;
  // Apple posts back from its own site, which a Lax cookie wouldn't survive
  const sameSite = name === 'apple' ? 'None' : 'Lax';

  if (!answer.code && !answer.error) {
    const state = newToken();
    const verifier = newToken();
    const next = safeNext(req.query.next);
    setCookie(req, res, COOKIE, JSON.stringify({ state, verifier, next }), { maxAge: 600, sameSite });
    const url = new URL(p.authorize);
    url.search = new URLSearchParams({
      client_id: p.clientId(), redirect_uri: redirectUri, response_type: 'code', scope: p.scope, state,
      ...(p.pkce ? { code_challenge: challengeFor(verifier), code_challenge_method: 'S256' } : {}),
      ...p.extra,
    });
    return redirect(res, url.href);
  }

  let saved = null;
  try { saved = JSON.parse(cookies(req)[COOKIE]); } catch { /* missing or mangled */ }
  setCookie(req, res, COOKIE, '', { maxAge: 0, sameSite });

  if (answer.error) return toLogin(res, `${p.label} sign-in was cancelled.`);
  if (!saved || typeof answer.state !== 'string' || answer.state !== saved.state) {
    return toLogin(res, 'That sign-in took too long or came from somewhere else. Try again.');
  }

  try {
    const tokens = await exchangeCode(p, { code: String(answer.code), redirectUri, verifier: saved.verifier });
    const user = await userForIdentity(name, await p.profile(tokens, answer));
    await startSession(req, res, user.id);
  } catch (err) {
    if (!err.status) console.error(err);
    return toLogin(res, `Couldn't finish signing in with ${p.label}. Try again.`);
  }
  redirect(res, safeNext(saved.next));
});
