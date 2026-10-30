// Small helpers shared by the api/ routes. They stick to plain Node req/res, so the
// same handlers run on Vercel and inside the Vite dev server.

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const fail = (status, message) => { throw new HttpError(status, message); };

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export function redirect(res, to) {
  res.statusCode = 302;
  res.setHeader('Location', to);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

// Wraps a handler so a thrown HttpError becomes a JSON error and anything else a plain 500
export const route = handler => async (req, res) => {
  try {
    await handler(req, res);
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.status, { error: err.message });
    console.error(err);
    send(res, 500, { error: 'Something went wrong on our side. Try again in a minute.' });
  }
};

export function allow(req, ...methods) {
  if (!methods.includes(req.method)) fail(405, `Use ${methods.join(' or ')}.`);
}

async function rawBody(req) {
  // Vercel reads and parses the body before the handler runs
  if (req.body !== undefined) return req.body;
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 1_000_000) fail(413, 'That is too big to save.');
  }
  return text;
}

export async function readJson(req) {
  // A form on another site can't send JSON without CORS saying yes, so this doubles as CSRF protection
  if (!/^application\/json\b/.test(req.headers['content-type'] || '')) fail(415, 'Send JSON.');
  let body;
  try { body = await rawBody(req); } catch (err) { if (err instanceof HttpError) throw err; body = null; }
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) return body;
  try {
    const parsed = JSON.parse(String(body));
    if (parsed && typeof parsed === 'object') return parsed;
  } catch { /* falls through */ }
  fail(400, 'That request could not be read.');
}

// Sign in with Apple posts its answer back as a form
export async function readForm(req) {
  const body = await rawBody(req);
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) return body;
  return Object.fromEntries(new URLSearchParams(String(body || '')));
}

export function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const isHttps = req => req.headers['x-forwarded-proto'] === 'https' || !!req.socket?.encrypted;

export function setCookie(req, res, name, value, { maxAge, sameSite = 'Lax' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', `SameSite=${sameSite}`];
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  if (isHttps(req) || sameSite === 'None') parts.push('Secure');
  const before = res.getHeader('Set-Cookie') || [];
  res.setHeader('Set-Cookie', [...[].concat(before), parts.join('; ')]);
}

// Links in emails and OAuth redirect addresses use SITE_URL when it's set,
// so a forged Host header can't point them somewhere else
export function siteUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/+$/, '');
  return `${isHttps(req) ? 'https' : 'http'}://${req.headers.host}`;
}

export function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
}

// Only paths on this site, so ?next= can't send someone to another domain
export function safeNext(next, fallback = '/studio') {
  return typeof next === 'string' && /^\/(?![/\\])/.test(next) ? next : fallback;
}
