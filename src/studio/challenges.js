// Scores after a run, personal bests and the Challenges list.

import { store } from './store.js';
import { pickPreset, renderLists } from './arena.js';
import { presets } from '../engine/arena.js';
import { scoreRun, challenges, TIERS } from '../engine/score.js';
import { uploadBests, loadBoards } from './account.js';

const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids) n.append(k);
  return n;
};

// ---------- personal bests ----------

const BEST_KEY = 'botbench.best';

function readBests() {
  try { return JSON.parse(localStorage.getItem(BEST_KEY)) || {}; } catch { return {}; }
}
function writeBests(bests) {
  try { localStorage.setItem(BEST_KEY, JSON.stringify(bests)); } catch { /* private mode or full */ }
}

export function bestFor(arenaId, kind = store.project.kind) {
  return readBests()[`${arenaId}:${kind}`] || null;
}

const beats = (s, best) => !best || s.stars > best.stars || (s.stars === best.stars && s.lapTime < best.lapTime);

// Saves the score if it is a new best. Returns true when it was.
function saveBest(arenaId, kind, s) {
  if (!s.passed) return false;
  const bests = readBests();
  const key = `${arenaId}:${kind}`;
  if (!beats(s, bests[key])) return false;
  bests[key] = { stars: s.stars, lapTime: s.lapTime, accuracy: s.accuracy, collisions: s.collisions, points: s.points, at: Date.now() };
  writeBests(bests);
  if (challenges[arenaId]?.kind === kind) uploadBests([{ arena: arenaId, ...bests[key] }]);
  return true;
}

// Bests from before logging in go up to the account too; the server keeps whichever is better
uploadBests(Object.entries(readBests()).flatMap(([key, b]) => {
  const [arena, kind] = key.split(':');
  return challenges[arena]?.kind === kind ? [{ arena, ...b }] : [];
}));

// ---------- small pieces ----------

const secs = t => `${t.toFixed(1)} s`;

export function starsEl(n) {
  const wrap = el('span', { className: 'stars' }, el('span', { className: 'visually-hidden', textContent: `${n} of 3 stars` }));
  for (let i = 0; i < 3; i++) wrap.append(el('i', { className: i < n ? 'on' : '', textContent: '★', ariaHidden: 'true' }));
  return wrap;
}

// Shown next to an arena's name in the Arena tab
export function bestBadge(arenaId) {
  const best = bestFor(arenaId);
  if (!best) return null;
  return el('em', { className: 'best', title: 'Your best' }, starsEl(best.stars), ` ${secs(best.lapTime)}`);
}

// ---------- score card after a run ----------

let card = null;

function hideScore() {
  if (card) card.hidden = true;
}

export function showScore({ sim, arena, kind }) {
  const r = sim && sim.state.result;
  if (!r || r.status === 'stopped' || r.reason === 'compile' || r.reason === 'missing-entry') { hideScore(); return; }
  const s = scoreRun({ sim, arena, kind });
  const fresh = saveBest(arena.id, kind, s);
  if (fresh) renderLists();

  if (!card) {
    card = el('div', { className: 'score-card', role: 'status' });
    document.querySelector('.sim-stage').append(card);
  }
  const stats = el('dl', {},
    el('div', {}, el('dt', { textContent: 'Time' }), el('dd', { textContent: secs(s.lapTime ?? sim.state.t) })));
  if (s.accuracy !== null) stats.append(el('div', {}, el('dt', { textContent: 'On the line' }), el('dd', { textContent: `${Math.round(s.accuracy * 100)}%` })));
  if (arena.walls.length) stats.append(el('div', {}, el('dt', { textContent: 'Wall hits' }), el('dd', { textContent: s.collisions })));
  card.replaceChildren(starsEl(s.stars), stats);
  if (fresh) card.append(el('span', { className: 'new-best', textContent: 'New best!' }));
  card.classList.toggle('fresh', fresh);
  card.hidden = false;
}

// ---------- challenges dialog ----------

function targetText(tier) {
  let t = `${tier.t} s or less`;
  if (tier.acc !== undefined) t += `, ${Math.round(tier.acc * 100)}% on the line`;
  if (tier.hits !== undefined) t += tier.hits ? `, at most ${tier.hits} wall ${tier.hits === 1 ? 'hit' : 'hits'}` : ', no wall hits';
  return t;
}

const kindName = { line: 'line follower', maze: 'maze solver', grab: 'grabber' };

// Top five per challenge, filled in when the account api answers
function board(rows) {
  if (!rows?.length) return el('p', { className: 'board none', textContent: 'No one on the board yet. Finish it to be first.' });
  return el('ol', { className: 'board', ariaLabel: 'Top times' }, ...rows.map(r =>
    el('li', { className: r.mine ? 'mine' : '' }, el('span', { textContent: r.name }), starsEl(r.stars), el('b', { textContent: secs(r.lapTime) }))));
}

function renderChallenges() {
  const host = $('challenge-list');
  loadBoards().then(boards => {
    if (!boards) return;
    for (const li of host.querySelectorAll('.challenge')) li.querySelector('.board-slot').replaceChildren(board(boards[li.dataset.arena]));
  });
  host.replaceChildren(...presets.filter(p => challenges[p.id]).map(p => {
    const c = challenges[p.id];
    const best = bestFor(p.id, c.kind);
    const targets = el('ol', { className: 'targets' }, ...[...TIERS].reverse().map(k =>
      el('li', { className: k }, el('b', { textContent: k[0].toUpperCase() + k.slice(1) }), ` ${targetText(c[k])}`)));
    const try_ = el('button', { className: 'btn small', type: 'button', textContent: 'Try it' });
    try_.addEventListener('click', () => {
      pickPreset(p.id);
      if (store.project.arena.id !== p.id) return;
      $('challenge-dialog').close();
      $('tab-btn-run').click();
    });
    const li = el('li', { className: 'challenge' },
      el('div', { className: 'challenge-head' },
        el('h3', { textContent: c.title }),
        el('span', { className: 'where', textContent: `${p.name}, ${kindName[c.kind] || c.kind}` })),
      el('p', { textContent: c.goal }),
      targets,
      el('div', { className: 'board-slot' }),
      el('div', { className: 'challenge-foot' },
        best ? el('span', { className: 'best' }, 'Your best ', starsEl(best.stars), ` ${secs(best.lapTime)}`)
          : el('span', { className: 'best none', textContent: 'Not finished yet' }),
        try_));
    li.dataset.arena = p.id;
    return li;
  }));
}

$('btn-challenges').addEventListener('click', () => { renderChallenges(); $('challenge-dialog').showModal(); });
$('challenge-close').addEventListener('click', () => $('challenge-dialog').close());

// A new run, a reset or a changed robot or arena makes the card stale
for (const id of ['btn-run', 'btn-skip', 'btn-reset']) $(id).addEventListener('click', hideScore);
store.on('robot', hideScore);
store.on('arena', hideScore);
