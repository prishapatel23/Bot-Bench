// npm run db:setup: creates the tables in the database DATABASE_URL points at.
// Vercel runs it before every build, so a new table or column goes live with the deploy.
// Reads .env if there is one, so it works the same as the dev server.

import { readFileSync, existsSync } from 'node:fs';
import { query } from './db.js';

if (existsSync('.env')) process.loadEnvFile('.env');

if (!process.env.DATABASE_URL) {
  console.log('No DATABASE_URL, so no tables to set up. Accounts will not work on this deploy.');
  process.exit(0);
}

await query(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
console.log('Tables are ready.');
process.exit(0);
