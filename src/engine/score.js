// Turns a finished run into a score: time, how well it kept to the tape,
// wall touches and 0 to 3 stars. No DOM, so tests can use it too.

import { compileArena } from './arena.js';

// The robot centre counts as "on the line" within this distance of the tape.
// The sensors sit ahead of the centre, so a clean follower still cuts corners a little.
export const ON_LINE_MM = 30;

// Per-arena challenges. A tier is met when the run is at least that fast and,
// where given, keeps acc of its time on the line and touches walls at most hits times.
export const challenges = {
  oval: {
    title: 'Clean lap', kind: 'line',
    goal: 'One lap of the oval without wandering off the tape.',
    gold: { t: 15, acc: 0.9 }, silver: { t: 19, acc: 0.75 }, bronze: { t: 30 },
  },
  snake: {
    title: 'Snake charmer', kind: 'line',
    goal: 'Get through the S-curves without wobbling wide.',
    gold: { t: 7, acc: 0.9 }, silver: { t: 10, acc: 0.75 }, bronze: { t: 18 },
  },
  corners: {
    title: 'Square dance', kind: 'line',
    goal: 'Take all six right angles and reach the far corner.',
    gold: { t: 12, acc: 0.85 }, silver: { t: 17, acc: 0.7 }, bronze: { t: 30 },
  },
  maze: {
    title: 'Way out', kind: 'maze',
    goal: 'Find the exit of the maze, touching the walls as little as you can.',
    gold: { t: 32, hits: 0 }, silver: { t: 46, hits: 2 }, bronze: { t: 80 },
  },
  pickup: {
    title: 'Special delivery', kind: 'grab',
    goal: 'Grab the can and drop it in the green zone, fast.',
    gold: { t: 8 }, silver: { t: 12 }, bronze: { t: 25 },
  },
};

export const TIERS = ['bronze', 'silver', 'gold'];

const meets = (tier, s) => s.lapTime <= tier.t
  && (tier.acc === undefined || (s.accuracy ?? 0) >= tier.acc)
  && (tier.hits === undefined || s.collisions <= tier.hits);

// Arenas without a challenge: finishing is worth one star
export function starsFor(arenaId, s) {
  if (!s.passed) return 0;
  const c = challenges[arenaId];
  if (!c) return 1;
  let stars = 0;
  for (const k of TIERS) { if (!meets(c[k], s)) break; stars++; }
  return stars;
}

export function scoreRun({ sim, arena = sim.arena }) {
  const st = sim.state;
  const passed = !!st.result && st.result.status === 'pass';
  const lapTime = passed ? st.result.t : null;

  const world = sim.world || compileArena(arena);
  let accuracy = null;
  if (world.segs.length && st.samples.length) {
    const on = st.samples.filter(p => world.lineDistance(p.x, p.y) <= ON_LINE_MM).length;
    accuracy = on / st.samples.length;
  }
  const collisions = st.events.filter(e => e.kind === 'wall').length;

  const c = challenges[arena.id];
  const s = { passed, lapTime, accuracy, collisions };
  const stars = starsFor(arena.id, s);
  const ref = c ? c.bronze.t : 60;
  const points = passed ? Math.max(0, Math.round((1000 * ref) / Math.max(lapTime, 0.1) * (accuracy ?? 1)) - 100 * collisions) : 0;
  return { ...s, stars, points };
}
