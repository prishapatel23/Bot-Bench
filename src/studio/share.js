// Share a whole project in the URL hash: #p=<deflated JSON, base64url>.
// encode/decode have no DOM in them so tests can run them under Node.

import { presets, presetById } from '../engine/arena.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function toBase64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(text) {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}

export async function encodeProject(project) {
  const p = { ...project };
  // An untouched ready-made arena only needs its id
  if (presets.some(x => x.id === p.arena.id) && same(p.arena, presetById(p.arena.id))) p.arena = p.arena.id;
  const bytes = new TextEncoder().encode(JSON.stringify(p));
  return toBase64url(await pipe(bytes, new CompressionStream('deflate-raw')));
}

export async function decodeProject(text) {
  const json = new TextDecoder().decode(await pipe(fromBase64url(text), new DecompressionStream('deflate-raw')));
  const p = JSON.parse(json);
  if (p && typeof p.arena === 'string') p.arena = presetById(p.arena);
  // store.replace checks the top level; a link can come from anywhere, so look one level down too
  const ok = p && p.robot && Array.isArray(p.robot.sensors) && p.arena &&
    ['lines', 'walls', 'objects'].every(k => Array.isArray(p.arena[k])) &&
    p.arena.start && Number.isFinite(p.arena.start.x) && Number.isFinite(p.arena.start.y);
  if (!ok) throw new Error('That link is not a BotBench project.');
  return p;
}

export const linkFor = (hash, loc = location) => `${loc.origin}${loc.pathname}#p=${hash}`;

// ---------- page side ----------

const $ = id => document.getElementById(id);
let popTimer = 0;

function showPop(text, link) {
  const pop = $('share-pop');
  pop.hidden = false;
  $('share-pop-text').textContent = text;
  const input = $('share-link');
  input.hidden = !link;
  if (link) input.value = link;
  if (link) { input.focus(); input.select(); }
  clearTimeout(popTimer);
  if (!link) popTimer = setTimeout(() => { pop.hidden = true; }, 2200);
}

function askToOpen() {
  const dlg = $('share-ask');
  return new Promise(resolve => {
    const done = ok => { dlg.close(); resolve(ok); };
    $('share-ask-open').onclick = () => done(true);
    $('share-ask-keep').onclick = () => done(false);
    $('share-ask-export').onclick = () => $('btn-export').click();
    dlg.oncancel = () => resolve(false);
    dlg.showModal();
  });
}

export function initShare(store) {
  $('btn-share').addEventListener('click', async () => {
    let link;
    try { link = linkFor(await encodeProject(store.project)); } catch { showPop('This browser cannot make share links.'); return; }
    try {
      await navigator.clipboard.writeText(link);
      showPop('Link copied');
    } catch {
      showPop('Copy this link:', link);
    }
  });
  addEventListener('pointerdown', e => {
    if (!e.target.closest('#share-pop, #btn-share')) $('share-pop').hidden = true;
  });
  $('share-pop').addEventListener('keydown', e => {
    if (e.key === 'Escape') { $('share-pop').hidden = true; $('btn-share').focus(); }
  });
}

// Open a #p= link if the page was loaded with one. Resolves to true when
// there was a link, whether or not it was opened.
export async function openSharedLink({ store, freshProject }) {
  const m = location.hash.match(/^#p=([\w-]+)/);
  if (!m) return false;
  history.replaceState(null, '', location.pathname + location.search);
  let shared;
  try { shared = await decodeProject(m[1]); } catch {
    showPop('That share link is broken or cut short.');
    return true;
  }
  const cur = store.project;
  const untouched = same(cur, freshProject(cur.kind, cur.robot.name)) || same(cur, shared);
  if (untouched || await askToOpen()) {
    try { store.replace(shared); } catch (err) { showPop(err.message); }
  }
  return true;
}
