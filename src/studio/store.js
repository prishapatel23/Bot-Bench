// Project state, saved to this browser only.

import { defaultRobot } from '../engine/parts.js';
import { presetById } from '../engine/arena.js';
import { starterFor } from '../engine/examples.js';

const PROJECT_KEY = 'botbench.project';
const ARENAS_KEY = 'botbench.arenas';

export const defaultArenaFor = { line: 'oval', maze: 'maze', grab: 'pickup', avoid: 'room', sumo: 'dohyo' };

function read(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode or full: keep working in memory */ }
}

export function freshProject(kind = 'line', name = 'My robot') {
  const robot = defaultRobot(kind);
  robot.name = name;
  return {
    version: 1,
    kind,
    robot,
    arena: presetById(defaultArenaFor[kind]),
    code: starterFor(robot, kind),
  };
}

function valid(p) {
  return p && p.version === 1 && p.robot && p.arena && typeof p.code === 'string' && Object.hasOwn(defaultArenaFor, p.kind);
}

const listeners = new Map();

export const store = {
  project: valid(read(PROJECT_KEY)) ? read(PROJECT_KEY) : freshProject(),
  arenas: Array.isArray(read(ARENAS_KEY)) ? read(ARENAS_KEY) : [],

  on(what, fn) {
    if (!listeners.has(what)) listeners.set(what, new Set());
    listeners.get(what).add(fn);
  },
  // what: 'robot' | 'arena' | 'code' | 'project'
  changed(what, detail) {
    for (const fn of listeners.get(what) || []) fn(detail);
    if (what === 'project') for (const k of ['robot', 'arena', 'code']) for (const fn of listeners.get(k) || []) fn(detail);
    this.saveSoon();
  },

  replace(project) {
    if (!valid(project)) throw new Error('That file is not a BotBench project.');
    this.project = project;
    this.changed('project');
  },

  saveArena(arena) {
    const i = this.arenas.findIndex(a => a.id === arena.id);
    if (i >= 0) this.arenas[i] = structuredClone(arena);
    else this.arenas.push(structuredClone(arena));
    write(ARENAS_KEY, this.arenas);
  },
  deleteArena(id) {
    this.arenas = this.arenas.filter(a => a.id !== id);
    write(ARENAS_KEY, this.arenas);
  },

  timer: 0,
  saveSoon() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => write(PROJECT_KEY, this.project), 300);
  },
};

addEventListener('beforeunload', () => write(PROJECT_KEY, store.project));
