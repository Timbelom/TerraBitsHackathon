// How much delay of the landing does a site tolerate? One calculation for the delay row of the info cards
// and the "Days of delay" row of the comparison. No page, no three.js: runs in the browser and in Node (tests/).
//
// A mission lands at landingMs and lasts missionMs. Delayed by k days (k = 0 .. 29) it covers the window
//     [landingMs + k d, landingMs + k d + missionMs].
// For every k the table holds the longest darkness and the longest gap without the Earth in that window, with
// the definitions of viewStats (core/visibility.js): in view from 50 % of the disc, the crossing interpolated
// linearly between two samples, a gap that runs into an end of the window counted as far as the window goes.
// The disc fractions are sampled once, from the landing to the end of the last window; a step divides a day,
// so every window starts on a sample and its numbers are those spanMetrics() gives for the same window.
import { DAY_MS } from './sky.js';
import { visibilitySeries, viewStats, HOUR_MS } from './visibility.js';

export const DELAY_DAYS = 30;                       // k = 0 .. 29
export const DEFAULT_MISSION_MS = 10 * DAY_MS;      // mission length when the page has no time span set
const DAY_STEPS_H = [1, 2, 3, 4, 6, 8, 12, 24];     // steps that divide a day

/** Sampling step (ms) for a mission of this length: hourly up to maxSamples per window, beyond that the next step that divides a day. */
export function delayStep(missionMs, maxSamples = 9000) {
  const h = Math.ceil(missionMs / HOUR_MS / maxSamples);
  return (DAY_STEPS_H.find(s => s >= h) ?? 24) * HOUR_MS;
}

/**
 * The table for one site (makeSite of core/visibility.js). Returns { landingMs, missionMs, stepMs, days, source,
 * dark, outage: Float64Array(days) in hours, darkOpen, outageOpen: Uint8Array(days), 1 = the gap runs into an end of its window }.
 */
export function delayTable(site, landingMs, missionMs, stepMs = HOUR_MS, days = DELAY_DAYS) {
  const perDay = Math.round(DAY_MS / stepMs), n = Math.max(1, Math.floor(missionMs / stepMs) + 1);   // samples per window, as spanMetrics counts them
  const s = visibilitySeries(site, landingMs, landingMs + ((days - 1) * perDay + n - 1) * stepMs, stepMs);
  const dark = new Float64Array(days), outage = new Float64Array(days), darkOpen = new Uint8Array(days), outageOpen = new Uint8Array(days);
  for (let k = 0; k < days; k++) {
    const i = k * perDay, sun = viewStats(s.sun.subarray(i, i + n), stepMs), earth = viewStats(s.earth.subarray(i, i + n), stepMs);
    dark[k] = sun.longestGapHours; darkOpen[k] = +sun.longestGapOpen; outage[k] = earth.longestGapHours; outageOpen[k] = +earth.longestGapOpen;
  }
  return { landingMs, missionMs, stepMs, days, source: s.source, dark, outage, darkOpen, outageOpen };
}

/**
 * The table against the two limits (hours; null = that limit is off and does not count).
 * ok[k]: the mission delayed by k days stays within the limits that are set (a gap as long as its limit is within it,
 * as on the cards). holds: days of delay the site tolerates = the last k before the first that fails; -1 when the
 * landing date itself fails; days - 1 with all: true when none fails. Both limits off: null, there is nothing to judge.
 */
export function delayVerdict(table, limits) {
  const { dark, dte } = limits;
  if (dark == null && dte == null) return null;
  const ok = Array.from({ length: table.days }, (_, k) => (dark == null || table.dark[k] <= dark) && (dte == null || table.outage[k] <= dte));
  const first = ok.indexOf(false);
  return { ok, holds: first < 0 ? table.days - 1 : first - 1, all: first < 0 };
}

/** The verdict in words, e.g. "holds for 5 days of delay". */
export function delayText(v) {
  if (v.holds < 0) return 'not viable on the landing date';
  if (v.all) return 'holds for ' + v.holds + '+ days';
  return 'holds for ' + v.holds + (v.holds === 1 ? ' day' : ' days') + ' of delay';
}
