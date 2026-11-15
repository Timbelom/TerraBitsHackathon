// Checks of core/delay.js (the delay row of the info cards). Run: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import * as S from '../core/sky.js';
import * as V from '../core/visibility.js';
import { delayTable, delayVerdict, delayText, delayStep, DELAY_DAYS, DEFAULT_MISSION_MS } from '../core/delay.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p));
const json = p => JSON.parse(read(p));
const buf = p => { const b = read(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const DAY = 86400000, HOUR = 3600000;
const sites = json('expiry-date/data/sites.json').sites;
// the two sites with a 5 m profile: Connecting ridge and Shackleton rim
const site = id => { const d = sites.find(s => s.id === id), h = V.horizonFromProfile(json('expiry-date/' + d.horizon)); return V.makeSite(d.lat, d.lon, h.heightM, h); };
const LANDING = Date.UTC(2028, 6, 7), LIMITS = { dark: 6, dte: 12 };
const useHorizons = () => S.setHorizons(new S.HorizonsSky(json('expiry-date/data/sky_meta.json'), buf('expiry-date/data/sky_2027_2066.bin')));

test('delay: every day of delay gives the numbers of spanMetrics for the same window', () => {
  useHorizons();
  // hourly with a 10 day mission; a mission that is no whole number of days or hours; a 2 h step; a landing off the full hour
  for (const [landing, mission, step] of [[LANDING, 10 * DAY, HOUR], [LANDING, 3.5 * DAY + 20 * 60000, HOUR], [LANDING, 30 * DAY, 2 * HOUR], [LANDING + 47 * 60000, 10 * DAY, HOUR]]) {
    for (const id of ['cr', 'sh']) {
      const s = site(id), t = delayTable(s, landing, mission, step);
      assert.equal(t.days, DELAY_DAYS); assert.equal(t.source, 'horizons');
      for (let k = 0; k < t.days; k++) {
        const m = V.spanMetrics(s, landing + k * DAY, landing + k * DAY + mission, step);
        assert.ok(Math.abs(m.sun.longestGapHours - t.dark[k]) < 0.02, `${id} day ${k}: darkness ${t.dark[k]} against ${m.sun.longestGapHours}`);
        assert.ok(Math.abs(m.earth.longestGapHours - t.outage[k]) < 0.02, `${id} day ${k}: outage ${t.outage[k]} against ${m.earth.longestGapHours}`);
        assert.equal(!!t.darkOpen[k], m.sun.longestGapOpen); assert.equal(!!t.outageOpen[k], m.earth.longestGapOpen);
      }
    }
  }
});

test('delay: Connecting ridge, landing 2028-07-07, 10 days, limits 6 h darkness and 12 h outage', () => {
  useHorizons();
  const t = delayTable(site('cr'), LANDING, DEFAULT_MISSION_MS), v = delayVerdict(t, LIMITS);
  assert.equal(DEFAULT_MISSION_MS, 10 * DAY);
  // days 0 to 5 hold, day 6 fails: the Earth is then out of view for more than 12 h at the end of the mission
  assert.deepEqual(v.ok.slice(0, 7), [true, true, true, true, true, true, false]);
  assert.equal(v.holds, 5); assert.equal(v.all, false);
  assert.equal(delayText(v), 'holds for 5 days of delay');
  assert.ok(t.dark.every(h => h === 0), 'no darkness in any of the 30 windows');
  assert.ok(t.outage[5] === 0 && Math.abs(t.outage[6] - 16.33) < 0.01 && t.outageOpen[6] === 1);
  // the same landing at Shackleton rim: it holds on the day itself, a day later the Sun is gone for more than 6 h
  const sh = delayTable(site('sh'), LANDING, DEFAULT_MISSION_MS), w = delayVerdict(sh, LIMITS);
  assert.deepEqual(w.ok.slice(0, 2), [true, false]);
  assert.equal(w.holds, 0); assert.equal(delayText(w), 'holds for 0 days of delay');
  assert.ok(Math.abs(sh.dark[0] - 2.46) < 0.01 && Math.abs(sh.dark[1] - 26.46) < 0.01);
});

test('delay: limits that are off do not count, and the three kinds of answer', () => {
  const table = (dark, outage) => ({ days: dark.length, dark: Float64Array.from(dark), outage: Float64Array.from(outage) });
  const t = table([0, 0, 7, 0], [0, 13, 0, 0]);
  assert.equal(delayVerdict(t, { dark: null, dte: null }), null);                       // nothing to judge
  assert.deepEqual(delayVerdict(t, { dark: 6, dte: null }).ok, [true, true, false, true]);
  assert.deepEqual(delayVerdict(t, { dark: null, dte: 12 }).ok, [true, false, true, true]);
  assert.equal(delayVerdict(t, { dark: 6, dte: 12 }).holds, 0);
  assert.equal(delayVerdict(t, { dark: 6, dte: null }).holds, 1);
  assert.equal(delayText(delayVerdict(t, { dark: 6, dte: null })), 'holds for 1 day of delay');
  assert.equal(delayVerdict(t, { dark: 7, dte: 13 }).holds, 3);                         // a gap as long as its limit is within it
  assert.equal(delayText(delayVerdict(table(new Array(30).fill(0), new Array(30).fill(0)), { dark: 6, dte: 12 })), 'holds for 29+ days');
  assert.equal(delayText(delayVerdict(table([7, 0], [0, 0]), { dark: 6, dte: 12 })), 'not viable on the landing date');
});

test('delay: the sampling step divides a day', () => {
  assert.equal(delayStep(10 * DAY), HOUR);
  assert.equal(delayStep(375 * DAY), HOUR);                 // 9000 h: still hourly, as the cards
  assert.equal(delayStep(376 * DAY), 2 * HOUR);
  assert.equal(delayStep(5 * 365 * DAY), 6 * HOUR);         // 5 h would be enough, 6 h is the next step that divides a day
  assert.equal(delayStep(40 * 365 * DAY), 24 * HOUR);
});
