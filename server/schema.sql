-- Safe to run more than once: `npm run db:setup` runs it against DATABASE_URL,
-- and the dev server runs it on its local database at every start.

create table if not exists users (
  id integer generated always as identity primary key,
  email text unique,               -- lower case; null for a GitHub account with no verified email
  name text not null,
  password_hash text,              -- null when the account only signs in with Google, GitHub or Apple
  created_at timestamptz not null default now()
);

-- One row per outside sign-in linked to a user
create table if not exists identities (
  provider text not null,
  subject text not null,
  user_id integer not null references users(id) on delete cascade,
  primary key (provider, subject)
);

-- The cookie holds a random token; only its sha256 is stored here
create table if not exists sessions (
  token_hash text primary key,
  user_id integer not null references users(id) on delete cascade,
  expires_at timestamptz not null
);
create index if not exists sessions_user on sessions (user_id);

create table if not exists password_resets (
  token_hash text primary key,
  user_id integer not null references users(id) on delete cascade,
  expires_at timestamptz not null
);

-- Wrong passwords and reset requests, for slowing down guessing and mail spam
create table if not exists attempts (
  key text not null,
  at timestamptz not null default now()
);
create index if not exists attempts_key on attempts (key, at);

create table if not exists projects (
  id integer generated always as identity primary key,
  user_id integer not null references users(id) on delete cascade,
  name text not null,
  kind text not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists projects_user on projects (user_id, updated_at desc);

-- Best challenge run per user and arena
create table if not exists bests (
  user_id integer not null references users(id) on delete cascade,
  arena text not null,
  stars smallint not null,
  lap_time real not null,
  accuracy real,
  collisions integer not null default 0,
  at timestamptz not null default now(),
  primary key (user_id, arena)
);
create index if not exists bests_board on bests (arena, stars desc, lap_time);
