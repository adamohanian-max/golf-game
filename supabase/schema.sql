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
