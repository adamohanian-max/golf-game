# YoGolf — Product & Technical Strategy

> Drop this in the repo (suggested: `docs/PRODUCT_STRATEGY.md`).
> In Claude Code, start sessions with: "Read docs/PRODUCT_STRATEGY.md, then let's implement <X>."
> This is a living document — update it as decisions change.

Repo: `adamohanian-max/golf-game`
Properties: `yo-golf.com` (the game), `yogolf.net` (tee-time search)

---

## 1. The one-sentence thesis

**The only golf game where you play your *real* local course, then book a real tee time on it.**

No competitor can say this. Pure tee-time aggregators (GolfNow, Supreme Golf) are marketplaces.
Golf super-apps (18Birdies) are GPS/social utilities with bolted-on booking. Golf *games*
(WGT, Golf Clash) don't touch real booking. The defensible asset is a genuinely fun playable
game with real courses; booking is the conversion + retention layer around it.

**Strategic stance:** Do NOT try to out-aggregate GolfNow/Supreme Golf — that's a commodity
war against well-funded incumbents. The game is the moat. Aggregation/booking is a feature of
the game, not the business.

---

## 2. Architecture: the booking engine

Already scaffolded in `booking-engine.ts`. Core principle: **display everywhere, book where authorized.**

- Every provider implements one `BookingProvider` interface (`search` / `createBooking` / `cancelBooking`).
- Every `TeeTime` carries a `bookable` flag.
  - Authorized API providers (GolfNow, later Lightspeed) → `bookable: true`, complete the booking.
  - Scrape/display providers → `bookable: false`, hand the golfer a `deepLink` out.
- `BookingEngine` fans out search across all providers in parallel, tolerates individual failures,
  dedupes (prefers bookable copy, then cheaper), and routes each booking to the owning provider.
- **Never become merchant-of-record.** No card fields anywhere. The provider owns payment,
  chargebacks, refunds, and the "golfer showed up to no reservation" liability.

### Provider priority (from research)
- **GolfNow Affiliate & Partner API** — FIRST. ~9,000 courses, REST/JSON/OAuth2, sandbox available.
  Application-gated (golfnow.com/business-partnership). Commission is thin (~$3/booking).
  Pitch the *game funnel*, not "another aggregator."
- **Lightspeed Golf (Chronogolf) Partner API v2** — SECOND. Full booking flow. No self-serve portal;
  credentials by hand via golf.api@lightspeedhq.com.
- **foreUP** — CLOSED to third-party aggregators. Only accessible if a *course* already has a
  relationship and initiates. Don't chase.
- **Scrape (display-only)** — for broad availability where no authorized API exists. Never auto-submit
  bookings into an engine you're not authorized with (ToS violation + bot-detection + merchant risk).

### Build order
1. Wire `ScrapeDisplayProvider` for broad display now.
2. `GolfNowProvider` behind a feature flag; flip on when credentials land (fill the two TODOs:
   OAuth2 token handling + search/book request mapping).
3. Add `LightspeedProvider` when approved. New engines = new adapter, nothing else changes.

---

## 3. Architecture: course baking (real courses on demand)

**Data source:** OpenStreetMap (ODbL — free, commercial + game use OK, attribution required; already
credited in-game). Golf features are tagged: `leisure=golf_course`, `golf=green|tee|fairway|bunker`,
often with par. Query via Overpass API by location.

### Key facts that make this cheap
- **The entire planet has only ~38,000–40,000 golf courses (~16,000 US).** Finite, tiny, barely grows.
  This is NOT a big-data problem.
- **Store the recipe, not the rendered mesh.** Parsed geometry + a few elevation samples + generation
  params ≈ 100KB–1MB per course. Client regenerates playable geometry deterministically (the existing
  "bakes locally" flow).
- Total footprint: 40k × ~1MB ≈ **~40GB for every course on Earth.** Cents/month on object storage.

### Where it lives
- Baked recipes → object storage (S3 / Cloudflare R2), one file per course ID, CDN in front.
- Lightweight index (name, lat/lng, quality score) → Postgres/PostGIS for search.
- Client fetches a course recipe once, caches in browser, builds holes locally.

### At scale: pre-bake the planet
- Don't hammer public Overpass per-user (rate-limited, wrong tool).
- Download a bulk OSM extract (Geofabrik / Planet.osm), run ONE batch job: extract → parse →
  quality-gate → write all courses to storage. A few hours of compute, occasional re-runs.
- On-demand baking becomes a fallback for rare cache misses.

### Two honest limits
- **Coverage is uneven.** Many courses have only a boundary, no interior. Need a **quality gate**
  (e.g. ≥9 holes with greens + tees present) → only mark "ready to play" above the bar. Below bar:
  "not enough map data yet," ideally with user-fix option.
- **OSM is 2D.** No real green contours/slope. Layer a DEM (Mapbox Terrain / USGS 3DEP) for macro
  elevation; synthesize fine green break procedurally. Fine for a fun game — do NOT market as
  simulator-accurate "real" contours.

### Upside to exploit
- Per-course pages become a machine → SEO play "play [Course Name] online" for every course, auto-generated.
- **Let golfers fix their own course** (drag a green, add a bunker) when the auto-bake is rough.
  Improves data + deepens engagement + (if contributed back to OSM) improves the commons. User-corrected
  data becomes a proprietary asset over time = harder to copy = more acquirable.

---

## 4. The unlock mechanic (booking ↔ game value exchange)

**Book a course through the game → unlock that course to play in the game.** Turns booking from a weak
optional CTA into a real value exchange, and targets golfers who were going to book anyway (redirecting
existing intent — the cheapest conversion).

Rules:
- One booking unlocks **that specific course, permanently.** Do NOT unlock a whole region — it destroys
  the scarcity and the reason to book again. Every local course they want = another reason to book through you.
- This is a **collection mechanic** (golfers are completionists about their local courses) and a
  **retention + re-booking loop** — the thing GolfNow structurally lacks. Bookings become recurring, sticky.
- Keep a big **free-to-play sandbox** (fictional courses, rotating famous courses, daily challenge) so the
  game is fun for everyone and the top-of-funnel (portals, ads, virality) isn't starved. Booking-to-unlock
  is specifically the path to playing *your own local courses.*
- The reward is only a reward if the bake is GOOD → this raises the stakes on course quality. A rough bake
  makes the "reward" feel worse than not booking.

**⚠ Verify with GolfNow partner terms before building:** their distribution terms bar partners from
*discouraging* platform bookings. This mechanic *encourages* booking (should be fine) but confirm that
gating game content on bookings-through-their-API is allowed. Ask directly in the partnership conversation.

---

## 5. Social play design (the hard part)

**Core tension:** social play needs everyone in a group to have the course, but the unlock mechanic gates
courses behind an *individual* booking. If friends can't join your home course, it kills the social moment
that made the game spread in the first place.

Resolution (best option):
- **Host's unlock covers the table.** If the host has a course unlocked, everyone they invite can play it
  *in that match.* Unlocking = the right to *host* that course for your group. This turns the token into a
  **social asset**, not a wall, and makes booking MORE attractive ("book → bring your whole foursome here").
- Optional softer layer: guests get a "guest pass" taste (can play in the match, but no solo play / no ranked
  progress on it until they unlock it themselves) — seeds their own desire to unlock. Host-covers-table is
  cleaner; lean there.

Framing correction:
- The unlock (conversion/retention) and social play (fun/growth) want different things. **Don't force every
  social round to be a monetized unlock round** — it makes both worse. Generous social layer + quiet unlock
  reward for bookers.
- **Social fun comes from FORMAT, not course.** Match play, skins, closest-to-pin, live head-to-head by
  handicap, trash talk, shared leaderboard, rematch loop, challenge links — these work on ANY course and are
  what actually made the office play. Invest "make it fun" energy HERE first, on free courses. Home course is
  the special occasion, not the price of entry.

---

## 6. Economics & scale (why the exit is the prize)

Assumptions (argue with these — the booking-conversion number is the biggest swing factor):
- ~$3 per real booking (GolfNow affiliate; a negotiated partner deal may beat it).
- ~0.5 bookings per active player per year.
- ~$0.10/player/month game ad revenue (casual HTML5).
- → blended ~$2.50–3.00 annual revenue per monthly active player.

| Monthly active players | Est. annual revenue | Realistic acquisition value |
|---|---|---|
| 1,000 | ~$3K | ~nothing |
| 10,000 | ~$27K | ~$50K–150K (weak; the "stall trap") |
| 100,000 | ~$270K | ~$1M–2M |
| 500,000 | ~$1.35M | ~$5M–10M |
| 1,000,000 | ~$2.7M | ~$10M–25M |

Takeaways:
- Commissions are thin → this is an **audience/acquisition story, not a cash-flow story.** At every tier
  acquisition value dwarfs annual revenue. Nobody buys this for cash flow; they buy the audience + funnel.
- Job-replacing cash flow needs ~100K+ engaged players. The meaningful exit lives at 500K–1M.
- **On-strategy acquirer:** Versant (owns Golf Channel, GolfNow, GolfPass; bought Full Swing sim for ~$530M
  in 2026; stated goal to grow digital/transactional golf). A game that funnels bookings into GolfNow is
  eerily on-strategy. But acquirers pay for *trajectory*, not snapshots — be growing when you sell.
- **Don't build to flip.** Build a real business with real users; the exit is a byproduct of traction.
  Keep the company/tech clean and transferable (solo = clean cap table, protect that). Own IP cleanly
  (OSM attribution; careful with trademarked course names/branding).

---

## 7. Growth / traction plan

**The metric that matters:** engaged, signed-up golfers who play repeatedly AND book — NOT raw plays.

Distinguish two funnels:
- **Reach channels (portals):** volume + ad revenue + game validation. Anonymous, mostly non-golfers,
  you don't own them.
- **Qualified channels (golf communities):** the real golfers who book and who make you acquirable.

Prioritized for a solo builder (don't spread thin — pick ~2, go deep):
1. **CrazyGames Basic Launch NOW.** HTML5 portals = huge free reach (CrazyGames ~35–50M MAU, Poki ~60M MAU).
   Two-week limited test gives hard retention/playtime data before full commit. Validates the game + funds
   you via ads. If retention is good → Full Launch, then add Poki.
2. **Viral friend loop** (the office signal generalizes): frictionless "challenge a friend" links, shareable
   scorecards ("shot 68 at [real course] — beat me"). Spreads between real golfers who know each other.
3. **Golf communities** (qualified): r/golf, golf Discords, golf TikTok/YouTube. Hook: "someone built a game
   where you play your actual home course." Radically shareable to golfers specifically.
4. **Per-course SEO** ("play [Course Name] online") + **local independent-course partnerships** (also doubles
   as booking-supply wedge). Slow, compounding, defensible.

Reality check: 100K *engaged golfers* ≫ 100K portal plays. May need millions of portal sessions to net that
many owned, booking-capable golfers. Don't let a big portal dashboard number fake you into thinking you're
at the acquisition tier.

---

## 8. Instrumentation (build this BEFORE pouring on traffic)

The booking-conversion funnel is the entire thesis AND the acquisition pitch. Track, with `courseId` +
`courseName` on each event:
- `round_completed_real_course`
- `book_cta_shown`
- `book_cta_clicked`
- `teetimes_viewed` (count)
- `booking_started`
- `booking_confirmed` / `booking_redirected` / `booking_failed`
- `course_unlocked` (from booking)
- Social: `match_created`, `match_joined_via_link`, `friend_challenge_sent`

Also capture **account signup conversion** (portal play → owned account) — the rate that turns cheap reach
into qualified audience.

---

## 9. Open questions / risks to track
- GolfNow partner terms re: gating content on bookings (see §4).
- OSM data quality is the real limiter on "every course plays well" — not storage or scale.
- Portal traffic ≠ owned audience; guard the vanity-metric trap.
- Solo-founder time is the bottleneck; resist spreading across channels.
- IP hygiene: OSM attribution + trademarked course names.

---

## 10. Suggested immediate build sequence for Claude Code
1. Integrate `booking-engine.ts`; single `BookingEngine` instance, `ScrapeDisplayProvider` registered,
   `GolfNowProvider` behind a flag.
2. "Round Complete → Book a real tee time at {courseName}" CTA — real baked courses only, non-blocking,
   dismissible. Full analytics per §8.
3. Course unlock state: per-user "owned courses," confirmed booking flips a course to unlocked;
   host's-unlock-covers-the-table in matches (§5).
4. Course baking pipeline: Overpass query → feature parser → completeness quality gate → server-side
   cache/recipe store. Design for later planet-scale pre-bake.
5. Multiplayer formats + share loop polish (§5) — the real "fun" investment.
