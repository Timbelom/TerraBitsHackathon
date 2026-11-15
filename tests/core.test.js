// Checks of the calculation modules in core/. Run: node --test   (Node 20 or newer, no packages needed)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import * as F from '../core/frames.js';
import * as S from '../core/sky.js';
import * as V from '../core/visibility.js';
import { GlobeGrid, parseBlock, blockFromGlobe } from '../core/terrain.js';
import { bodySky } from '../lunar-sky.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p));
const json = p => JSON.parse(read(p));
const buf = p => { const b = read(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const sep = (az1, el1, az2, el2) => {
  const R = Math.PI / 180, c = Math.sin(el1 * R) * Math.sin(el2 * R) + Math.cos(el1 * R) * Math.cos(el2 * R) * Math.cos((az1 - az2) * R);
  return Math.acos(Math.max(-1, Math.min(1, c))) / R;
};
const horizons = new S.HorizonsSky(json('expiry-date/data/sky_meta.json'), buf('expiry-date/data/sky_2027_2066.bin'));
const sites = json('expiry-date/data/sites.json').sites;
const cr = sites.find(s => s.id === 'cr');
const DAY = 86400000;

test('frames: latitude/longitude and the local map go there and back', () => {
  for (const [lat, lon] of [[0, 0], [-89.439021, 222.844085], [45, 300], [90, 10], [-90, 0], [12.5, 179.99]]) {
    const u = F.unitFromLatLon(lat, lon), ll = F.latLonFromUnit(u);
    assert.ok(Math.abs(ll.lat - lat) < 1e-9);
    if (Math.abs(lat) < 90) assert.ok(Math.abs(((ll.lon - lon + 540) % 360) - 180) < 1e-9);
    const b = F.localBasis(u);
    for (const [x, y] of [[0, 0], [10, -20], [-124.9, 124.9], [299, 5]]) {
      const back = F.unitToLocalKm(b, F.localKmToUnit(b, x, y));
      assert.ok(Math.hypot(back[0] - x, back[1] - y) < 1e-6, `local map at ${lat}, ${lon}`);
    }
    // right-handed: east x north = up
    const c = [b.east[1] * b.north[2] - b.east[2] * b.north[1], b.east[2] * b.north[0] - b.east[0] * b.north[2], b.east[0] * b.north[1] - b.east[1] * b.north[0]];
    assert.ok(Math.hypot(c[0] - b.up[0], c[1] - b.up[1], c[2] - b.up[2]) < 1e-9);
  }
  // 100 km north of the equator at longitude 0 is 100 km / R radians of latitude
  const p = F.latLonFromUnit(F.localKmToUnit(F.basisAt(0, 0), 0, 100));
  assert.ok(Math.abs(p.lat - 100 / F.MOON_RADIUS_KM * 180 / Math.PI) < 1e-9 && Math.abs(p.lon) < 1e-9);
  assert.deepEqual(F.threeToBody(F.bodyToThree([1, 2, 3])), [1, 2, 3]);
});

test('frames: the 200 km squares leave out both poles and the two polar landing sites', () => {
  const sq = F.squares();
  assert.equal(sq.length, 2400);
  assert.equal(F.squareAt(sq, F.unitFromLatLon(-90, 0)), -1);
  assert.equal(F.squareAt(sq, F.unitFromLatLon(90, 0)), -1);
  assert.equal(F.squareAt(sq, F.unitFromLatLon(cr.lat, cr.lon)), -1);
  assert.ok(F.squareAt(sq, F.unitFromLatLon(0.67416, 23.47314)) >= 0);       // Apollo 11 lies in one
});

test('sky: the Horizons table is read as stored and interpolated between the hours', () => {
  const o = {}, i = 12345;
  horizons.at(horizons.startMs + i * 3600000, o);
  const s = F.latLonFromUnit(o.sun), e = F.latLonFromUnit(o.earth);
  assert.ok(Math.abs(s.lat - horizons.sLat[i]) < 1e-5 && Math.abs(((s.lon - horizons.sLon[i] + 540) % 360) - 180) < 1e-5);
  assert.ok(Math.abs(e.lat - horizons.eLat[i]) < 1e-5 && Math.abs(o.earthDistKm - horizons.dist[i]) < 1e-6);
  horizons.at(horizons.startMs + (i + .5) * 3600000, o);
  assert.ok(Math.abs(o.earthDistKm - (horizons.dist[i] + horizons.dist[i + 1]) / 2) < 1e-3);
  assert.equal(horizons.endMs, Date.UTC(2067, 0, 1));
});

test('sky: source is Horizons inside 2027-2066 and the analytic model outside; the two agree', () => {
  S.setHorizons(horizons);
  assert.equal(S.skySource(Date.UTC(2028, 6, 7)), 'horizons');
  assert.equal(S.skySource(Date.UTC(2026, 10, 15)), 'analytic');
  assert.equal(S.skyAt(Date.UTC(2026, 10, 15)).source, 'analytic');
  let worstSun = 0, worstEarth = 0;
  for (let k = 0; k < 400; k++) {
    const ms = horizons.startMs + k * 36.5 * DAY, h = S.skyAt(ms), a = bodySky(ms);
    const ang = (p, q) => Math.acos(Math.min(1, F.dot(p, q) / Math.hypot(...p) / Math.hypot(...q))) * 180 / Math.PI;
    worstSun = Math.max(worstSun, ang(h.sun, a.sun)); worstEarth = Math.max(worstEarth, ang(h.earth, a.earth));
  }
  assert.ok(worstSun < 0.06, 'Sun: analytic model within 0.06 deg of Horizons, found ' + worstSun);
  assert.ok(worstEarth < 0.4, 'Earth: analytic model within 0.4 deg of Horizons, found ' + worstEarth);
});

test('sky: azimuth and elevation at three sites match JPL Horizons observer tables within 0.1 deg', () => {
  S.setHorizons(horizons);
  const ref = json('expiry-date/data/validation/horizons_reference.json');
  let worst = 0;
  for (const s of ref.sites) ref.jd_ut.forEach((jd, k) => {
    const ms = Date.UTC(2027, 0, 1) + (jd - ref.jd_epoch_2027_01_01) * DAY, o = S.siteSky(ms, s.lat, s.lon);
    worst = Math.max(worst, sep(o.sunAzDeg, o.sunElevDeg, ...s.sun[k]), sep(o.earthAzDeg, o.earthElevDeg, ...s.earth[k]));
  });
  assert.ok(worst < 0.1, 'worst separation ' + worst.toFixed(4) + ' deg');
});

test('sky: the system view places Sun and Earth where the source has them over the lunar surface', () => {
  S.setHorizons(horizons);
  const ms = Date.UTC(2031, 3, 9, 7, 30), a = S.inertialSky(ms), h = S.skyAt(ms);
  const back = v => [0, 1, 2].map(i => a.moonToScene[0][i] * v[0] + a.moonToScene[1][i] * v[1] + a.moonToScene[2][i] * v[2]);   // scene -> Moon-fixed
  const sun = back(a.sun), earth = back(a.earth);
  assert.ok(Math.hypot(sun[0] - h.sun[0], sun[1] - h.sun[1], sun[2] - h.sun[2]) < 1e-12);
  assert.ok(Math.hypot(...earth.map((c, i) => c * a.earthDistKm - h.earth[i])) < 1e-6);
  assert.equal(a.source, 'horizons');
});

test('visibility: visible share of a disc', () => {
  assert.equal(V.discFraction(1, .25), 1);
  assert.equal(V.discFraction(-1, .25), 0);
  assert.ok(Math.abs(V.discFraction(0, .25) - .5) < 1e-12);
  assert.ok(Math.abs(V.discFraction(.1, .25) + V.discFraction(-.1, .25) - 1) < 1e-12);
  // segment of a unit circle cut at half the radius: (2 pi / 3 - sqrt(3) / 2) / 2 pi ... of the area below the line
  assert.ok(Math.abs(V.discFraction(-.5, 1) - (Math.PI / 3 - Math.sqrt(3) / 4) / Math.PI) < 1e-12);
});

test('visibility: hours in view and the longest gap, with the 50 % crossing interpolated', () => {
  // in view until 2.5 h, out until 6.25 h, in view to the end at 8 h
  const f = Float32Array.from([1, 1, 1, 0, 0, 0, .25, 1.25, 1].map(x => Math.min(1, x)));
  f[2] = 1; f[3] = 0;           // crossing halfway between sample 2 and 3
  f[6] = .25; f[7] = 1;         // crossing a third of the way between sample 6 and 7
  const s = V.viewStats(f);
  assert.ok(Math.abs(s.longestGapHours - (6 + 1 / 3 - 2.5)) < 1e-6);
  assert.ok(Math.abs(s.inViewHours - (2.5 + (8 - 6 - 1 / 3))) < 1e-6);
  assert.equal(s.longestGapOpen, false);
  assert.equal(s.hours, 8);
  const dark = V.viewStats(new Float32Array(25));
  assert.equal(dark.longestGapHours, 24); assert.equal(dark.longestGapOpen, true); assert.equal(dark.share, 0);
  const lit = V.viewStats(new Float32Array(25).fill(1));
  assert.equal(lit.longestGapHours, 0); assert.equal(lit.share, 1);
});

test('visibility: same disc fractions as the Expiry Date calculation at a terrain site', () => {
  S.setHorizons(horizons);
  const C = createRequire(import.meta.url)('../expiry-date/core.js');
  const profile = json('expiry-date/' + cr.horizon);
  const sky = new C.Sky(json('expiry-date/data/sky_meta.json'), buf('expiry-date/data/sky_2027_2066.bin'));
  const old = C.makeSite({ ...cr, z: profile.target.z_m }, profile);
  const site = V.makeSite(cr.lat, cr.lon, profile.target.z_m, V.horizonFromProfile(profile));
  let worst = 0;
  for (let h = 0; h < 24 * 400; h += 7) {
    const ms = Date.UTC(2028, 0, 1) + h * 3600000, t = C.tOf(ms), st = V.siteState(ms, site);
    worst = Math.max(worst, Math.abs(st.sun.frac - C.bodyState(sky, old, t, 'sun', 0).frac), Math.abs(st.earth.frac - C.bodyState(sky, old, t, 'earth', 0).frac));
  }
  assert.ok(worst < 1e-4, 'largest difference in a disc fraction: ' + worst);
});

test('visibility: next change of view is found to the minute', () => {
  S.setHorizons(horizons);
  const site = V.makeSite(0.67416, 23.47314), ms = Date.UTC(2028, 6, 7);
  const t = V.nextChange(ms, site, 'sun', ms + 60 * DAY);
  assert.ok(t > ms && t < ms + 16 * DAY);
  const before = V.siteState(t - 120000, site).sun.frac >= .5, after = V.siteState(t + 120000, site).sun.frac >= .5;
  assert.notEqual(before, after);
  assert.equal(V.nextChange(ms, V.makeSite(0, 0), 'earth', ms + 60 * DAY), null);      // the Earth never sets at the sub-Earth region
});

test('terrain: global grid and a block describe the same ground, in the same orientation', () => {
  const globe = new GlobeGrid(json('data/globe/ldem_me_1440x720.json'), buf('data/globe/ldem_me_1440x720.bin'));
  const block = parseBlock(buf('data/terrain/a17.bin')), a17 = sites.find(s => s.id === 'a17');
  assert.ok(Math.abs(block.lat - a17.lat) < 1e-9 && Math.abs(block.lon - a17.lon) < 1e-9);
  assert.equal(block.res, 640); assert.equal(block.farRes, 601); assert.equal(block.coarse, false);
  // correlation of block heights with the grid at the same places: only high if east/north and row order agree
  const a = [], b = [];
  for (let y = -120; y <= 120; y += 12) for (let x = -120; x <= 120; x += 12) {
    const ll = block.latLon(x, y); a.push(block.heightNear(x, y)); b.push(globe.elevation(ll.lat, ll.lon));
  }
  const corr = (p, q) => { const n = p.length, mp = p.reduce((s, v) => s + v) / n, mq = q.reduce((s, v) => s + v) / n;
    let spq = 0, spp = 0, sqq = 0; for (let i = 0; i < n; i++) { spq += (p[i] - mp) * (q[i] - mq); spp += (p[i] - mp) ** 2; sqq += (q[i] - mq) ** 2; } return spq / Math.sqrt(spp * sqq); };
  assert.ok(corr(a, b) > .9, 'near grid against global grid: correlation ' + corr(a, b).toFixed(3));
  const fa = [], fb = [];
  for (let y = -290; y <= 290; y += 29) for (let x = -290; x <= 290; x += 29) {
    const ll = block.latLon(x, y); fa.push(block.heightFar(x, y)); fb.push(globe.elevation(ll.lat, ll.lon));
  }
  assert.ok(corr(fa, fb) > .95, 'far grid against global grid: correlation ' + corr(fa, fb).toFixed(3));
  assert.ok(Number.isNaN(block.heightFar(301, 0)));
  // a block made from the grid alone has the same layout: its grid points carry the grid's heights
  const coarse = blockFromGlobe(globe, a17.lat, a17.lon, { res: 64, farRes: 61 });
  assert.equal(coarse.coarse, true);
  const x = -125 + 20 * coarse.stepKm, y = 125 - 40 * coarse.stepKm, at = coarse.latLon(x, y);
  assert.ok(Math.abs(coarse.heightNear(x, y) - globe.elevation(at.lat, at.lon)) < 1);
});

test('terrain: horizon at Connecting ridge from the LDEM64 block stays close to the 5 m profile', () => {
  const block = parseBlock(buf('data/terrain/cr.bin')), profile = json('expiry-date/' + cr.horizon);
  const h = V.horizonFromBlock(block), ref = V.horizonFromProfile(profile);
  assert.equal(h.basis, 'block');
  let sum = 0, worst = 0;
  for (let i = 0; i < 360; i++) { const d = Math.abs(h.angle[i] - ref.angle[i]); sum += d; worst = Math.max(worst, d); }
  // 474 m pixels against 5 m: the summit is flattened (1942 m instead of 1959 m) and so is the skyline
  assert.ok(Math.abs(block.centerHeightM - profile.target.z_m) < 30, 'height of the site: ' + block.centerHeightM.toFixed(1) + ' m');
  assert.ok(sum / 360 < 0.45, 'mean difference ' + (sum / 360).toFixed(2) + ' deg');
  assert.ok(worst < 2, 'largest difference ' + worst.toFixed(2) + ' deg');
  // and the year 2027 comes out close: Earth contact within 1 point, sunlight within 5 points of the 5 m result
  S.setHorizons(horizons);
  const a = Date.UTC(2027, 0, 1), b = Date.UTC(2028, 0, 1);
  const m5 = V.spanMetrics(V.makeSite(cr.lat, cr.lon, ref.heightM, ref), a, b), m64 = V.spanMetrics(V.makeSite(cr.lat, cr.lon, h.heightM, h), a, b);
  assert.ok(Math.abs(m5.earth.share - m64.earth.share) < 0.01, 'Earth in view: ' + m5.earth.share.toFixed(3) + ' against ' + m64.earth.share.toFixed(3));
  assert.ok(Math.abs(m5.sun.share - m64.sun.share) < 0.05, 'Sun in view: ' + m5.sun.share.toFixed(3) + ' against ' + m64.sun.share.toFixed(3));
});
