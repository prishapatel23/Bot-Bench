// Account api checks: runs the real routes through the dev server with an
// in-memory Postgres (PGlite), and fakes Google and GitHub's side of OAuth.
// npm run test:api

import assert from 'node:assert/strict';
import { createServer } from 'vite';

process.env.PGLITE_DIR = 'memory://';
delete process.env.DATABASE_URL;
delete process.env.RESEND_API_KEY;
delete process.env.SITE_URL;
Object.assign(process.env, {
  GITHUB_CLIENT_ID: 'gh-id', GITHUB_CLIENT_SECRET: 'gh-secret',
  GOOGLE_CLIENT_ID: 'g-id', GOOGLE_CLIENT_SECRET: 'g-secret',
});
for (const k of ['APPLE_CLIENT_ID', 'APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY']) delete process.env[k];

// ---------- fake providers ----------

const realFetch = globalThis.fetch;
const fake = { githubEmail: 'maker@example.com', googleAud: 'g-id' };
const json = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const jwt = claims => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`;

globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u === 'https://github.com/login/oauth/access_token') {
    const form = new URLSearchParams(String(opts.body));
    assert.equal(form.get('client_secret'), 'gh-secret');
    assert.ok(form.get('code_verifier'), 'GitHub gets the PKCE verifier');
    return json({ access_token: 'gh-token' });
  }
  if (u === 'https://api.github.com/user') return json({ id: 4242, login: 'maker', name: 'Mo Maker' });
  if (u === 'https://api.github.com/user/emails') return json([{ email: fake.githubEmail, primary: true, verified: true }]);
  if (u === 'https://oauth2.googleapis.com/token') {
    return json({ id_token: jwt({ iss: 'https://accounts.google.com', aud: fake.googleAud, sub: 'g-1', email: 'gee@example.com', email_verified: true, name: 'Gee' }) });
  }
  return realFetch(url, opts);
};

// Without RESEND_API_KEY the reset mail is printed; keep the link it prints
let lastMail = '';
const log = console.log;
console.log = (...args) => {
  const text = args.join(' ');
  if (text.includes('--- mail to')) lastMail = text;
  else log(...args);
};

// ---------- server and a tiny browser ----------

const server = await createServer({ logLevel: 'silent', server: { port: 0 } });
await server.listen();
const base = `http://localhost:${server.httpServer.address().port}`;

function browser() {
  const jar = {};
  return {
    jar,
    async call(path, { method = 'GET', body, type = 'application/json' } = {}) {
      const headers = { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') };
      if (body !== undefined) headers['content-type'] = type;
      const res = await realFetch(base + path, {
        method, headers, redirect: 'manual',
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      });
      for (const c of res.headers.getSetCookie()) {
        const [pair, ...attrs] = c.split(';');
        const i = pair.indexOf('=');
        const name = pair.slice(0, i);
        if (attrs.some(a => a.trim() === 'Max-Age=0')) delete jar[name];
        else jar[name] = pair.slice(i + 1);
      }
      const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
      return { status: res.status, data, location: res.headers.get('location') };
    },
  };
}

let failed = 0;
async function check(name, fn) {
  try { await fn(); log('  ok   ' + name); }
  catch (err) { failed++; log('  FAIL ' + name + '\n       ' + String(err.stack || err).split('\n').slice(0, 3).join('\n       ')); }
}

const project = (name, kind = 'line') => ({ version: 1, kind, robot: { name, sensors: [] }, arena: { id: 'oval', lines: [], walls: [], objects: [] }, code: 'void setup() {}\nvoid loop() {}' });

const ada = browser();
const bob = browser();

log('accounts');
await check('me says nobody, and which sign-ins are on', async () => {
  const r = await ada.call('/api/auth/me');
  assert.equal(r.data.user, null);
  assert.deepEqual(r.data.providers.sort(), ['github', 'google']);
});
await check('signup checks its input', async () => {
  assert.equal((await ada.call('/api/auth/signup', { method: 'POST', body: { name: 'Ada', email: 'nope', password: 'longenough' } })).status, 400);
  assert.equal((await ada.call('/api/auth/signup', { method: 'POST', body: { name: 'Ada', email: 'ada@example.com', password: 'short' } })).status, 400);
  assert.equal((await ada.call('/api/auth/signup', { method: 'POST', body: { name: '  ', email: 'ada@example.com', password: 'longenough' } })).status, 400);
});
await check('only JSON is accepted, so other sites cannot post a form', async () => {
  const r = await ada.call('/api/auth/signup', { method: 'POST', body: 'name=Ada&email=ada@example.com&password=longenough', type: 'application/x-www-form-urlencoded' });
  assert.equal(r.status, 415);
});
await check('signup logs you in with an HttpOnly cookie', async () => {
  const r = await ada.call('/api/auth/signup', { method: 'POST', body: { name: 'Ada', email: 'Ada@Example.com', password: 'correct horse' } });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.email, 'ada@example.com');
  assert.ok(ada.jar.bb_session);
  assert.equal((await ada.call('/api/auth/me')).data.user.name, 'Ada');
});
await check('the same email cannot sign up twice', async () => {
  const r = await bob.call('/api/auth/signup', { method: 'POST', body: { name: 'Fake', email: 'ada@example.com', password: 'whatever123' } });
  assert.equal(r.status, 409);
});
await check('logout ends the session on the server too', async () => {
  const token = ada.jar.bb_session;
  await ada.call('/api/auth/logout', { method: 'POST', body: {} });
  assert.equal((await ada.call('/api/auth/me')).data.user, null);
  ada.jar.bb_session = token;
  assert.equal((await ada.call('/api/auth/me')).data.user, null, 'an old cookie no longer works');
  delete ada.jar.bb_session;
});
await check('login: wrong password, then right one', async () => {
  const wrong = await ada.call('/api/auth/login', { method: 'POST', body: { email: 'ada@example.com', password: 'nope nope' } });
  assert.equal(wrong.status, 401);
  const nobody = await ada.call('/api/auth/login', { method: 'POST', body: { email: 'ghost@example.com', password: 'nope nope' } });
  assert.equal(nobody.data.error, wrong.data.error, 'no hint about which emails have accounts');
  const ok = await ada.call('/api/auth/login', { method: 'POST', body: { email: ' ADA@example.com ', password: 'correct horse' } });
  assert.equal(ok.status, 200);
});

log('saved robots');
let adaRobot;
await check('save, list and open a robot', async () => {
  assert.equal((await bob.call('/api/projects')).status, 401);
  const saved = await ada.call('/api/projects', { method: 'POST', body: { project: project('Zippy') } });
  assert.equal(saved.status, 201);
  adaRobot = saved.data.id;
  const list = await ada.call('/api/projects');
  assert.deepEqual(list.data.projects.map(p => p.name), ['Zippy']);
  const one = await ada.call(`/api/projects?id=${adaRobot}`);
  assert.equal(one.data.project.robot.name, 'Zippy');
  assert.equal(one.data.project.code, project('x').code);
});
await check('saving again with the id updates it', async () => {
  const r = await ada.call('/api/projects', { method: 'POST', body: { id: adaRobot, project: project('Zippy 2', 'maze') } });
  assert.equal(r.data.id, adaRobot);
  const list = await ada.call('/api/projects');
  assert.equal(list.data.projects.length, 1);
  assert.equal(list.data.projects[0].kind, 'maze');
});
await check('junk is refused', async () => {
  assert.equal((await ada.call('/api/projects', { method: 'POST', body: { project: { version: 2 } } })).status, 400);
  const big = project('Big');
  big.code = 'x'.repeat(500_000);
  assert.equal((await ada.call('/api/projects', { method: 'POST', body: { project: big } })).status, 413);
});
await check('other people cannot open, change or delete your robots', async () => {
  await bob.call('/api/auth/signup', { method: 'POST', body: { name: 'Bob', email: 'bob@example.com', password: 'bobbobbob' } });
  assert.equal((await bob.call(`/api/projects?id=${adaRobot}`)).status, 404);
  const sneaky = await bob.call('/api/projects', { method: 'POST', body: { id: adaRobot, project: project('Mine now') } });
  assert.notEqual(sneaky.data.id, adaRobot, 'saved as Bob\'s own copy instead');
  await bob.call(`/api/projects?id=${adaRobot}`, { method: 'DELETE' });
  assert.equal((await ada.call(`/api/projects?id=${adaRobot}`)).data.project.robot.name, 'Zippy 2');
});
await check('delete', async () => {
  await ada.call(`/api/projects?id=${adaRobot}`, { method: 'DELETE' });
  assert.equal((await ada.call('/api/projects')).data.projects.length, 0);
});

log('challenge boards');
await check('stars are worked out on the server', async () => {
  await ada.call('/api/bests', { method: 'POST', body: { scores: [{ arena: 'oval', lapTime: 25, accuracy: 0.5, collisions: 0, stars: 3 }] } });
  const board = (await ada.call('/api/bests')).data.boards.oval;
  assert.equal(board[0].stars, 1);
  assert.equal(board[0].mine, true);
});
await check('only a better run replaces your best', async () => {
  await ada.call('/api/bests', { method: 'POST', body: { scores: [{ arena: 'oval', lapTime: 40, accuracy: 1 }] } });
  assert.equal((await ada.call('/api/bests')).data.boards.oval[0].lapTime, 25);
  await ada.call('/api/bests', { method: 'POST', body: { scores: [{ arena: 'oval', lapTime: 14, accuracy: 0.95, collisions: 0 }] } });
  const best = (await ada.call('/api/bests')).data.boards.oval[0];
  assert.equal(best.stars, 3);
  assert.equal(best.lapTime, 14);
});
await check('board order, and nonsense scores are dropped', async () => {
  await bob.call('/api/bests', { method: 'POST', body: { scores: [
    { arena: 'oval', lapTime: 18, accuracy: 0.8 },
    { arena: 'not-an-arena', lapTime: 5 },
    { arena: 'snake', lapTime: 0.01 },
    { arena: 'maze', lapTime: 30, collisions: -1 },
  ] } });
  const { boards } = (await realFetch(base + '/api/bests').then(r => r.json()));
  assert.deepEqual(boards.oval.map(r => r.name), ['Ada', 'Bob']);
  assert.equal(boards.oval[0].mine, false, 'nobody is logged in for this one');
  assert.deepEqual(Object.keys(boards), ['oval']);
  assert.equal((await browser().call('/api/bests', { method: 'POST', body: { scores: [] } })).status, 401);
});

log('passwords');
await check('ten wrong passwords and it waits', async () => {
  const eve = browser();
  for (let i = 0; i < 10; i++) await eve.call('/api/auth/login', { method: 'POST', body: { email: 'bob@example.com', password: `guess${i}` } });
  const r = await eve.call('/api/auth/login', { method: 'POST', body: { email: 'bob@example.com', password: 'bobbobbob' } });
  assert.equal(r.status, 429);
});
await check('reset by email link, once, and it logs out other devices', async () => {
  const quiet = await bob.call('/api/auth/forgot', { method: 'POST', body: { email: 'nobody@example.com' } });
  assert.equal(quiet.status, 200);
  assert.equal(lastMail, '', 'no mail for an unknown address');

  const laptop = browser();
  await laptop.call('/api/auth/login', { method: 'POST', body: { email: 'ada@example.com', password: 'correct horse' } });
  await ada.call('/api/auth/forgot', { method: 'POST', body: { email: 'ada@example.com' } });
  const token = lastMail.match(/\/reset\?token=([\w-]+)/)?.[1];
  assert.ok(token, 'the mail has a reset link');

  const phone = browser();
  assert.equal((await phone.call('/api/auth/reset', { method: 'POST', body: { token, password: 'short' } })).status, 400);
  const r = await phone.call('/api/auth/reset', { method: 'POST', body: { token, password: 'a brand new one' } });
  assert.equal(r.status, 200);
  assert.equal((await phone.call('/api/auth/me')).data.user.name, 'Ada');
  assert.equal((await laptop.call('/api/auth/me')).data.user, null);
  assert.equal((await phone.call('/api/auth/reset', { method: 'POST', body: { token, password: 'another one!' } })).status, 400);
  assert.equal((await browser().call('/api/auth/login', { method: 'POST', body: { email: 'ada@example.com', password: 'a brand new one' } })).status, 200);
});

log('sign in with GitHub and Google');
async function startOAuth(b, provider, next = '/studio') {
  const r = await b.call(`/api/oauth/${provider}?next=${encodeURIComponent(next)}`);
  assert.equal(r.status, 302);
  return new URL(r.location);
}
await check('GitHub: sends you off with state and PKCE', async () => {
  const to = await startOAuth(browser(), 'github');
  assert.equal(to.origin + to.pathname, 'https://github.com/login/oauth/authorize');
  assert.equal(to.searchParams.get('client_id'), 'gh-id');
  assert.ok(to.searchParams.get('state'));
  assert.equal(to.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(to.searchParams.get('redirect_uri'), `${base}/api/oauth/github`);
});
await check('GitHub: a wrong state is turned away', async () => {
  const b = browser();
  await startOAuth(b, 'github');
  const r = await b.call('/api/oauth/github?code=abc&state=forged');
  assert.match(r.location, /^\/login\?error=/);
  assert.equal((await b.call('/api/auth/me')).data.user, null);
});
await check('GitHub: makes an account and comes back to ?next', async () => {
  const b = browser();
  const state = (await startOAuth(b, 'github', '/studio#robot')).searchParams.get('state');
  const r = await b.call(`/api/oauth/github?code=abc&state=${state}`);
  assert.equal(r.location, '/studio#robot');
  const me = (await b.call('/api/auth/me')).data.user;
  assert.equal(me.name, 'Mo Maker');
  assert.equal(me.email, 'maker@example.com');
});
await check('GitHub: same verified email as a password account links to it', async () => {
  fake.githubEmail = 'bob@example.com';
  const b = browser();
  const state = (await startOAuth(b, 'github')).searchParams.get('state');
  // a different GitHub user this time
  const original = globalThis.fetch;
  globalThis.fetch = (url, opts) => String(url) === 'https://api.github.com/user' ? Promise.resolve(json({ id: 777, login: 'bobby' })) : original(url, opts);
  await b.call(`/api/oauth/github?code=abc&state=${state}`);
  globalThis.fetch = original;
  assert.equal((await b.call('/api/auth/me')).data.user.name, 'Bob');
});
await check('?next can only point at this site', async () => {
  const b = browser();
  const state = (await startOAuth(b, 'github', '//evil.example/steal')).searchParams.get('state');
  assert.equal((await b.call(`/api/oauth/github?code=abc&state=${state}`)).location, '/studio');
});
await check('Google: checks who the ID token was for', async () => {
  const b = browser();
  fake.googleAud = 'someone-else';
  let state = (await startOAuth(b, 'google')).searchParams.get('state');
  assert.match((await b.call(`/api/oauth/google?code=abc&state=${state}`)).location, /^\/login\?error=/);
  fake.googleAud = 'g-id';
  state = (await startOAuth(b, 'google')).searchParams.get('state');
  assert.equal((await b.call(`/api/oauth/google?code=abc&state=${state}`)).location, '/studio');
  assert.equal((await b.call('/api/auth/me')).data.user.email, 'gee@example.com');
});
await check('Apple is off without its keys', async () => {
  const r = await browser().call('/api/oauth/apple');
  assert.match(r.location, /^\/login\?error=/);
});

await server.close();
log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
