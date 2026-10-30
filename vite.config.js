import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const page = name => fileURLToPath(new URL(name, import.meta.url));

// Writes the list of built files and a build id into dist/sw.js, so the service
// worker can precache the app shell and a new deploy gets a new cache.
function offlineShell() {
  let outDir, files = [];
  return {
    name: 'offline-shell',
    apply: 'build',
    enforce: 'post', // after the HTML pages have been added to the bundle
    configResolved(config) { outDir = resolve(config.root, config.build.outDir); },
    generateBundle(_, bundle) {
      files = Object.values(bundle).map(f => [f.fileName, f.type === 'chunk' ? f.code : f.source]);
    },
    closeBundle() {
      const pages = { 'index.html': '/', 'studio.html': '/studio' };
      // Latin-only woff2: fontsource also ships cyrillic, greek, vietnamese and woff copies
      const keep = name => pages[name] || /^assets\/.*\.(js|css|svg|png)$/.test(name) || /^assets\/.*-latin-\d+-normal-.*\.woff2$/.test(name);
      const shell = files.map(([name]) => name).filter(keep).map(name => pages[name] || '/' + name).sort();
      shell.push('/favicon.svg', '/manifest.webmanifest', '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png');
      const hash = createHash('sha1');
      for (const [name, body] of files) hash.update(name).update(body);
      const swPath = resolve(outDir, 'sw.js');
      const sw = readFileSync(swPath, 'utf8')
        .replace(/const VERSION = .*;/, `const VERSION = '${hash.digest('hex').slice(0, 10)}';`)
        .replace(/const SHELL = .*;/, `const SHELL = ${JSON.stringify(shell)};`);
      writeFileSync(swPath, sw);
    },
  };
}

// Runs the api/ routes inside `npm run dev`, the way Vercel runs them in production,
// and serves /studio, /login and friends without .html like Vercel's cleanUrls.
// With no DATABASE_URL in .env the routes get a local Postgres (PGlite) kept in .data/.
function devApi() {
  return {
    name: 'dev-api',
    apply: 'serve',
    async configureServer(server) {
      const root = server.config.root;
      for (const [k, v] of Object.entries(loadEnv(server.config.mode, root, ''))) process.env[k] ??= v;

      let local = null;
      if (!process.env.DATABASE_URL) {
        const { PGlite } = await import('@electric-sql/pglite');
        const dir = process.env.PGLITE_DIR || resolve(root, '.data/pg');
        if (!dir.includes('://')) mkdirSync(dir, { recursive: true });
        const db = new PGlite(dir);
        await db.exec(readFileSync(resolve(root, 'server/schema.sql'), 'utf8'));
        local = (text, params) => db.query(text, params);
      }

      const routes = readdirSync(resolve(root, 'api'), { recursive: true })
        .filter(f => f.endsWith('.js'))
        .map(f => {
          const file = '/api/' + f.replace(/\\/g, '/');
          const names = [];
          const pattern = file.slice(0, -3).replace(/\[(\w+)\]/g, (_, name) => { names.push(name); return '([^/]+)'; });
          return { file, names, re: new RegExp(`^${pattern}$`) };
        });
      const pages = new Set(['studio', 'login', 'signup', 'reset']);

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost');
        const page = url.pathname.slice(1);
        if (pages.has(page)) { req.url = `/${page}.html${url.search}`; return next(); }

        const hit = routes.find(r => r.re.test(url.pathname));
        if (!hit) return next();
        try {
          const match = url.pathname.match(hit.re);
          req.query = Object.fromEntries(url.searchParams);
          hit.names.forEach((name, i) => { req.query[name] = decodeURIComponent(match[i + 1]); });
          if (local) (await server.ssrLoadModule('/server/db.js')).useDatabase(local);
          await (await server.ssrLoadModule(hit.file)).default(req, res);
        } catch (err) {
          next(err);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [offlineShell(), devApi()],
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      input: {
        main: page('./index.html'),
        studio: page('./studio.html'),
        notFound: page('./404.html'),
        login: page('./login.html'),
        signup: page('./signup.html'),
        reset: page('./reset.html'),
      },
    },
  },
});
