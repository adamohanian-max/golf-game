#!/usr/bin/env node
// Playthrough probe — Pebble Beach on Google 3D tiles (gtiles ground).
//
//   node tools/playthrough_probe.mjs --holes 1-3 [--shots 8] [--outdir /tmp/gt-play]
//
// Boots each hole fresh, plays it via the real shot entry (autoClub + aimAtHole
// + launchShot — same path a swipe takes), and captures per hole/shot:
//   - alignment gaps: project→unproject round trip at ball + pin (world units)
//   - framing: ball screen position fraction at address
//   - sizes: ball / cup / flag / tee-dot px via the live gtMarkPx law
//   - jitter: max per-frame pin-projection delta over 60 parked frames
//   - pops: ISOLATED per-frame spikes during play (>12px preceded by <4px —
//     distinguishes a pop from the deliberate eased camera glide)
//   - occlusion state at each rest (GTiles3D.occludedAt)
//   - console errors
//   - screenshots: address + final per hole
// One JSON line per hole on stdout; screenshots + summary JSON in --outdir.
import { chromium } from '../web/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const [h0, h1] = arg('--holes', '1-1').split('-').map(Number);
const SHOT_CAP = +arg('--shots', 8);
const OUT = arg('--outdir', '/tmp/gt-play');
const TOKEN = 'AIzaSyCDMxunZ7Lx8OZbg5JY3OYhR02n3gCjmBk';
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch();
const results = [];
for (let hn = h0; hn <= (h1 || h0); hn++) {
  const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  pg.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  pg.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  await pg.addInitScript(t => localStorage.setItem('golf.googleTilesToken', t), TOKEN);
  await pg.goto(`http://localhost:8080/index.html?course=pebble-beach-golf-course&hole=${hn}`);
  // wait for real tile geometry (or declared failure → 2D fallback)
  const mode = await pg.waitForFunction(() => {
    const G = window.GTiles3D;
    if (!G) return false;
    if (G.failed()) return 'fallback2d';
    return G.isReady() ? 'gtiles' : false;
  }, { timeout: 60000, polling: 500 }).then(h => h.jsonValue()).catch(() => 'timeout');
  if (mode !== 'gtiles') {
    results.push({ hole: hn, mode, errors });
    console.log(JSON.stringify(results.at(-1)));
    await pg.close();
    continue;
  }
  await pg.waitForTimeout(6000);          // first framing + refine settle
  await pg.evaluate(() => {
    const bt = [...document.querySelectorAll('button')].find(x => /got it/i.test(x.textContent));
    if (bt) bt.click();
    window.aimAtHole();
  });
  await pg.waitForTimeout(3000);

  // ---- helpers injected once ----
  await pg.evaluate(() => {
    const G = window.GTiles3D, GB = window.GolfBridge;
    window.__probe = {
      gap(x, y) {                                  // project→unproject round trip, units
        const p = G.project(x, y, (GB.terrainZRender || GB.terrainZ)(x, y));
        const w = G.unproject(p.x, p.y);
        return w ? +Math.hypot(w.x - x, w.y - y).toFixed(2) : null;
      },
      sizes() {
        const S = GB.getState(), H = GB.getHole();
        const T = H.teePos || S.ball;
        return {
          ballPx: +window.gtMarkPx(S.ball.x, S.ball.y, 0, 0.02135, 2.0, 2.0, 10).toFixed(1),  // mirror GT_SIZE
          cupPx:  +window.gtMarkPx(H.holePos.x, H.holePos.y, 0, 0.054, 1.0, 2.0, 9).toFixed(1),
          flagPx: +window.gtMarkPx(H.holePos.x, H.holePos.y, 0, 2.13, 1.5, 10, 40).toFixed(1),
          teePx:  +window.gtMarkPx(T.x, T.y, 0, 0.10, 3, 2.5, 7).toFixed(1),
        };
      },
      state() {
        const S = GB.getState(), H = GB.getHole();
        const bp = G.project(S.ball.x, S.ball.y, (GB.terrainZRender || GB.terrainZ)(S.ball.x, S.ball.y));
        return {
          toPinYds: +(Math.hypot(S.ball.x - H.holePos.x, S.ball.y - H.holePos.y) * GB.getYardsPerUnit()).toFixed(0),
          surface: GB.surfaceAt(S.ball.x, S.ball.y),
          ballFrac: bp ? +(bp.y / innerHeight).toFixed(2) : null,
          ballGap: this.gap(S.ball.x, S.ball.y),
          pinGap: this.gap(H.holePos.x, H.holePos.y),
          ballOccl: G.occludedAt(S.ball.x, S.ball.y, (GB.terrainZRender || GB.terrainZ)(S.ball.x, S.ball.y)),
          pinOccl: G.occludedAt(H.holePos.x, H.holePos.y, (GB.terrainZRender || GB.terrainZ)(H.holePos.x, H.holePos.y)),
          holed: !document.getElementById('result').classList.contains('hidden'),
        };
      },
      async jitter(n) {                            // parked-camera pin wobble
        const H = GB.getHole();
        let last = null, mx = 0, t0 = performance.now();
        for (let i = 0; i < n; i++) {
          await new Promise(r => requestAnimationFrame(r));
          if (document.getElementById('cgt')?.style.display === 'none') continue;
          const p = G.project(H.holePos.x, H.holePos.y, (GB.terrainZRender || GB.terrainZ)(H.holePos.x, H.holePos.y));
          const t = performance.now();
          if (last && t - t0 < 80) mx = Math.max(mx, Math.hypot(p.x - last.x, p.y - last.y));
          last = p; t0 = t;
        }
        return +mx.toFixed(1);
      },
      watch() {                                    // pop detector, runs until stopped
        const H = GB.getHole();
        window.__pops = { spikes: [], on: true };
        let last = null, lastD = 0, t0 = 0, cand = 0;
        const tick = () => {
          if (!window.__pops.on) return;
          if (document.getElementById('cgt')?.style.display !== 'none') {
            const p = G.project(H.holePos.x, H.holePos.y, (GB.terrainZRender || GB.terrainZ)(H.holePos.x, H.holePos.y));
            const t = performance.now();
            if (last && t - t0 < 80) {
              const d = Math.hypot(p.x - last.x, p.y - last.y);
              // POP = one big frame sandwiched by small ones. A deliberate camera
              // glide also opens with a big frame after stillness, but the NEXT
              // frame stays big — so confirm the candidate only when motion dies
              // immediately after.
              if (cand && d < 4) window.__pops.spikes.push(+cand.toFixed(1));
              cand = (d > 12 && lastD < 4) ? d : 0;
              lastD = d;
            } else { lastD = 0; cand = 0; }
            last = p; t0 = t;
          } else { last = null; lastD = 0; cand = 0; }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
    };
  });

  const address = await pg.evaluate(() => ({ ...window.__probe.state(), ...window.__probe.sizes() }));
  const addressJitter = await pg.evaluate(() => window.__probe.jitter(60));
  await pg.screenshot({ path: `${OUT}/h${hn}-address.png` });
  await pg.evaluate(() => window.__probe.watch());

  const shots = [];
  for (let s = 1; s <= SHOT_CAP; s++) {
    const pre = await pg.evaluate(() => window.__probe.state());
    if (pre.holed) break;
    await pg.evaluate(() => {
      const GB = window.GolfBridge, S = GB.getState(), H = GB.getHole();
      window.autoClub(); window.aimAtHole();
      const onGreen = GB.surfaceAt(S.ball.x, S.ball.y) === 'green';
      const yds = Math.hypot(S.ball.x - H.holePos.x, S.ball.y - H.holePos.y) * GB.getYardsPerUnit();
      const frac = onGreen ? Math.min(0.85, 0.25 + yds * 0.012) : 0.92;
      const ang = Math.atan2(H.holePos.y - S.ball.y, H.holePos.x - S.ball.x);
      window.launchShot(ang, frac, 0, onGreen);
    });
    await pg.waitForTimeout(1200);
    await pg.waitForFunction(() =>
      !window.GolfBridge.getState().moving &&
      document.getElementById('cgt')?.style.display !== 'none',
      { timeout: 70000, polling: 250 }).catch(() => {});
    await pg.waitForTimeout(2500);              // glide + refine ramp + fades
    const post = await pg.evaluate(() => window.__probe.state());
    shots.push({ n: s, from: `${pre.surface}@${pre.toPinYds}y`, to: `${post.surface}@${post.toPinYds}y`,
                 ballGap: post.ballGap, pinGap: post.pinGap, ballOccl: post.ballOccl, holed: post.holed });
    if (post.holed) break;
  }
  const pops = await pg.evaluate(() => { window.__pops.on = false; return window.__pops.spikes.slice(0, 10); });
  const endJitter = await pg.evaluate(() => window.__probe.jitter(60));
  const endSizes = await pg.evaluate(() => window.__probe.sizes());
  await pg.screenshot({ path: `${OUT}/h${hn}-final.png` });
  results.push({ hole: hn, mode, address, addressJitter, shots, pops, endJitter, endSizes,
                 errors: [...new Set(errors)].slice(0, 6) });
  console.log(JSON.stringify(results.at(-1)));
  await pg.close();
}
writeFileSync(`${OUT}/holes-${h0}-${h1 || h0}.json`, JSON.stringify(results, null, 1));
await b.close();
