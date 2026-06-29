-- =====================================================================
--  Golf game — Supabase schema (leaderboard + accounts + tournaments)
--  Run this whole file in the Supabase SQL editor (one shot).
--  Matches the REST calls in game.js (rounds, profiles, tournaments,
--  tournament_rounds). Anon key is public; RLS below is what protects data.
-- =====================================================================

-- ---------- PROFILES: one row per account (id = auth.uid()) ----------
create table if not exists profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  is_admin     boolean not null default false,
  created_at   timestamptz default now()
);

alter table profiles enable row level security;

-- anyone may read display names (leaderboard shows them)
create policy "profiles read"   on profiles for select using (true);
-- a user may create only their own profile row
create policy "profiles insert" on profiles for insert with check (auth.uid() = id);
-- a user may edit only their own row (and cannot grant themselves admin:
-- is_admin is left out of client PATCHes; flip it manually in the dashboard)
create policy "profiles update" on profiles for update using (auth.uid() = id);

-- ---------- ROUNDS: regular leaderboard, one row per finished round ----------
create table if not exists rounds (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,          -- display name at time of submit
  user_id     uuid references auth.users(id) on delete set null,  -- null for guests
  course_id   text not null,
  hole_count  int,
  strokes     int,
  to_par      int,
  putts       int,
  gir         int,                    -- greens in regulation
  fir         int,                    -- fairways hit
  fir_holes   int,                    -- fairways attempted (denominator)
  prox_ft     int,                    -- avg approach proximity, feet
  created_at  timestamptz default now()
);

alter table rounds enable row level security;

create policy "rounds read"  on rounds for select using (true);
-- guests may post (user_id null); logged-in posts must own their user_id
create policy "rounds write" on rounds for insert
  with check (user_id is null or user_id = auth.uid());

create index if not exists rounds_course_idx on rounds (course_id, to_par);

-- ---------- TOURNAMENTS: async multi-round events ----------
create table if not exists tournaments (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  course_id     text not null,
  r1r2_opens    timestamptz not null,
  r1r2_deadline timestamptz not null,
  r3r4_opens    timestamptz,
  r3r4_deadline timestamptz,
  created_by    text,
  created_at    timestamptz default now()
);

alter table tournaments enable row level security;

create policy "tournaments read"   on tournaments for select using (true);
-- only admins may create tournaments (server-enforced)
create policy "tournaments insert" on tournaments for insert with check (
  exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin)
);

-- ---------- TOURNAMENT_ROUNDS: one row per player per round ----------
create table if not exists tournament_rounds (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid references tournaments(id) on delete cascade,
  player_name   text not null,
  user_id       uuid references auth.users(id) on delete set null,
  round_num     int  not null check (round_num between 1 and 4),
  strokes       int,
  to_par        int,
  putts         int,
  gir           int,
  fir           int,
  fir_holes     int,
  prox_ft       int,
  submitted_at  timestamptz default now(),
  unique (tournament_id, player_name, round_num)
);

alter table tournament_rounds enable row level security;

create policy "trounds read"  on tournament_rounds for select using (true);
create policy "trounds write" on tournament_rounds for insert
  with check (user_id is null or user_id = auth.uid());

-- =====================================================================
--  Make yourself admin AFTER you sign in once (so the profile exists):
--    update profiles set is_admin = true
--      where id = (select id from auth.users where email = 'you@example.com');
-- =====================================================================

-- ---------- GAME_SETTINGS: single global-defaults row, admin-editable ----------
-- One row (id=1) holding the default aid toggles every player loads with.
-- Admins edit it from the in-game Admin panel; tournaments snapshot it.
create table if not exists game_settings (
  id          int primary key default 1,
  settings    jsonb not null default '{}'::jsonb,
  updated_at  timestamptz default now(),
  constraint game_settings_singleton check (id = 1)
);

alter table game_settings enable row level security;

create policy "settings read"   on game_settings for select using (true);
create policy "settings insert" on game_settings for insert with check (
  exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));
create policy "settings update" on game_settings for update using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));

insert into game_settings (id, settings) values (1, '{}'::jsonb)
  on conflict (id) do nothing;

-- per-tournament frozen conditions (snapshot of the toggle defaults at creation)
alter table tournaments add column if not exists settings jsonb;

-- ---------- ADMIN MANAGEMENT: edit/delete tournaments, DQ players ----------
-- The management screen needs admins to UPDATE/DELETE tournaments and remove
-- players' rounds. (tournament_rounds.tournament_id is ON DELETE CASCADE, so
-- deleting a tournament drops its rounds automatically.)
create policy "tournaments admin update" on tournaments for update using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));
create policy "tournaments admin delete" on tournaments for delete using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));
create policy "trounds admin delete" on tournament_rounds for delete using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));

-- =====================================================================
--  MATCHES: live, code-based head-to-head games with friends.
--  One person starts a match (gets a short code), others join with it,
--  the host picks course + settings + length and presses Begin. Everyone
--  then races the same course; standings update by polling (no Realtime).
--  Casual + ephemeral, so RLS is permissive (anon key is public; the only
--  gate is knowing the 6-char code). No sensitive data lives here.
-- =====================================================================
create table if not exists matches (
  id           uuid primary key default gen_random_uuid(),
  code         text unique not null,          -- 6-char join code (ambiguous chars dropped)
  host_name    text,
  host_user_id uuid references auth.users(id) on delete set null,
  course_id    text,                          -- null until host picks at Begin
  hole_count   int,                           -- 9 or 18, set at Begin
  settings     jsonb,                         -- aid-toggle snapshot, frozen at Begin
  status       text not null default 'lobby', -- 'lobby' | 'live' | 'done'
  created_at   timestamptz default now(),
  started_at   timestamptz
);
alter table matches enable row level security;
create policy "matches read"   on matches for select using (true);
create policy "matches write"  on matches for insert with check (true);
create policy "matches update" on matches for update using (true);

create table if not exists match_players (
  id           uuid primary key default gen_random_uuid(),
  match_id     uuid references matches(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete set null,
  player_name  text not null,
  score        int not null default 0,        -- to-par so far
  holes_played int not null default 0,
  finished     boolean not null default false,
  joined_at    timestamptz default now(),
  updated_at   timestamptz default now(),
  unique (match_id, player_name)
);
alter table match_players enable row level security;
create policy "mplayers read"   on match_players for select using (true);
create policy "mplayers write"  on match_players for insert
  with check (user_id is null or user_id = auth.uid());
create policy "mplayers update" on match_players for update using (true);
create index if not exists match_players_match_idx on match_players (match_id);
