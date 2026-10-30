// The optional account: the Log in button, "Your robots" saved to the account,
// and the challenge boards. Without the api (offline, or a plain static host)
// the button stays hidden and the Studio works exactly as before.

import { store } from './store.js';
import { setIcon } from '../ui/icons.js';

const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids) n.append(k);
  return n;
};

const CLOUD_KEY = 'botbench.cloudId';

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body && JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Couldn\'t reach BotBench. Check your connection.');
  return data;
}

let user = null;

// Resolves to the logged-in user, or null when nobody is or there's no api
export const whenUser = fetch('/api/auth/me')
  .then(res => (res.ok && res.headers.get('content-type')?.includes('json') ? res.json() : null))
  .then(me => {
    if (me) $('btn-account').hidden = false;
    user = me?.user || null;
    return user;
  })
  .catch(() => null);

export function uploadBests(scores) {
  whenUser.then(u => {
    if (u && scores.length) api('/api/bests', { method: 'POST', body: { scores } }).catch(() => { /* next time */ });
  });
}

export const loadBoards = () => whenUser.then(() => api('/api/bests')).then(d => d.boards).catch(() => null);

// ---------- which saved robot the open project is ----------

const cloudId = () => { try { return Number(localStorage.getItem(CLOUD_KEY)) || null; } catch { return null; } };
function setCloudId(id) {
  try { id ? localStorage.setItem(CLOUD_KEY, id) : localStorage.removeItem(CLOUD_KEY); } catch { /* fine for this visit */ }
}
// A new, shared or imported project is a different robot
store.on('project', () => setCloudId(null));

// ---------- Your robots dialog ----------

const kindName = { line: 'Line follower', maze: 'Maze solver', grab: 'Grabber', avoid: 'Obstacle avoider', sumo: 'Sumo' };
const when = iso => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function status(text) {
  $('cloud-status').textContent = text;
}

async function renderList() {
  const list = $('cloud-list');
  let projects;
  try {
    ({ projects } = await api('/api/projects'));
  } catch (err) {
    status(err.message);
    return;
  }
  $('cloud-empty').hidden = projects.length > 0;
  list.replaceChildren(...projects.map(p => {
    const open = el('button', { className: 'btn small', type: 'button', textContent: 'Open' });
    const del = el('button', { className: 'btn quiet small icon-only', type: 'button', ariaLabel: `Delete ${p.name}`, title: 'Delete' });
    setIcon(del, 'trash');
    open.addEventListener('click', () => openProject(p));
    del.addEventListener('click', () => deleteProject(p));
    return el('li', { className: p.id === cloudId() ? 'current' : '' },
      el('div', { className: 'cloud-name' },
        el('b', { textContent: p.name }),
        el('span', { textContent: `${kindName[p.kind] || p.kind} · ${when(p.updatedAt)}${p.id === cloudId() ? ' · open now' : ''}` })),
      open, del);
  }));
}

async function openProject(p) {
  if (p.id !== cloudId() && !confirm(`Open "${p.name}"? It replaces the robot you have open now.`)) return;
  try {
    const { project } = await api(`/api/projects?id=${p.id}`);
    store.replace(project);
    setCloudId(p.id);
    $('account-dialog').close();
  } catch (err) {
    status(err.message);
  }
}

async function deleteProject(p) {
  if (!confirm(`Delete "${p.name}" from your account? This can't be undone.`)) return;
  try {
    await api(`/api/projects?id=${p.id}`, { method: 'DELETE' });
    if (p.id === cloudId()) setCloudId(null);
    status(`Deleted ${p.name}.`);
    renderList();
  } catch (err) {
    status(err.message);
  }
}

async function saveProject() {
  const button = $('cloud-save');
  button.disabled = true;
  try {
    const { id } = await api('/api/projects', { method: 'POST', body: { id: cloudId(), project: store.project } });
    setCloudId(id);
    status(`Saved ${store.project.robot.name}.`);
    renderList();
  } catch (err) {
    status(err.message);
  } finally {
    button.disabled = false;
  }
}

export function initAccount() {
  whenUser.then(u => {
    const button = $('btn-account');
    if (!u) return;
    button.querySelector('.label').textContent = u.name.split(' ')[0];
    button.title = 'Your robots and account';
    button.removeAttribute('href');
    button.setAttribute('role', 'button');
    button.tabIndex = 0;
    const show = () => {
      $('account-who').textContent = `Logged in as ${u.name}${u.email ? ` (${u.email})` : ''}.`;
      status('');
      renderList();
      $('account-dialog').showModal();
    };
    button.addEventListener('click', show);
    button.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(); } });
  });

  $('cloud-save').addEventListener('click', saveProject);
  $('account-close').addEventListener('click', () => $('account-dialog').close());
  $('account-logout').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {});
    setCloudId(null);
    location.reload();
  });
}
