# Ad design spec — non-invasive rules

> **Status: rewarded plumbing wired; running on a DEMO provider.** The
> provider-agnostic entry point `showRewarded(reason)` (game.js) + one opt-in
> reward ("Watch to replay this hole") are live behind a labelled placeholder ad
> (`ADS.provider = "stub"`). Swap `ADS.provider` to `"crazygames"` or `"gam"` and
> fill the branch in `showRewarded()` to go real. US imagery is now NAIP
> (license-clean); non-US courses still on Esri are not ad-legal yet.
>
> **How it's wired:**
> - `ADS` config + `adsAvailable()` (respects a future `golf.noAds` purchase and
>   never serves `golf.under13`) + `showRewarded(reason) → Promise<bool>`.
> - `showStubAd()` = the demo overlay (`#ad-stub`); resolves true only after the
>   player taps "Claim reward". Real branches: CrazyGames `SDK.ad.requestAd`,
>   Google H5 `googletag.rewardedSlot` (TODO).
> - First reward: bogey-or-worse solo hole → result modal shows "Watch to replay
>   this hole"; on reward it reverses the hole's score fold and re-tees the same
>   hole (once per hole). Events: `ad_offer_taken`, `ad_reward_granted`.
> - To ship real ads: create the network account, set `ADS.provider`, add the
>   SDK `<script>`, and (for Google H5) add `ads.txt` + a certified consent CMP.

The whole point of this game is a calm, premium "clubhouse" feel. Ads must
never fight that. These rules are binding on any future ad integration.

## Hard rules (never break)

- **Rewarded / opt-in ONLY.** The player must actively choose to watch an ad in
  exchange for a clearly-stated reward. No ad ever plays without a tap that says
  "watch."
- **No interstitials.** Never a full-screen ad between holes, on hole-out, or on
  round start/end that the player didn't ask for.
- **No banners over gameplay.** The canvas/HUD is sacred — no persistent banner
  strip, no overlay, nothing occluding the course or controls.
- **No autoplay, no sound-on-by-default, no forced pre-round video.**
- **No ads to minors.** Respect the age gate — accounts flagged under the ad-age
  threshold see zero ads (also a COPPA/GDPR-K requirement).
- **No targeted/behavioral ads without consent.** Prefer contextual. Any tracking
  SDK needs a consent path + privacy-policy update first.

## Allowed placements

1. **Rewarded video (primary).** Player-initiated only. Reward examples:
   - "Watch to **retry this hole**" (mulligan) after a blow-up.
   - "Watch to **unlock a bonus course** for this session."
   - "Watch for an **extra daily-challenge attempt**."
   - "Watch to **skip the bot-ladder cooldown**."
2. **One static house/sponsor slot** on the **results / between-rounds** screen
   only — a single tasteful card (think a course/pro-shop sponsor), dismissable,
   never animated, never blocking the "Next hole"/"Rematch" flow.

## Frequency + UX guards

- Cap rewarded prompts so they read as a *feature*, not a nag (e.g. ≤ a few
  offers per session; never the same offer twice in a row).
- Every ad surface has an obvious dismiss/close.
- A future **membership / no-ads** purchase removes even the house slot.

## Why this shape

Rewarded video has the highest CPM ($15–25 US) *and* is the only format players
consistently rate as acceptable, because it trades value for value. It scales
with engaged DAU without ever degrading the core loop. Interstitials/banners buy
short-term pennies at the cost of retention — exactly backwards for a game whose
edge is feel.
