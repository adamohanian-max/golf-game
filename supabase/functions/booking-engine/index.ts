// booking-engine — Supabase Edge Function
// PRODUCT_STRATEGY.md §2/§4: "display everywhere, book where authorized."
//
// One BookingProvider interface, fanned out in parallel by BookingEngine.
// Runs server-side ONLY (Deno edge runtime) because real providers need
// OAuth2 client secrets that must never reach the browser bundle.
//
// Deploy (manual, like schema.sql — no CLI wired into this repo yet):
//   supabase functions deploy booking-engine --project-ref phexiylwltbyjvyujtql
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected
// automatically by the Edge Function runtime — nothing to set for those.
// To turn on a real provider later, set its secrets, e.g.:
//   supabase secrets set GOLFNOW_ENABLED=true GOLFNOW_CLIENT_ID=... GOLFNOW_CLIENT_SECRET=...
// and flip GolfNowProvider from stub to real (fill the two TODOs below) —
// no call-site changes anywhere else per the adapter design.

import { createClient } from "jsr:@supabase/supabase-js@2";

// ---------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------
interface TeeTime {
  id: string;            // provider-scoped id, unique per (provider,id)
  provider: string;       // 'mock' | 'golfnow' | 'lightspeed'
  courseId: string;       // our internal course id
  courseName: string;
  time: string;            // ISO timestamp
  players: number;
  priceCents: number | null;
  bookable: boolean;       // true = createBooking() completes it here; false = deepLink out
  deepLink: string | null; // required when bookable=false
}

interface SearchParams {
  courseId: string;
  courseName: string;
  location?: string;
  date?: string;   // YYYY-MM-DD, defaults to today
}

interface BookingProvider {
  id: string;
  search(params: SearchParams): Promise<TeeTime[]>;
  createBooking(teeTime: TeeTime, player: { name: string; email?: string }): Promise<{ ok: true; providerRef: string } | { ok: false; reason: string }>;
  cancelBooking(providerRef: string): Promise<{ ok: boolean }>;
}

// ---------------------------------------------------------------------
//  MockProvider — stands in for ScrapeDisplayProvider until a real scrape
//  source or an authorized API (GolfNow/Lightspeed) is wired in. Always
//  bookable:false — hands the golfer a deep link out, never fakes a real
//  reservation. Lets the whole CTA -> search -> book -> unlock pipeline be
//  built and tested today without waiting on partner credentials.
// ---------------------------------------------------------------------
class MockProvider implements BookingProvider {
  id = "mock";
  async search(params: SearchParams): Promise<TeeTime[]> {
    const base = params.date ? new Date(params.date + "T07:00:00") : new Date();
    if (isNaN(base.getTime())) base.setTime(Date.now());
    const slots = [7, 8, 9.5, 11, 13, 14.5, 16];
    const q = encodeURIComponent(`book tee time ${params.courseName}${params.location ? " " + params.location : ""}`);
    return slots.map((h, i) => {
      const t = new Date(base);
      t.setHours(Math.floor(h), (h % 1) * 60, 0, 0);
      return {
        id: `mock-${params.courseId}-${i}`,
        provider: "mock",
        courseId: params.courseId,
        courseName: params.courseName,
        time: t.toISOString(),
        players: 4,
        priceCents: null,
        bookable: false,
        deepLink: `https://www.google.com/search?q=${q}`,
      };
    });
  }
  async createBooking() {
    return { ok: false as const, reason: "mock provider is display-only" };
  }
  async cancelBooking() {
    return { ok: false };
  }
}

// ---------------------------------------------------------------------
//  GolfNowProvider — stub. Registered but inert until GOLFNOW_ENABLED and
//  real credentials are set (application-gated, see PRODUCT_STRATEGY.md §2).
//  TODO(golfnow): OAuth2 client-credentials token fetch + cache.
//  TODO(golfnow): map search()/createBooking() to the GolfNow Partner API
//  request/response shapes once sandbox access lands.
// ---------------------------------------------------------------------
class GolfNowProvider implements BookingProvider {
  id = "golfnow";
  async search(_params: SearchParams): Promise<TeeTime[]> { return []; }
  async createBooking() {
    return { ok: false as const, reason: "GolfNow provider not yet wired (awaiting partner credentials)" };
  }
  async cancelBooking() {
    return { ok: false };
  }
}

// ---------------------------------------------------------------------
//  BookingEngine — fan out search in parallel, tolerate individual provider
//  failures, dedupe (prefer bookable, then cheaper), route bookings/cancels
//  to the owning provider by TeeTime.provider.
// ---------------------------------------------------------------------
class BookingEngine {
  private providers: BookingProvider[];
  constructor(providers: BookingProvider[]) { this.providers = providers; }

  async search(params: SearchParams): Promise<TeeTime[]> {
    const results = await Promise.allSettled(this.providers.map((p) => p.search(params)));
    const all: TeeTime[] = [];
    for (const r of results) if (r.status === "fulfilled") all.push(...r.value);
    const byKey = new Map<string, TeeTime>();
    for (const t of all) {
      const key = t.time + "|" + t.players;
      const existing = byKey.get(key);
      if (!existing) { byKey.set(key, t); continue; }
      const better = t.bookable !== existing.bookable
        ? (t.bookable ? t : existing)
        : ((t.priceCents ?? Infinity) < (existing.priceCents ?? Infinity) ? t : existing);
      byKey.set(key, better);
    }
    return [...byKey.values()].sort((a, b) => a.time.localeCompare(b.time));
  }

  async book(teeTime: TeeTime, player: { name: string; email?: string }) {
    const provider = this.providers.find((p) => p.id === teeTime.provider);
    if (!provider) return { ok: false as const, reason: "unknown provider" };
    return provider.createBooking(teeTime, player);
  }
}

const engine = new BookingEngine([
  new MockProvider(),
  ...(Deno.env.get("GOLFNOW_ENABLED") === "true" ? [new GolfNowProvider()] : []),
]);

// ---------------------------------------------------------------------
//  HTTP handler
// ---------------------------------------------------------------------
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }

  const action = body.action;

  if (action === "search") {
    const { courseId, courseName, location, date } = body as unknown as SearchParams;
    if (!courseId || !courseName) return json({ error: "courseId and courseName required" }, 400);
    const teeTimes = await engine.search({ courseId, courseName, location, date });
    return json({ teeTimes });
  }

  if (action === "book") {
    const teeTime = body.teeTime as TeeTime;
    const player = (body.player as { name: string; email?: string }) || { name: "Guest" };
    const userId = (body.userId as string) || null;
    if (!teeTime || !teeTime.courseId || !teeTime.provider) return json({ error: "teeTime required" }, 400);

    const result = await engine.book(teeTime, player);

    // Best-effort sync row + (if logged in) unlock the course server-side too.
    // Never merchant-of-record — this just records the outcome and mirrors
    // the unlock; the provider owns payment/cancellation.
    try {
      const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const status = result.ok ? (teeTime.bookable ? "confirmed" : "redirected") : "failed";
      const { data: row } = await sb.from("bookings").insert({
        user_id: userId,
        course_id: teeTime.courseId,
        course_name: teeTime.courseName,
        provider: teeTime.provider,
        provider_ref: result.ok ? result.providerRef : null,
        bookable: teeTime.bookable,
        tee_time: teeTime.time,
        status,
      }).select().single();

      if (userId && row) {
        const { data: prof } = await sb.from("profiles").select("entitlements").eq("id", userId).single();
        const ent = (prof && prof.entitlements) || { courses: {} };
        ent.courses = ent.courses || {};
        ent.courses[teeTime.courseId] = { via: "booking", bookingId: row.id, at: new Date().toISOString() };
        await sb.from("profiles").update({ entitlements: ent }).eq("id", userId);
      }

      return json({ ok: result.ok, reason: result.ok ? undefined : result.reason, bookingId: row ? row.id : null, deepLink: teeTime.deepLink });
    } catch (e) {
      // DB sync failing shouldn't block the deep-link/booking outcome reaching the player.
      return json({ ok: result.ok, reason: result.ok ? undefined : result.reason, deepLink: teeTime.deepLink, syncError: String(e) });
    }
  }

  return json({ error: "unknown action" }, 400);
});
