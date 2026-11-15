// Checks of core/area.js: the area within the limits of the sidebar must say the same as the numbers of a single
// point (core/visibility.js) when both stand on the same ground. Run: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import * as S from '../core/sky.js';
import * as V from '../core/visibility.js';
import * as A from '../core/area.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p));
const json = p => JSON.parse(read(p));
const buf = p => { const b = read(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
S.setHorizons(new S.HorizonsSky(json('expiry-date/data/sky_meta.json'), buf('expiry-date/data/sky_2027_2066.bin')));
const meta = json('data/globe/horizon_720x360x24.json'), bytes = new Uint8Array(buf('data/globe/' + meta.file));
const skyline = A.makeSkyline(bytes, meta), smooth = A.makeSkyline();
const HOUR = 3600000, DAY = 24 * HOUR, N = meta.width * meta.height;

// The horizon of one cell of the skyline map as a 360-value profile, for the single-point calculation
function profileOf(cell) {
  const angle = new Float32Array(360), step = 360 / meta.azimuths;
  for (let d = 0; d < 360; d++) { const a = d / step, k0 = Math.floor(a) % meta.azimuths, f = a - Math.floor(a), k1 = (k0 + 1) % meta.azimuths;
    angle[d] = meta.min_deg + (bytes[k0 * N + cell] * (1 - f) + bytes[k1 * N + cell] * f) * meta.span_deg / 255; }
  return { angle, basis: 'globe' };
}
function pointGaps(cell, a, b, withTerrain) {
  const [lat, lon] = A.cellCenter(Math.floor(cell / meta.width), cell % meta.width);
  const m = V.spanMetrics(V.makeSite(lat, lon, 0, withTerrain ? profileOf(cell) : null), a, b);
  return { sun: m.sun.longestGapHours, earth: m.earth.longestGapHours };
}
// cells spread over the Moon, with both polar rows and the limb regions
const cells = [];
for (const lat of [-89.75, -88.25, -85.25, -70.25, -30.25, 0.25, 45.25, 80.25, 87.75, 89.75]) for (const lon of [-179.75, -95.25, -88.75, -20.25, 0.25, 60.25, 90.25, 150.25]) cells.push(A.cellAt(lat, lon));

test('area: cell index and cell centre agree', () => {
  for (const c of cells) { const [lat, lon] = A.cellCenter(Math.floor(c / meta.width), c % meta.width); assert.equal(A.cellAt(lat, lon), c); }
  assert.equal(A.cellAt(-90, 0), 360); assert.equal(A.cellAt(90, 359.9), 359 * 720 + 359);
});

test('area: longest darkness and longest time without the Earth equal the single-point numbers, 10 days', () => {
  const a = Date.UTC(2028, 6, 10), b = a + 10 * DAY;
  for (const [sk, terrain] of [[skyline, true], [smooth, false]]) {
    const g = A.gapGrids(sk, A.skySamples(a, b));
    assert.equal(g.windowHours, 240);
    let worst = 0;
    for (const c of cells) { const p = pointGaps(c, a, b, terrain); worst = Math.max(worst, Math.abs(g.sun[c] - p.sun), Math.abs(g.earth[c] - p.earth)); }
    assert.ok(worst < 0.02, 'largest difference ' + worst.toFixed(4) + ' h (' + sk.basis + ')');
  }
});

test('area: the same over 24 hours and over 60 days', () => {
  for (const [a, days] of [[Date.UTC(2027, 2, 3, 7), 1], [Date.UTC(2031, 10, 1), 60]]) {
    const g = A.gapGrids(skyline, A.skySamples(a, a + days * DAY));
    let worst = 0;
    for (const c of cells) { const p = pointGaps(c, a, a + days * DAY, true); worst = Math.max(worst, Math.abs(g.sun[c] - p.sun), Math.abs(g.earth[c] - p.earth)); }
    assert.ok(worst < 0.02, 'largest difference ' + worst.toFixed(4) + ' h over ' + days + ' d');
  }
});

test('area: a cap ends long stretches as Infinity and leaves the shorter ones as they are', () => {
  const a = Date.UTC(2028, 6, 10), s = A.skySamples(a, a + 30 * DAY);
  const full = A.gapGrids(skyline, s), capped = A.gapGrids(skyline, s, { capH: 96 });
  for (const body of ['sun', 'earth']) for (let i = 0; i < N; i += 37) {
    if (full[body][i] > 96) assert.equal(capped[body][i], Infinity); else assert.ok(Math.abs(capped[body][i] - full[body][i]) < 1e-4);
  }
});

test('area: limits, their intersection and the share of the surface', () => {
  const a = Date.UTC(2028, 6, 10), g = A.gapGrids(smooth, A.skySamples(a, a + DAY), { capH: 96 });
  const none = A.withinLimits(g, null, null), sun = A.withinLimits(g, 6, null), earth = A.withinLimits(g, null, 12), both = A.withinLimits(g, 6, 12);
  assert.equal(none.share, 1);
  // smooth sphere, one day: a little under half of the Moon stays lit, a little under half keeps the Earth
  assert.ok(sun.share > .3 && sun.share < .5, 'sun ' + sun.share);
  assert.ok(earth.share > .4 && earth.share < .52, 'earth ' + earth.share);
  assert.ok(both.share <= Math.min(sun.share, earth.share) && both.share > 0);
  for (let i = 0; i < N; i++) {
    const inS = g.sun[i] <= 6, inE = g.earth[i] <= 12;
    assert.equal(sun.mask[i] > 127, inS); assert.equal(earth.mask[i] > 127, inE); assert.equal(both.mask[i] > 127, inS && inE);
  }
  // a limit of 0 h: only cells that never lose the body
  const never = A.withinLimits(g, 0, null);
  for (let i = 0; i < N; i += 11) assert.equal(never.mask[i] > 127, g.sun[i] === 0);
});

test('area: rows shared between parts give the same grids as one run', () => {
  const a = Date.UTC(2028, 6, 10), s = A.skySamples(a, a + 3 * DAY), one = A.gapGrids(skyline, s, { capH: 96 });
  let whole = { width: one.width, height: one.height, sun: null, earth: null };
  for (let k = 0; k < 3; k++) whole = A.mergeParts(whole, A.gapGrids(skyline, s, { capH: 96, part: { k, of: 3 } }), k, 3);
  assert.deepEqual(whole.sun, one.sun); assert.deepEqual(whole.earth, one.earth);
});
