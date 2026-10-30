// /api/auth/signup, login, logout, me, forgot and reset

import { query } from '../../server/db.js';
import { route, send, fail, allow, readJson, siteUrl, clientIp } from '../../server/http.js';
import {
  hashPassword, checkPassword, cleanEmail, cleanName, checkNewPassword, publicUser,
  startSession, currentUser, endSession, tooMany, recordAttempt, newToken, tokenHash,
} from '../../server/auth.js';
import { enabledProviders } from '../../server/oauth.js';
import { sendMail } from '../../server/mail.js';

const actions = {
  async me(req, res) {
    allow(req, 'GET');
    const user = await currentUser(req);
    send(res, 200, { user: user && publicUser(user), providers: enabledProviders() });
  },

  async signup(req, res) {
    allow(req, 'POST');
    const body = await readJson(req);
    const name = cleanName(body.name);
    const email = cleanEmail(body.email);
    const hash = await hashPassword(checkNewPassword(body.password));
    const { rows } = await query(
      'insert into users (email, name, password_hash) values ($1, $2, $3) on conflict (email) do nothing returning id, name, email',
      [email, name, hash],
    );
    if (!rows[0]) fail(409, 'There\'s already an account with that email. Log in instead.');
    await startSession(req, res, rows[0].id);
    send(res, 201, { user: publicUser(rows[0]) });
  },

  async login(req, res) {
    allow(req, 'POST');
    const body = await readJson(req);
    const email = cleanEmail(body.email);
    const keys = [`login:${email}`, `ip:${clientIp(req)}`];
    if (await tooMany(...keys)) fail(429, 'Too many tries. Wait 15 minutes, or reset your password.');
    const user = (await query('select id, name, email, password_hash from users where email = $1', [email])).rows[0];
    if (!(await checkPassword(String(body.password || ''), user?.password_hash))) {
      await recordAttempt(...keys);
      fail(401, 'That email and password don\'t match.');
    }
    await startSession(req, res, user.id);
    send(res, 200, { user: publicUser(user) });
  },

  async logout(req, res) {
    allow(req, 'POST');
    await endSession(req, res);
    send(res, 200, { ok: true });
  },

  // Always answers the same, so it can't be used to find out who has an account
  async forgot(req, res) {
    allow(req, 'POST');
    const email = cleanEmail((await readJson(req)).email);
    const keys = [`reset:${email}`, `ip:${clientIp(req)}`];
    if (await tooMany(...keys)) fail(429, 'Too many reset emails. Wait 15 minutes and check your spam folder.');
    await recordAttempt(...keys);
    const user = (await query('select id, name from users where email = $1', [email])).rows[0];
    if (user) {
      const token = newToken();
      await query(
        `insert into password_resets (token_hash, user_id, expires_at) values ($1, $2, now() + interval '1 hour')`,
        [tokenHash(token), user.id],
      );
      await sendMail({
        to: email,
        subject: 'Reset your BotBench password',
        text: `Hi ${user.name},\n\nSomeone asked to reset the password for your BotBench account. If it was you, open this link within an hour:\n\n${siteUrl(req)}/reset?token=${token}\n\nIf it wasn't, ignore this email and nothing changes.\n\nBotBench`,
      });
    }
    send(res, 200, { ok: true });
  },

  async reset(req, res) {
    allow(req, 'POST');
    const body = await readJson(req);
    const password = checkNewPassword(body.password);
    const { rows } = await query(
      'delete from password_resets where token_hash = $1 and expires_at > now() returning user_id',
      [tokenHash(String(body.token || ''))],
    );
    if (!rows[0]) fail(400, 'That reset link has expired or was already used. Ask for a new one.');
    const userId = rows[0].user_id;
    await query('update users set password_hash = $1 where id = $2', [await hashPassword(password), userId]);
    // A new password logs out every other device, and spends any other reset links
    await query('delete from sessions where user_id = $1', [userId]);
    await query('delete from password_resets where user_id = $1', [userId]);
    await startSession(req, res, userId);
    const user = (await query('select id, name, email from users where id = $1', [userId])).rows[0];
    send(res, 200, { user: publicUser(user) });
  },
};

export default route(async (req, res) => {
  const action = actions[req.query.action];
  if (!action) fail(404, 'No such page.');
  await action(req, res);
});
