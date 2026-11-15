// Checks of the verdict and the marking of the comparison table (landing-compare.js). Run: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from '../landing-compare.js';

const col = (name, holds, extra = {}) => ({ id: name, name, basis: 'profile', ground: '5 m site profile', coarse: false,
  sun: { share: 1, longestGapHours: 0, longestGapOpen: false }, earth: { share: .98, longestGapHours: 4.92, longestGapOpen: true },
  delay: holds == null ? null : { holds, all: holds === 29 }, ...extra });
const LIMITS = { dark: 6, dte: 12 };

test('compare: the verdict comes from the numbers of the table', () => {
  assert.equal(verdict([col('Shackleton rim', 0), col('Connecting ridge', 5)], LIMITS), 'Connecting ridge holds 5 days of delay, Shackleton rim 0.');
  assert.equal(verdict([col('A', 1), col('B', -1), col('C', 29)], LIMITS), 'C holds 29+ days of delay, A 1, B is not viable on the landing date.');
  assert.equal(verdict([col('A', 1), col('B', 0)], LIMITS), 'A holds 1 day of delay, B 0.');
  assert.equal(verdict([col('A', -1), col('B', -1)], LIMITS), 'A is not viable on the landing date, B is not viable on the landing date.');
  // coarse ground gives no days of delay, and different ground is named
  assert.equal(verdict([col('A', 5), col('B', 3, { coarse: true, basis: 'globe' })], LIMITS),
    'A holds 5 days of delay. No reliable answer for B on coarse ground: open the terrain. The values rest on different ground.');
  // no limit set: nothing to hold, the share of sunlight is compared
  assert.equal(verdict([col('A', null, { sun: { share: .99 } }), col('B', null)], { dark: null, dte: null }),
    'B has the Sun in view 100.0 % of the time, A 99.0 %. Set a limit in the sidebar to compare the days of delay.');
});
