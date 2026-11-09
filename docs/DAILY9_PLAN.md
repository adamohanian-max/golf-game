# Daily 9 — plan

A stripped-down, one-mode build of the golf game: every day at **midnight ET**
one course and a seeded set of **9 holes** are picked, everyone plays the same
holes with the same pins, wind and strike luck, once.

Web first (`index.html?d9=1`, PWA later), App Store later. Sweepstakes are a
later phase; the choices marked (S) below keep that door open.

## Decisions (locked 2026-11-09)

| Question | Decision |
|---|---|
| Which holes | **Seeded 9** from that day's course, played in course order. Par 34–37, at least one par 3 and one par 5, re-draw (seed + attempt) until satisfied |
| Day boundary | **Midnight America/New_York** for every player, everywhere |
| Course pick | Rendezvous hash `max strSeed(date + ":" + id)` over the pool — adding a course only changes today if the new one wins (old `pool[floor(rnd·len)]` reshuffled whenever the manifest grew) |
| Strike luck (S) | **Same dice per stroke**: dispersion seeded by date + hole + stroke number only (no ball position), so every player's Nth stroke on a hole draws the same error, scaled by their own club and lie |
| Streak grace day | **Yes** (keep the existing 1-day grace) |
| Platform | Web/PWA first, App Store later |

## Build order

1. ✅ ET date, stable course pick, seeded 9, same-dice dispersion, `?d9=1` shell
2. Mid-round resume (save after every stroke; one attempt/day means closing the app must never cost the round)
3. Per-hole scores table + `daily_percentile(date, hole, my_cum)` RPC → "Thru 4: −1 · better than 72% of 1,284" on the hole card. (S) store swipe inputs per stroke alongside, for later server replay
4. End screen: emoji share grid, stats (histogram, avg, best, birdie/par/bogey %), countdown to next 9
5. First-run tutorial (3 cards or a guided hole)
6. Second wave: friends board, reminder notifications, archive/practice (unranked), badges, hole flyover reveal

## Shell (`?d9=1`)

Same `index.html` + `game.js` (no fork — physics/rendering fixes reach both).
`DAILY9` flag adds `body.d9`, skips the home menu and boots straight to the
daily home; Done/close returns there, never to the main menu. CSS under
`body.d9` hides picker, bots, matches, chat, tour, booking, range.

## Sweepstakes (later)

Free entry, house/sponsor-funded prize = legal promotion with official rules.
Prerequisites already being built: fixed luck, per-hole data, recorded inputs,
upgradeable anonymous identity. Real-money pools are out of scope (gambling
law, Apple 5.3, KYC, payouts) unless via a skill-gaming platform.
