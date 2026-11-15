// Checks of core/exposure.js: skylines and mean visibility of points of a terrain block. Run: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import * as S from '../core/sky.js';
import * as V from '../core/visibility.js';
import * as X from '../core/exposure.js';
import { skySamples } from '../core/area.js';
import { parseBlock } from '../core/terrain.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p));
const buf = p => { const b = read(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
S.setHorizons(new S.HorizonsSky(JSON.parse(read('expiry-date/data/sky_meta.json')), buf('expiry-date/data/sky_2027_2066.bin')));
const DAY = 86400000;
const load = id => { const b = parseBlock(buf('data/terrain/' + id + '.bin')); return { b, P: X.prepare(b) }; };

test('exposure: the skyline at the site itself stays close to the finely traced one', () => {
  for (const id of ['cr', 'a17']) {
    const { b, P } = load(id), fine = V.horizonFromBlock(b), sky = X.skyline(P, X.pointFrame(P, 0, 0));
    let sum = 0, worst = 0, low = 0;
    for (let k = 0; k < X.AZIMUTHS; k++) { const d = sky[k] - fine.angle[k * 360 / X.AZIMUTHS]; sum += Math.abs(d); worst = Math.max(worst, Math.abs(d)); low = Math.min(low, d); }
    // pooled steps may only raise a skyline; the fine profile takes the maximum over 1 deg, which can be higher than one ray
    assert.ok(sum / X.AZIMUTHS < .25, id + ': mean difference ' + (sum / X.AZIMUTHS).toFixed(3) + ' deg');
    assert.ok(worst < 1.5, id + ': largest difference ' + worst.toFixed(2) + ' deg');
    assert.ok(low > -.8, id + ': lowest ' + low.toFixed(2) + ' deg');
  }
});

test('exposure: mean share in view at the site equals the single-point series on the same skyline', () => {
  const { b, P } = load('cr'), f = X.pointFrame(P, 0, 0), sky = X.skyline(P, f), a = Date.UTC(2028, 6, 7), e = a + 30 * DAY;
  const m = X.meanInView(f, sky, X.localSamples(skySamples(a, e), b.basis));
  const angle = new Float32Array(360);
  for (let d = 0; d < 360; d++) { const q = d / (360 / X.AZIMUTHS), k = Math.floor(q), w = q - k; angle[d] = sky[k] * (1 - w) + sky[(k + 1) % X.AZIMUTHS] * w; }
  const s = V.visibilitySeries(V.makeSite(b.lat, b.lon, b.centerHeightM, { angle }), a, e), mean = v => v.reduce((x, y) => x + y, 0) / v.length;
  assert.ok(Math.abs(m.sun - mean(s.sun)) < 2e-3, 'sun ' + m.sun + ' against ' + mean(s.sun));
  assert.ok(Math.abs(m.earth - mean(s.earth)) < 2e-3, 'earth ' + m.earth + ' against ' + mean(s.earth));
});

test('exposure: on a smooth sphere every point of the square sees the horizon 0 and half of the year in sunlight', () => {
  const { b } = load('a17');
  const flat = X.blockFrom({ ...X.blockFields(b), near: new Uint16Array(b.res * b.res), far: new Uint16Array(b.farRes * b.farRes), zMin: 0, farMin: 0 });
  const P = X.prepare(flat), loc = X.localSamples(skySamples(Date.UTC(2027, 0, 1), Date.UTC(2028, 0, 1), 6 * 3600000), flat.basis);
  for (const [x, y] of [[0, 0], [-100, 100], [100, -100], [60, 20]]) {
    const f = X.pointFrame(P, x, y), sky = X.skyline(P, f);
    for (const v of sky) assert.ok(Math.abs(v + .087) < .03, 'horizon ' + v);      // 2 m above the sphere: the horizon dips 0.087 deg
    const m = X.meanInView(f, sky, loc);
    assert.ok(Math.abs(m.sun - .5) < .02, 'sun ' + m.sun);
  }
});

test('exposure: rows shared between parts give the same grids as one run', () => {
  const { b, P } = load('cr'), loc = X.localSamples(skySamples(Date.UTC(2028, 6, 7), Date.UTC(2028, 6, 9), 6 * 3600000), b.basis);
  const one = X.exposureGrids(P, loc, loc, { n: 9 }), sun = new Float32Array(81);
  for (let k = 0; k < 2; k++) { const g = X.exposureGrids(P, loc, loc, { n: 9, part: { k, of: 2 } }); for (let r = k; r < 9; r += 2) sun.set(g.sun.subarray(r * 9, r * 9 + 9), r * 9); }
  assert.deepEqual(sun, one.sun);
  assert.ok(Math.min(...one.sun) >= 0 && Math.max(...one.sun) <= 1 && Math.max(...one.sun) > Math.min(...one.sun));
});
