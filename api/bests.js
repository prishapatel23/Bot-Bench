// /api/bests   GET: top five on each challenge   POST: { scores: [...] } your finished runs

import { query } from '../server/db.js';
import { route, send, fail, allow, readJson } from '../server/http.js';
import { currentUser, requireUser } from '../server/auth.js';
import { challenges, starsFor } from '../src/engine/score.js';

const BOARD_SIZE = 5;

// ponytail: scores come from the browser, so a determined cheat can fake one.
// Checking them properly means re-running the sketch here, which means running
// strangers' code on the server; worth it only if the boards start to matter.
function cleanScore(s) {
  const arena = String(s?.arena || '');
  if (!Object.hasOwn(challenges, arena)) return null;
  const lapTime = Number(s.lapTime);
  const accuracy = s.accuracy === null || s.accuracy === undefined ? null : Number(s.accuracy);
  const collisions = Number(s.collisions ?? 0);
  if (!Number.isFinite(lapTime) || lapTime < 1 || lapTime > 600) return null;
  if (accuracy !== null && !(accuracy >= 0 && accuracy <= 1)) return null;
  if (!Number.isInteger(collisions) || collisions < 0) return null;
  // Stars are worked out here from the numbers, not taken from the request
  const stars = starsFor(arena, { passed: true, lapTime, accuracy, collisions });
  return { arena, lapTime, accuracy, collisions, stars };
}

export default route(async (req, res) => {
  allow(req, 'GET', 'POST');

  if (req.method === 'GET') {
    const user = await currentUser(req);
    const { rows } = await query(
      `select arena, name, stars, lap_time, mine from (
         select b.arena, u.name, b.stars, b.lap_time, b.user_id = $1 as mine,
                row_number() over (partition by b.arena order by b.stars desc, b.lap_time, b.at) as place
         from bests b join users u on u.id = b.user_id
       ) ranked where place <= $2 order by arena, place`,
      [user?.id ?? 0, BOARD_SIZE],
    );
    const boards = {};
    for (const r of rows) (boards[r.arena] ??= []).push({ name: r.name, stars: r.stars, lapTime: r.lap_time, mine: r.mine });
    return send(res, 200, { boards });
  }

  const user = await requireUser(req);
  const { scores } = await readJson(req);
  if (!Array.isArray(scores) || scores.length > 20) fail(400, 'Send a list of scores.');
  for (const s of scores.map(cleanScore)) {
    if (!s) continue;
    await query(
      `insert into bests (user_id, arena, stars, lap_time, accuracy, collisions) values ($1, $2, $3, $4, $5, $6)
       on conflict (user_id, arena) do update
         set stars = excluded.stars, lap_time = excluded.lap_time, accuracy = excluded.accuracy,
             collisions = excluded.collisions, at = now()
         where excluded.stars > bests.stars or (excluded.stars = bests.stars and excluded.lap_time < bests.lap_time)`,
      [user.id, s.arena, s.stars, s.lapTime, s.accuracy, s.collisions],
    );
  }
  send(res, 200, { ok: true });
});
