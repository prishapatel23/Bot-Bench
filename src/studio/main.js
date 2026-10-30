import { store, freshProject } from './store.js';
import { initRobot } from './robot.js';
import { initArena } from './arena.js';
import { initRun } from './run.js';
import { applyIcons, setIcon } from '../ui/icons.js';
import { usePalette } from '../ui/draw.js';
import { initShare, openSharedLink } from './share.js';
import { initTour, startTour } from './tour.js';
import { initAccount } from './account.js';
import '../ui/offline.js';

applyIcons();

// ---------- tabs ----------

const tabs = [...document.querySelectorAll('.tabs [role="tab"]')];
const listeners = [];
export function onTab(fn) { listeners.push(fn); }

function select(tab) {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute('aria-selected', on);
    t.tabIndex = on ? 0 : -1;
    const panel = document.getElementById(t.getAttribute('aria-controls'));
    if (on && panel.hidden) {
      panel.classList.remove('enter');
      void panel.offsetWidth;
      panel.classList.add('enter');
    }
    panel.hidden = !on;
  }
  const id = tab.getAttribute('aria-controls');
  try { sessionStorage.setItem('botbench.tab', id); } catch { /* ignore */ }
  listeners.forEach(fn => fn(id));
}

tabs.forEach(t => t.addEventListener('click', () => select(t)));

// Arrow keys, Home and End move between tabs; only the selected one is in
// the Tab order. Clicking does the selecting, so this works for any tablist.
function rove(list) {
  const items = () => [...list.querySelectorAll('[role="tab"]')];
  const sync = () => items().forEach(t => { t.tabIndex = t.getAttribute('aria-selected') === 'true' ? 0 : -1; });
  new MutationObserver(sync).observe(list, { subtree: true, childList: true, attributeFilter: ['aria-selected'] });
  sync();
  list.addEventListener('keydown', e => {
    const all = items();
    const i = all.indexOf(document.activeElement);
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: all.length - 1 }[e.key];
    if (i < 0 || to === undefined) return;
    e.preventDefault();
    const next = all[(to + all.length) % all.length];
    next.focus();
    next.click();
  });
}
document.querySelectorAll('[role="tablist"]').forEach(rove);

// ---------- name, import, export ----------

const nameInput = document.getElementById('project-name');
nameInput.value = store.project.robot.name;
nameInput.addEventListener('input', () => {
  store.project.robot.name = nameInput.value || 'My robot';
  store.saveSoon();
});
store.on('project', () => { nameInput.value = store.project.robot.name; });

document.getElementById('btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(store.project, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(store.project.robot.name || 'robot').replace(/[^\w-]+/g, '-').toLowerCase()}.botbench.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

document.getElementById('file-import').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    store.replace(JSON.parse(await file.text()));
  } catch (err) {
    alert(err.message.startsWith('That file') ? err.message : 'That file could not be read as a BotBench project.');
  }
});

// ---------- mini Pip ----------

const pip = document.getElementById('mini-pip');
export function pipMood(mood) {
  pip.classList.remove('happy', 'sad', 'busy');
  if (mood) pip.classList.add(mood);
}
(function blink() {
  setTimeout(() => {
    pip.classList.add('blink');
    setTimeout(() => pip.classList.remove('blink'), 110);
    blink();
  }, 2500 + Math.random() * 3500);
})();

// ---------- theme ----------

const root = document.documentElement;
const systemDark = matchMedia('(prefers-color-scheme: dark)');
const savedTheme = () => { try { return localStorage.getItem('botbench.theme'); } catch { return null; } };

function applyTheme(theme = savedTheme() || (systemDark.matches ? 'dark' : 'light')) {
  const dark = theme === 'dark';
  root.dataset.theme = theme;
  usePalette(dark);
  const b = document.getElementById('btn-theme');
  b.setAttribute('aria-pressed', dark);
  b.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
  setIcon(b, dark ? 'sun' : 'moon');
  document.querySelector('meta[name="theme-color"]').content = dark ? '#0f3341' : '#1c5a70';
}
document.getElementById('btn-theme').addEventListener('click', () => {
  const theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('botbench.theme', theme); } catch { /* still switches for this visit */ }
  applyTheme(theme);
});
systemDark.addEventListener('change', () => { if (!savedTheme()) applyTheme(); });
applyTheme();

// ---------- canvas descriptions ----------

// The arena canvas can be focused and its start moved with the keys, so say where it is
function describeStart() {
  const s = store.project.arena.start;
  const deg = Math.round(((s.a * 180) / Math.PI % 360 + 360) % 360);
  const text = `The robot starts ${Math.round(s.x)} mm from the left and ${Math.round(s.y)} mm from the top, facing ${deg} degrees.`;
  const desc = document.getElementById('arena-desc');
  if (desc.textContent !== text) desc.textContent = text;
}
store.on('arena', describeStart);
describeStart();

// ---------- start ----------

export function switchKind(kind) {
  const name = store.project.robot.name;
  store.replace(freshProject(kind, name));
}

initRobot();
initArena();
initRun();
initShare(store);
initAccount();
const firstVisit = initTour({ store, selectTab: id => select(tabs.find(t => t.getAttribute('aria-controls') === id)) });

let start = 'tab-robot';
try { start = sessionStorage.getItem('botbench.tab') || start; } catch { /* ignore */ }
select(tabs.find(t => t.getAttribute('aria-controls') === start) || tabs[0]);
requestAnimationFrame(() => document.documentElement.classList.add('ready'));

// A shared link wins over the tour: the tour would swap the shared code for its own
openSharedLink({ store, freshProject }).then(shared => { if (firstVisit && !shared) startTour(); });
addEventListener('hashchange', () => openSharedLink({ store, freshProject }));
