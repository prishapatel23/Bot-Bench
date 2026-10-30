// Loads the real pages in a headless browser and drives one full run.
// Run with: npm run test:ui  (uses the Edge or Chrome already on this machine)
import { existsSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const browsers = [
  process.env.CHROME_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const executablePath = browsers.find(p => existsSync(p));
if (!executablePath) {
  console.log('No Chrome or Edge found. Set CHROME_PATH to run the UI checks.');
  process.exit(0);
}

// Accounts get a throwaway database, not the dev one in .data/
process.env.PGLITE_DIR = 'memory://';
delete process.env.DATABASE_URL;

const server = await createServer({ server: { port: 0 }, logLevel: 'error' });
await server.listen();
const base = server.resolvedUrls.local[0].replace(/\/$/, '');
const browser = await chromium.launch({ executablePath });

let failed = 0;
async function check(name, fn) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  try {
    await fn(page);
    if (errors.length) throw new Error('console errors:\n' + errors.join('\n'));
    console.log('  ok   ' + name);
  } catch (err) {
    failed++;
    console.log('  FAIL ' + name + '\n       ' + err.message.split('\n').join('\n       '));
  } finally {
    await page.close();
  }
}

// first visit shows the tour; mark it seen so the checks start from a plain studio
const skipTour = page => page.addInitScript(() => { try { localStorage.setItem('botbench.toured', '1'); } catch {} });

console.log('pages');
await check('landing page loads', async page => {
  await page.goto(base + '/');
  await page.waitForSelector('h1');
});

await check('studio runs the starter sketch to a result', async page => {
  await skipTour(page);
  await page.goto(base + '/studio.html');
  await page.click('#tab-btn-run');
  await page.waitForSelector('#editor .cm-content', { timeout: 15000 });
  await page.click('#btn-skip');
  await page.waitForFunction(() => document.getElementById('sim-status').textContent.trim().length > 0, null, { timeout: 15000 });
  const coach = await page.textContent('#dock-coach');
  if (!coach.trim()) throw new Error('coach panel stayed empty after the run');
});

await check('every robot kind builds a preview', async page => {
  await skipTour(page);
  await page.goto(base + '/studio.html');
  await page.click('#tab-btn-robot');
  for (const btn of await page.$$('#kind-seg button')) {
    await btn.click();
    const rows = await page.$$('#pin-rows tr');
    if (!rows.length) throw new Error('no pin rows after picking ' + await btn.textContent());
  }
});

await check('first visit starts the tour and Esc skips it', async page => {
  await page.goto(base + '/studio.html');
  await page.waitForSelector('.tour-card', { state: 'visible', timeout: 10000 });
  await page.keyboard.press('Escape');
  await page.waitForSelector('.tour-card', { state: 'hidden', timeout: 5000 });
});

await check('a share link opens the same robot in a fresh browser', async page => {
  await skipTour(page);
  await page.goto(base + '/studio.html');
  const hash = await page.evaluate(async () => {
    const { encodeProject } = await import('/src/studio/share.js');
    const { freshProject } = await import('/src/studio/store.js');
    return encodeProject(freshProject('maze', 'Link test bot'));
  });
  const other = await browser.newPage();
  await skipTour(other);
  await other.goto(base + '/studio.html#p=' + hash);
  await other.waitForFunction(() => document.getElementById('project-name').value === 'Link test bot', null, { timeout: 10000 });
  await other.close();
});

await check('dark mode toggle switches the theme', async page => {
  await skipTour(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(base + '/studio.html');
  await page.click('#btn-theme');
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  if (theme !== 'dark') throw new Error('data-theme is ' + theme);
});

await check('studio fits a phone screen', async page => {
  await skipTour(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(base + '/studio.html');
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  if (wide > 1) throw new Error(`page scrolls sideways by ${wide}px`);
});

console.log('accounts');
await check('sign up, land in the studio, save a robot to the account', async page => {
  await skipTour(page);
  await page.goto(base + '/signup?next=/studio');
  await page.fill('input[name="name"]', 'Smoke Test');
  await page.fill('input[name="email"]', 'smoke@example.com');
  await page.fill('input[name="password"]', 'smoke-test-pass');
  await page.click('button[type="submit"]');
  await page.waitForURL(url => url.pathname === '/studio');
  await page.waitForFunction(() => !document.getElementById('btn-account').hidden);
  const label = await page.textContent('#btn-account .label');
  if (label !== 'Smoke') throw new Error('account button says ' + label);
  await page.click('#btn-account');
  await page.click('#cloud-save');
  await page.waitForSelector('#cloud-list li');
  await page.click('#account-logout');
  await page.waitForFunction(() => document.querySelector('#btn-account .label').textContent === 'Log in');
});

await check('log in page shows a wrong password', async page => {
  page.removeAllListeners('console'); // the browser logs the 401 itself as an error
  await page.goto(base + '/login');
  await page.fill('#login-form input[name="email"]', 'smoke@example.com');
  await page.fill('#login-form input[name="password"]', 'not the password');
  await page.click('#login-form button[type="submit"]');
  await page.waitForSelector('#login-form .form-error:not([hidden])');
});

await browser.close();
await server.close();
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
