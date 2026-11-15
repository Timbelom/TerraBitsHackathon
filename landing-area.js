// The two limits of the sidebar as an area on the Moon. "Max. darkness" and "Max. DTE outage" are off at the start.
// As soon as one is set, the part of the Moon that keeps within it over the time window is marked on the globe
// (view/moon-globe.js setArea); with both set, the part that keeps within both (the intersection).
// Time window: Start to Stop of the time bar, or, with no span set, the 24 hours from the simulated time (to the
// hour), so the area then moves with the clock. The info cards compare the limits over the same window.
// The numbers come from core/area.js (see there for the ground they rest on) and are worked out in workers; the
// limits themselves only choose which cells of that result are marked, so moving a slider redraws at once.
import { makeSkyline, skySamples, gapGrids, mergeParts, withinLimits, cellAt } from './core/area.js';
import { HOUR_MS, BASIS_LABEL } from './core/visibility.js';

export const LIMIT_MAX_H = 96;                       // the sliders end here; one step further is "Off"
const MAX_SAMPLES = 20000;                           // hourly up to 2.3 years, coarser steps beyond
const LONG_JOB_SAMPLES = 24 * 4;                     // above 4 days the line under the sliders says that the area is being calculated
const stamp = ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

/**
 * window(): { a, b, free } UTC ms; limits(): { dark, dte } in hours, null = off; skyVersion(): changes when the sky
 * source changed; apply(mask | null, width, height): draw the area; note: element for the line under the sliders.
 */
export function createArea({ window: limitWindow, limits, skyVersion, apply, note }) {
  let skyline = null, skylineVersion = 0;            // { bytes, meta } of the skyline map, null: smooth sphere
  // Several workers share the rows of the grid (row number modulo their count, so each gets its share of polar rows)
  const POOL = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 2) - 2));
  let workers = null, sync = false, job = null, nextId = 1;
  let grids = null, painted = '', said = '';
  const say = text => { if (text !== said) { said = text; note.textContent = text; } };

  const stopWorkers = () => { workers?.forEach(w => w.terminate()); workers = null; job = null; };
  function startWorkers() {
    try {
      workers = Array.from({ length: POOL }, () => {
        const w = new Worker(new URL('./core/area-worker.js', import.meta.url), { type: 'module' });
        w.onmessage = e => {
          const m = e.data;
          if (!job || m.id !== job.id) return;
          if (!m.grids) { job.progress[m.part ? m.part.k : 0] = m.progress; return; }
          job.whole = mergeParts(job.whole ?? { ...m.grids, sun: null, earth: null }, m.grids, m.part.k, m.part.of);
          if (!--job.left) { grids = Object.assign(job.whole, job.info); job = null; }
        };
        w.onerror = () => { stopWorkers(); sync = true; };                   // no module workers here: calculate on the page
        w.postMessage({ skyline });
        return w;
      });
    } catch { stopWorkers(); sync = true; }
  }
  function request(key, w, needSun, needEarth) {
    if (job) return;                                                       // one at a time: when it is done, the window asked for then follows
    const step = Math.max(1, Math.ceil((w.b - w.a) / HOUR_MS / MAX_SAMPLES)) * HOUR_MS, samples = skySamples(w.a, w.b, step);
    const info = { key, a: w.a, b: w.b, free: !!w.free, stepH: step / HOUR_MS, hasSun: needSun, hasEarth: needEarth };
    if (!workers && !sync) startWorkers();
    if (workers) {
      job = { id: nextId++, info, samples: samples.n, left: POOL, whole: null, progress: new Array(POOL).fill(0) };
      workers.forEach((wk, k) => wk.postMessage({ id: job.id, samples, capH: LIMIT_MAX_H, sun: needSun, earth: needEarth, part: { k, of: POOL } }));
    } else grids = Object.assign(gapGrids(makeSkyline(skyline?.bytes, skyline?.meta), samples, { capH: LIMIT_MAX_H, sun: needSun, earth: needEarth }), info);
  }

  /** Call once per frame. */
  function update() {
    const lim = limits(), needSun = lim.dark != null, needEarth = lim.dte != null;
    if (!needSun && !needEarth) {
      if (painted !== 'off') { painted = 'off'; apply(null); }
      say('Set a limit to mark the area of the Moon that stays within it.');
      return;
    }
    const w = limitWindow(), key = w.a + '|' + w.b + '|' + skyVersion() + '|' + skylineVersion;
    const usable = grids && (!needSun || grids.hasSun) && (!needEarth || grids.hasEarth), current = usable && grids.key === key;
    if (!current) request(key, w, needSun, needEarth);
    if (usable) {
      const p = grids.key + '|' + lim.dark + '|' + lim.dte;
      if (painted !== p) {
        painted = p;
        const { mask, share } = withinLimits(grids, lim.dark, lim.dte);
        apply(mask, grids.width, grids.height);
        const pct = share * 100;
        grids.text = (pct > 0 && pct < .1 ? 'Under 0.1' : pct.toFixed(1)) + ' % of the Moon stays within ' + (needSun && needEarth ? 'both limits' : 'the limit')
          + (grids.free ? ' in the 24 h from ' + stamp(grids.a) : ' from ' + stamp(grids.a) + ' to ' + stamp(grids.b)) + ' UTC'
          + (grids.stepH > 1 ? ', sampled every ' + grids.stepH + ' h' : '') + '. Marked on the Moon; terrain data: ' + BASIS_LABEL[grids.basis] + '.';
      }
    }
    // while a long calculation runs the line says so; a short one (the window moving with the clock) just replaces the area
    const waiting = !current && job && (job.samples > LONG_JOB_SAMPLES || !usable);
    const done = waiting ? Math.round(Math.min(...job.progress) * 100) : 0;
    say(waiting ? 'Calculating the area' + (done > 0 ? ', ' + done + ' %' : '') + ' …' : usable ? grids.text : '');
  }
  /** The skyline map has loaded (bytes, meta of data/globe/horizon_*). */
  function setSkyline(bytes, meta) {
    skyline = { bytes, meta }; skylineVersion++;
    if (workers) workers.forEach(w => w.postMessage({ skyline }));
    else if (!sync) {
      // Start the workers now and let each do a few hours once (the result is not used): a worker's first calculation
      // takes seconds, later ones a fraction of that. So the first limit that is set is answered quickly.
      startWorkers();
      const t = limitWindow().a, samples = skySamples(t, t + 6 * HOUR_MS);
      workers?.forEach((wk, k) => wk.postMessage({ id: 0, samples, capH: LIMIT_MAX_H, sun: true, earth: true, part: { k, of: POOL } }));
    }
  }
  /** Draw again (a new Moon mesh was built). */
  function refresh() { painted = ''; }
  /** Longest darkness and longest DTE outage (h; Infinity: more than LIMIT_MAX_H; null: not calculated) of the cell under a point, or null. */
  function at(latDeg, lonDeg) {
    const lim = limits();
    if (!grids || (lim.dark == null && lim.dte == null)) return null;
    const k = cellAt(latDeg, lonDeg, grids.width, grids.height);
    return { sun: lim.dark != null && grids.sun ? grids.sun[k] : null, earth: lim.dte != null && grids.earth ? grids.earth[k] : null, free: grids.free };
  }
  return { update, setSkyline, refresh, at };
}
