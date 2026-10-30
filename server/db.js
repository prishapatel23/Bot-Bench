// Postgres access for the api/ routes. Everything goes through query(), so the
// dev server and the tests can swap in a local database with useDatabase().

import pg from 'pg';

let pool = null;
let local = null;

export function useDatabase(fn) {
  local = fn;
}

export async function query(text, params = []) {
  if (local) return local(text, params);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  // A serverless function only handles one request at a time, so a few connections is plenty
  pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  return pool.query(text, params);
}
