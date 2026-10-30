// Log in, sign up and reset password pages. Each page has one or two forms with
// data-api="login" and so on; they post to /api/auth/<that> and move on to ?next=.

const params = new URLSearchParams(location.search);
const raw = params.get('next');
const next = raw && /^\/(?![/\\])/.test(raw) ? raw : '/studio';

// Carry ?next= over to the other page and to the Google/GitHub/Apple links
for (const a of document.querySelectorAll('[data-keep-next]')) if (raw) a.search = `?next=${encodeURIComponent(next)}`;
for (const a of document.querySelectorAll('[data-provider]')) a.search = `?next=${encodeURIComponent(next)}`;

function showError(form, message) {
  const box = form.querySelector('.form-error');
  box.textContent = message;
  box.hidden = !message;
}

// Coming back from a failed Google/GitHub/Apple sign-in
const firstForm = document.querySelector('form[data-api]');
if (params.get('error') && firstForm) showError(firstForm, params.get('error'));

fetch('/api/auth/me')
  .then(res => (res.ok ? res.json() : null))
  .then(me => {
    if (!me) return;
    if (me.user && !document.getElementById('reset-form')) { location.replace(next); return; }
    let any = false;
    for (const a of document.querySelectorAll('[data-provider]')) {
      a.hidden = !me.providers.includes(a.dataset.provider);
      any ||= !a.hidden;
    }
    for (const id of ['social', 'or']) {
      const el = document.getElementById(id);
      if (el) el.hidden = !any;
    }
  })
  .catch(() => { /* offline: the email form still shows */ });

async function submit(form) {
  const body = Object.fromEntries(new FormData(form));
  if (form.dataset.api === 'reset') body.token = params.get('token') || '';
  const res = await fetch(`/api/auth/${form.dataset.api}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'That didn\'t work. Check your connection and try again.');
  return data;
}

for (const form of document.querySelectorAll('form[data-api]')) {
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const button = form.querySelector('[type="submit"]');
    showError(form, '');
    button.disabled = true;
    try {
      await submit(form);
      if (form.dataset.api === 'forgot') {
        form.querySelector('.form-note').hidden = false;
        button.hidden = true;
        return;
      }
      location.assign(next);
    } catch (err) {
      showError(form, err.message === 'Failed to fetch' ? 'You look to be offline. Try again when you\'re connected.' : err.message);
    } finally {
      button.disabled = false;
    }
  });
}

// "Forgot it?" swaps the login form for the reset-link form, keeping the email typed so far
const login = document.getElementById('login-form');
const forgot = document.getElementById('forgot-form');
if (forgot) {
  const swap = toForgot => {
    login.hidden = toForgot;
    forgot.hidden = !toForgot;
    const from = toForgot ? login : forgot;
    const to = toForgot ? forgot : login;
    to.elements.email.value ||= from.elements.email.value;
    to.elements.email.focus();
  };
  document.getElementById('show-forgot').addEventListener('click', () => swap(true));
  document.getElementById('hide-forgot').addEventListener('click', () => swap(false));
}

if (document.getElementById('reset-form') && !params.get('token')) {
  showError(document.getElementById('reset-form'), 'This page needs the link from the reset email. Ask for a new one from the log in page.');
}
