// Mean sunlight and mean Earth contact for the ground of the terrain view (core/exposure.js), worked out in
// workers when one of the two surfaces is chosen there. Time window: the span the plot and the time bar cover
// (Start to Stop, or the two lunar days from the simulated time). The Sun is sampled hourly up to 30 days and in
// wider steps beyond (at most 720 samples), the Earth, which moves slowly, at most 240 times.
import { skySamples } from './core/area.js';
import { blockFields, prepare, localSamples, exposureGrids, POINTS } from './core/exposure.js';
import { HOUR_MS } from './core/visibility.js';

const SUN_SAMPLES = 720, EARTH_SAMPLES = 240;

/** window(): { a, b, free } UTC ms; skyVersion(): changes when the sky source changed. */
export function createExposure({ window: spanWindow, skyVersion }) {
  // the workers share the rows of the grid (row number modulo their count)
  const POOL = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 2) - 2));
  let workers = null, sync = false, sentBlock = null, job = null, nextId = 1, result = null;

  function start() {
    try {
      workers = Array.from({ length: POOL }, () => {
        const w = new Worker(new URL('./core/exposure-worker.js', import.meta.url), { type: 'module' });
        w.onmessage = e => {
          const m = e.data;
          if (!job || m.id !== job.id) return;
          if (!m.grids) { job.progress[m.part.k] = m.progress; return; }
          const n = m.grids.n;
          job.sun ??= new Float32Array(n * n); job.earth ??= new Float32Array(n * n);
          for (let r = m.part.k; r < n; r += m.part.of) { job.sun.set(m.grids.sun.subarray(r * n, r * n + n), r * n); job.earth.set(m.grids.earth.subarray(r * n, r * n + n), r * n); }
          if (!--job.left) { result = { ...job.info, n, sun: job.sun, earth: job.earth }; job = null; }
        };
        w.onerror = () => { workers?.forEach(x => x.terminate()); workers = null; sync = true; job = null; };
        return w;
      });
    } catch { workers = null; sync = true; }
  }
  /**
   * Call once per frame while one of the two surfaces is wanted for `block`. Returns the grids for the present
   * window { key, block, a, b, free, sunStepH, n, sun, earth } once they are there, otherwise null; progress()
   * says how far the calculation is.
   */
  function update(block) {
    const w = spanWindow(), key = w.a + '|' + w.b + '|' + skyVersion();
    if (result && result.block === block && result.key === key) return result;
    if (job) return null;                                  // one at a time; what is wanted then is asked for when it is done
    const hours = (w.b - w.a) / HOUR_MS, sunStep = Math.max(1, Math.ceil(hours / SUN_SAMPLES)), earthStep = Math.max(sunStep, Math.ceil(hours / EARTH_SAMPLES));
    const sun = skySamples(w.a, w.b, sunStep * HOUR_MS), earth = skySamples(w.a, w.b, earthStep * HOUR_MS);
    const info = { key, block, a: w.a, b: w.b, free: !!w.free, sunStepH: sunStep };
    if (!workers && !sync) start();
    if (workers) {
      if (sentBlock !== block) { sentBlock = block; const f = blockFields(block); workers.forEach(x => x.postMessage({ block: f })); }
      job = { id: nextId++, info, left: POOL, progress: new Array(POOL).fill(0), sun: null, earth: null };
      workers.forEach((x, k) => x.postMessage({ id: job.id, sun, earth, part: { k, of: POOL } }));
      return null;
    }
    // no module workers: on the page, on a coarser grid so the page does not stand still for long
    const g = exposureGrids(prepare(block), localSamples(sun, block.basis), localSamples(earth, block.basis), { n: (POINTS - 1) / 4 + 1 });
    return result = { ...info, ...g };
  }
  return { update, progress: () => job ? Math.min(...job.progress) : 0, get busy() { return !!job; } };
}
