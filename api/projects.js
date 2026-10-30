// /api/projects        GET: your saved robots   POST: save one
// /api/projects?id=3   GET: open it             DELETE: remove it

import { query } from '../server/db.js';
import { route, send, fail, allow, readJson } from '../server/http.js';
import { requireUser } from '../server/auth.js';

const KINDS = ['line', 'maze', 'grab', 'avoid', 'sumo'];
const MAX_BYTES = 400_000;
const MAX_PROJECTS = 100;

function checkProject(p) {
  const ok = p && p.version === 1 && KINDS.includes(p.kind) && typeof p.code === 'string' &&
    p.robot && typeof p.robot === 'object' && Array.isArray(p.robot.sensors) &&
    p.arena && typeof p.arena === 'object' && Array.isArray(p.arena.lines);
  if (!ok) fail(400, 'That is not a BotBench project.');
  const json = JSON.stringify(p);
  if (json.length > MAX_BYTES) fail(413, 'That project is too big to save. Try a smaller arena.');
  return json;
}

const projectId = id => {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) fail(400, 'Which project?');
  return n;
};

export default route(async (req, res) => {
  allow(req, 'GET', 'POST', 'DELETE');
  const user = await requireUser(req);

  if (req.method === 'GET' && req.query.id) {
    const { rows } = await query('select id, data from projects where id = $1 and user_id = $2', [projectId(req.query.id), user.id]);
    if (!rows[0]) fail(404, 'That robot isn\'t in your account.');
    return send(res, 200, { id: rows[0].id, project: rows[0].data });
  }

  if (req.method === 'GET') {
    const { rows } = await query(
      'select id, name, kind, updated_at from projects where user_id = $1 order by updated_at desc',
      [user.id],
    );
    return send(res, 200, { projects: rows.map(r => ({ id: r.id, name: r.name, kind: r.kind, updatedAt: r.updated_at })) });
  }

  if (req.method === 'DELETE') {
    await query('delete from projects where id = $1 and user_id = $2', [projectId(req.query.id), user.id]);
    return send(res, 200, { ok: true });
  }

  const body = await readJson(req);
  const json = checkProject(body.project);
  const name = String(body.project.robot.name || 'My robot').trim().slice(0, 80) || 'My robot';

  if (body.id) {
    const { rows } = await query(
      `update projects set name = $1, kind = $2, data = $3::text::jsonb, updated_at = now()
       where id = $4 and user_id = $5 returning id`,
      [name, body.project.kind, json, projectId(body.id), user.id],
    );
    // Deleted on another device: fall through and save it as a new one
    if (rows[0]) return send(res, 200, { id: rows[0].id });
  }

  const count = (await query('select count(*)::int as n from projects where user_id = $1', [user.id])).rows[0].n;
  if (count >= MAX_PROJECTS) fail(409, `You have ${MAX_PROJECTS} saved robots, which is the limit. Delete one first.`);
  const { rows } = await query(
    'insert into projects (user_id, name, kind, data) values ($1, $2, $3, $4::text::jsonb) returning id',
    [user.id, name, body.project.kind, json],
  );
  send(res, 201, { id: rows[0].id });
});
