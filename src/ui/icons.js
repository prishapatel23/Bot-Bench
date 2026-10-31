// Small line icons, 24 × 24, drawn with currentColor.

const wrap = body => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const icons = {
  robot: wrap('<rect x="5" y="7" width="14" height="11" rx="3"/><path d="M12 3v4M9 12h.01M15 12h.01M9 21h6"/>'),
  map: wrap('<path d="M4 6l5-2 6 2 5-2v14l-5 2-6-2-5 2z"/><path d="M9 4v14M15 6v14"/>'),
  code: wrap('<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13 6l-2 12"/>'),
  play: wrap('<path d="M7 5v14l11-7z" fill="currentColor" stroke="none"/>'),
  pause: wrap('<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>'),
  skip: wrap('<path d="M5 5v14l9-7zM18 5v14"/>'),
  reset: wrap('<path d="M4 12a8 8 0 1 0 2.5-5.8"/><path d="M4 4v4h4"/>'),
  tape: wrap('<path d="M4 18c3-8 6 4 9-3s4-6 7-7"/>'),
  straight: wrap('<path d="M5 19L19 5"/><circle cx="5" cy="19" r="1.5" fill="currentColor"/><circle cx="19" cy="5" r="1.5" fill="currentColor"/>'),
  wall: wrap('<rect x="3" y="6" width="18" height="12" rx="1"/><path d="M3 12h18M9 6v6M15 12v6"/>'),
  erase: wrap('<path d="M16 4l4 4-10 10H6l-2-2z"/><path d="M12 8l4 4M6 20h14"/>'),
  start: wrap('<circle cx="10" cy="12" r="5"/><path d="M15 12h6M18 9l3 3-3 3"/>'),
  finish: wrap('<path d="M5 21V4M5 4h12l-2 4 2 4H5"/>'),
  can: wrap('<ellipse cx="12" cy="6" rx="6" ry="2.5"/><path d="M6 6v12c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V6"/>'),
  undo: wrap('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
  trash: wrap('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  download: wrap('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  upload: wrap('<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>'),
  plus: wrap('<path d="M12 5v14M5 12h14"/>'),
  check: wrap('<path d="M5 12l5 5 9-10"/>'),
  alert: wrap('<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17h.01"/>'),
  stop: wrap('<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16h.01"/>'),
  bulb: wrap('<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z"/>'),
  target: wrap('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  compare: wrap('<path d="M8 4v16M16 4v16M4 8h4M16 16h4M4 16h4M16 8h4"/>'),
  save: wrap('<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>'),
  line: wrap('<path d="M3 17c4-8 7 2 10-4s5-6 8-6"/><circle cx="13" cy="13" r="2.5" fill="currentColor"/>'),
  maze: wrap('<path d="M3 3h18v18H3zM8 3v10M13 8v13M8 13h5M17 3v8"/>'),
  grab: wrap('<path d="M4 9h6l4-3h3M4 15h6l4 3h3"/><circle cx="19" cy="12" r="2"/>'),
  avoid: wrap('<rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M3 9c4 0 6 2 7 4s3 4 11 4"/>'),
  sumo: wrap('<circle cx="12" cy="12" r="9"/><circle cx="9" cy="12" r="2.5"/><circle cx="15" cy="12" r="2.5" fill="currentColor"/>'),
  share: wrap('<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 10.9l7.6-3.8M8.2 13.1l7.6 3.8"/>'),
  sun: wrap('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: wrap('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'),
  user: wrap('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>'),
  cloud: wrap('<path d="M7 18a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.5 1.5A3.8 3.8 0 0 1 17.5 18z"/>'),
  more: wrap('<circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none"/>'),
  help: wrap('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.4M12 17h.01"/>'),
};

// Put an icon in front of a button's text, or swap it.
export function setIcon(el, name, label) {
  const old = el.querySelector(':scope > .icon');
  if (old) old.remove();
  el.insertAdjacentHTML('afterbegin', icons[name] || '');
  if (label !== undefined) {
    let span = el.querySelector(':scope > .label');
    if (!span) {
      span = document.createElement('span');
      span.className = 'label';
      [...el.childNodes].forEach(n => { if (n.nodeType === 3) n.remove(); });
      el.append(span);
    }
    span.textContent = label;
  }
}

// Every element with data-icon gets its icon on load
export function applyIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) setIcon(el, el.dataset.icon);
}
