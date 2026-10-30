// Passwords, sessions and the guessing limit.

import { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { query } from './db.js';
import { cookies, setCookie, fail } from './http.js';

const scryptAsync = promisify(scrypt);

export const SESSION_COOKIE = 'bb_session';
const SESSION_DAYS = 30;

export const newToken = () => randomBytes(32).toString('base64url');
export const tokenHash = token => createHash('sha256').update(token).digest('hex');

// scrypt with Node's defaults (N=16384, r=8, p=1), stored as scrypt$salt$key
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password.normalize('NFKC'), salt, 64);
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

let dummyHash = null;

export async function checkPassword(password, stored) {
  // Still hash something when there's no account, so a wrong email takes as long as a wrong password
  dummyHash ??= await hashPassword('not a real password');
  const [, salt, key] = (stored || dummyHash).split('$');
  const want = Buffer.from(key, 'base64url');
  const got = await scryptAsync(password.normalize('NFKC'), Buffer.from(salt, 'base64url'), want.length);
  return timingSafeEqual(got, want) && !!stored;
}

export function cleanEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) fail(400, 'That email address doesn\'t look right.');
  return e;
}

export function cleanName(name) {
  const n = String(name || '').trim().replace(/\s+/g, ' ');
  if (!n) fail(400, 'Tell us what to call you.');
  if (n.length > 60) fail(400, 'That name is a bit long. 60 characters at most.');
  return n;
}

export function checkNewPassword(password) {
  if (typeof password !== 'string' || password.length < 8) fail(400, 'Use at least 8 characters for the password.');
  if (password.length > 200) fail(400, 'That password is too long. 200 characters at most.');
  return password;
}

export const publicUser = u => ({ id: u.id, name: u.name, email: u.email });

// ---------- sessions ----------

export async function startSession(req, res, userId) {
  const token = newToken();
  await query(
    `insert into sessions (token_hash, user_id, expires_at) values ($1, $2, now() + make_interval(days => $3))`,
    [tokenHash(token), userId, SESSION_DAYS],
  );
  setCookie(req, res, SESSION_COOKIE, token, { maxAge: SESSION_DAYS * 86400 });
}

export async function currentUser(req) {
  const token = cookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const { rows } = await query(
    `select u.id, u.name, u.email from sessions s join users u on u.id = s.user_id
     where s.token_hash = $1 and s.expires_at > now()`,
    [tokenHash(token)],
  );
  return rows[0] || null;
}

export async function requireUser(req) {
  const user = await currentUser(req);
  if (!user) fail(401, 'Log in first.');
  return user;
}

export async function endSession(req, res) {
  const token = cookies(req)[SESSION_COOKIE];
  if (token) await query('delete from sessions where token_hash = $1', [tokenHash(token)]);
  setCookie(req, res, SESSION_COOKIE, '', { maxAge: 0 });
}

// ---------- guessing limit ----------

// 10 tries per email in 15 minutes. A whole classroom can share one IP address,
// so the per-address limit is much looser.
const limitFor = key => (key.startsWith('ip:') ? 100 : 10);

export async function tooMany(...keys) {
  const { rows } = await query(
    `select key, count(*)::int as n from attempts where key in ($1, $2) and at > now() - interval '15 minutes' group by key`,
    [keys[0], keys[1] ?? keys[0]],
  );
  return rows.some(r => r.n >= limitFor(r.key));
}

export async function recordAttempt(...keys) {
  for (const key of keys) await query('insert into attempts (key) values ($1)', [key]);
  await query(`delete from attempts where at < now() - interval '1 day'`);
}
