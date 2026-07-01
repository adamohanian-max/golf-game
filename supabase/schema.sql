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

-- ---------- MATCH PLAY: 1v1 format + live per-shot opponent state ----------
-- format=stroke is the original score race; format=match is hole-by-hole 1v1
-- (holes won/halved, closeout). The cur_* columns carry each player's live
-- shot state so the opponent panel can show hole/strokes/distance/lie, and so
-- advisory "honors" (who's farthest from the pin) can be displayed.
alter table matches add column if not exists format text not null default 'stroke'; -- 'stroke' | 'match'

alter table match_players add column if not exists hole_scores jsonb not null default '{}'::jsonb; -- {holeNum: strokes}
alter table match_players add column if not exists cur_hole    int;
alter table match_players add column if not exists cur_strokes int not null default 0;
alter table match_players add column if not exists cur_to_pin  int;     -- yards ball->pin at rest; -1 when holed/NA
alter table match_players add column if not exists cur_lie     text;
alter table match_players add column if not exists cur_at_rest boolean not null default true; -- false while ball moving
alter table match_players add column if not exists cur_updated timestamptz;

-- ---------- LIVE (synchronous) match play ----------
-- Opt-in per match: enforce honors/away turn order, render the opponent's ball,
-- and replay each shot as an arc on the watcher's screen. cur_x/cur_y carry the
-- ball's world coords at rest; cur_shot is the last shot broadcast (arc tween).
alter table matches add column if not exists live boolean not null default false; -- synchronous turn-based match

alter table match_players add column if not exists cur_x    double precision; -- ball world x at rest
alter table match_players add column if not exists cur_y    double precision; -- ball world y at rest
alter table match_players add column if not exists cur_shot jsonb;            -- {seq,hole,fromX,fromY,toX,toY,durMs,peak,lie}

-- ---------- Realtime: push row changes to the live-match clients ----------
-- The game subscribes to postgres_changes on these tables; enable replication so
-- those events fire. (Safe to re-run; "already member" just errors harmlessly.)
alter publication supabase_realtime add table public.match_players;
alter publication supabase_realtime add table public.matches;

-- =====================================================================
--  FRIENDS: unique-handle friend graph (request -> accept), plus direct
--  match invites. profiles.username is the searchable handle (display_name
--  stays a non-unique label). Each friendship/invite is visible only to the
--  two parties (unlike the world-readable leaderboard tables above).
-- =====================================================================

-- searchable, unique handle. App lowercases before write; format enforced here.
alter table profiles add column if not exists username text unique;
do $$ begin
  alter table profiles add constraint username_fmt
    check (username is null or username ~ '^[a-z0-9_]{3,16}$');
exception when duplicate_object then null; end $$;

-- ---------- FRIENDSHIPS: one row per relationship (requester -> addressee) ----------
create table if not exists friendships (
  id         uuid primary key default gen_random_uuid(),
  requester  uuid not null references auth.users(id) on delete cascade,
  addressee  uuid not null references auth.users(id) on delete cascade,
  status     text not null default 'pending',   -- 'pending' | 'accepted'
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (requester, addressee),
  check (requester <> addressee)
);
alter table friendships enable row level security;
-- only the two parties can see the row
create policy "fr select" on friendships for select
  using (auth.uid() = requester or auth.uid() = addressee);
-- only the requester creates, and only as a pending request
create policy "fr insert" on friendships for insert
  with check (auth.uid() = requester and status = 'pending');
-- addressee accepts (pending -> accepted); requester may also edit their own row
create policy "fr update" on friendships for update
  using (auth.uid() = addressee or auth.uid() = requester);
-- either party can unfriend / decline / cancel
create policy "fr delete" on friendships for delete
  using (auth.uid() = requester or auth.uid() = addressee);
create index if not exists friendships_addressee_idx on friendships (addressee);
create index if not exists friendships_requester_idx on friendships (requester);

-- ---------- MATCH_INVITES: direct match invites between friends ----------
-- No realtime/push: the Friends screen polls for pending invites and joins by
-- the 6-char code (reusing the normal match-join flow).
create table if not exists match_invites (
  id         uuid primary key default gen_random_uuid(),
  match_id   uuid references matches(id) on delete cascade,
  code       text not null,                       -- the match's 6-char join code
  from_user  uuid not null references auth.users(id) on delete cascade,
  to_user    uuid not null references auth.users(id) on delete cascade,
  status     text not null default 'pending',     -- 'pending' | 'accepted' | 'declined'
  created_at timestamptz default now()
);
alter table match_invites enable row level security;
create policy "mi select" on match_invites for select
  using (auth.uid() = from_user or auth.uid() = to_user);
create policy "mi insert" on match_invites for insert
  with check (auth.uid() = from_user);
create policy "mi update" on match_invites for update
  using (auth.uid() = to_user or auth.uid() = from_user);
create index if not exists match_invites_to_idx on match_invites (to_user, status);

-- =====================================================================
--  QUICK MATCH: chess.com-style open matchmaking. A player enqueues with a
--  format (match/stroke) + length (9/18) + their handicap (the pairing rating,
--  like Elo). The find_quick_match RPC atomically pairs the oldest compatible
--  waiter within a handicap band, creating a `matches` row + both player rows.
--  If nobody's waiting the client widens the band, then falls back to a local
--  CPU (no DB row). Guests allowed (default handicap); RLS permissive like
--  `matches` — the pool is public, nothing sensitive lives here.
-- =====================================================================
create table if not exists match_queue (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users(id) on delete cascade,  -- null for guests
  player_name      text not null,
  handicap         numeric not null default 18,
  format           text not null default 'match',   -- 'match' | 'stroke'
  hole_count       int  not null default 18,         -- 9 | 18
  status           text not null default 'waiting',  -- 'waiting' | 'matched' | 'cancelled'
  matched_match_id uuid references matches(id) on delete set null,
  enqueued_at      timestamptz default now()
);
alter table match_queue enable row level security;
create policy "mq read"   on match_queue for select using (true);
create policy "mq write"  on match_queue for insert with check (true);
create policy "mq update" on match_queue for update using (true);
create index if not exists match_queue_wait_idx
  on match_queue (format, hole_count, status, enqueued_at);
alter publication supabase_realtime add table public.match_queue;

-- handicap = the pairing rating (best-8-of-20 to-par), refreshed client-side
-- after each logged-in round.
alter table profiles add column if not exists handicap numeric;

-- Atomic pairing: lock the oldest compatible waiter with FOR UPDATE SKIP LOCKED
-- (so two simultaneous callers can't grab the same partner), spin up the match
-- + both player rows, mark the partner's queue row matched, return the match id.
-- Returns null when no partner in band → caller enqueues itself and polls.
create or replace function find_quick_match(
  p_user uuid, p_name text, p_hcp numeric,
  p_format text, p_holes int, p_band numeric
) returns uuid language plpgsql security definer as $$
declare v_partner match_queue; v_match uuid; v_code text;
begin
  select * into v_partner from match_queue
   where status = 'waiting' and format = p_format and hole_count = p_holes
     and (p_user is null or user_id is distinct from p_user)
     and abs(handicap - p_hcp) <= p_band
   order by enqueued_at asc
   for update skip locked limit 1;

  if v_partner.id is null then return null; end if;

  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  insert into matches(code, host_name, host_user_id, status, format, live)
    values (v_code, v_partner.player_name, v_partner.user_id,
            'lobby', p_format, p_format = 'match')
    returning id into v_match;
  insert into match_players(match_id, user_id, player_name)
    values (v_match, v_partner.user_id, v_partner.player_name),
           (v_match, p_user, p_name);
  update match_queue set status = 'matched', matched_match_id = v_match
    where id = v_partner.id;
  return v_match;
end $$;

grant execute on function find_quick_match(uuid, text, numeric, text, int, numeric)
  to anon, authenticated;
