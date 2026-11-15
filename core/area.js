// The area of the Moon that keeps within the two limits of the sidebar: for every cell of a global grid, the
// longest stretch of a time window without the Sun (darkness) and without the Earth (no direct-to-Earth link).
// The page marks the cells where both stay within "Max. eclipse" and "Max. DTE outage".
// No page, no three.js: runs in the browser (in a worker, core/area-worker.js) and in Node (tests/).
//
// Same definitions as core/visibility.js, which the info cards use for single points:
//   in view     at least 50 % of the disc above the skyline at the azimuth of the disc centre
//   stretch     from one 50 % crossing to the next, the crossing interpolated linearly between two samples;
//               a stretch that runs into the start or the end of the window counts as far as the window goes
//   Sun         radius 0.2666 deg, direction from the Moon's centre
//   Earth       radius from its distance, direction from the cell itself (parallax up to 0.26 deg)
// What differs is the ground. A single point gets the best horizon there is for it (5 m profile, LDEM64 block);
// the whole Moon can only be done on the skyline map (tools/build_horizon.mjs): 0.5 deg cells (15 km at the
// equator), 24 azimuths, skyline from the 7.6 km LOLA grid, stored in steps of 0.14 deg. Between the azimuths
// the skyline is interpolated linearly, as the shadows of the Moon mesh do. So the area shows where basins,
// large craters and ranges decide; at a polar ridge a marked point's own card is the better number.
// The receiver stands 2 m above the reference sphere for the Earth's parallax (ground height left out there:
// under 0.002 deg). Without a skyline map the horizon is the horizontal (smooth sphere).
import { RAD, MOON_RADIUS_KM } from './frames.js';
import { skyAt } from './sky.js';
import { discFraction, SUN_RADIUS_DEG, EARTH_RADIUS_KM, RECEIVER_HEIGHT_M, IN_VIEW, HOUR_MS } from './visibility.js';

export const AREA_WIDTH = 720, AREA_HEIGHT = 360;         // cells of 0.5 deg; row 0 = southernmost, column 0 = longitude -180
/** Latitude and longitude (deg, -180..180) of a cell centre. */
export const cellCenter = (row, col, width = AREA_WIDTH, height = AREA_HEIGHT) => [-90 + (row + .5) * 180 / height, -180 + (col + .5) * 360 / width];
/** Index of the cell a point lies in. */
export function cellAt(latDeg, lonDeg, width = AREA_WIDTH, height = AREA_HEIGHT) {
  const row = Math.min(height - 1, Math.max(0, Math.floor((latDeg + 90) / 180 * height)));
  const col = Math.floor((((lonDeg + 180) % 360 + 360) % 360) / 360 * width) % width;
  return row * width + col;
}

/**
 * The skyline map ready for the calculation. bytes, meta: data/globe/horizon_*.bin and .json; both null: smooth sphere.
 * lo, hi: lowest and highest skyline of each cell over all azimuths (deg).
 */
export function makeSkyline(bytes = null, meta = null) {
  const width = meta ? meta.width : AREA_WIDTH, height = meta ? meta.height : AREA_HEIGHT, n = width * height;
  const lo = new Float32Array(n), hi = new Float32Array(n);
  if (!bytes) return { width, height, azimuths: 0, bytes: null, minDeg: 0, stepDeg: 0, lo, hi, basis: 'smooth' };
  if (bytes.length !== n * meta.azimuths) throw new Error('skyline map has ' + bytes.length + ' bytes, expected ' + n * meta.azimuths);
  const stepDeg = meta.span_deg / 255;
  for (let i = 0; i < n; i++) {
    let a = 255, b = 0;
    for (let k = 0; k < meta.azimuths; k++) { const v = bytes[k * n + i]; if (v < a) a = v; if (v > b) b = v; }
    lo[i] = meta.min_deg + a * stepDeg; hi[i] = meta.min_deg + b * stepDeg;
  }
  return { width, height, azimuths: meta.azimuths, bytes, minDeg: meta.min_deg, stepDeg, lo, hi, basis: 'globe' };
}

/**
 * Sun and Earth at evenly spaced times from startMs to endMs (inclusive; default hourly), Moon-fixed frame:
 * sun: unit vectors, earth: km from the Moon's centre, three numbers per sample.
 */
export function skySamples(startMs, endMs, stepMs = HOUR_MS) {
  const n = Math.max(2, Math.floor((endMs - startMs) / stepMs) + 1), sun = new Float64Array(3 * n), earth = new Float64Array(3 * n), s = {};
  let analytic = 0;
  for (let i = 0; i < n; i++) {
    skyAt(startMs + i * stepMs, s);
    sun.set(s.sun, 3 * i); earth.set(s.earth, 3 * i);
    if (s.source !== 'horizons') analytic++;
  }
  return { startMs, stepMs, n, sun, earth, source: analytic === 0 ? 'horizons' : analytic === n ? 'analytic' : 'mixed' };
}

// Longest stretch out of view per cell for one body. A cell is not looked at every hour. Where the body stands clear
// above the cell's highest skyline, or clear below its lowest, by an angle D, nothing can change there for D / w
// samples, w being the most the body's direction moves from one sample to the next in this window (Sun about
// 0.51 deg per hour, Earth far less). The cell is looked at again only then. That test needs no angle: the sines are
// compared (a difference of sines is never more than the difference of the angles).
// Closer to the skyline the test is repeated with the skyline around the body's azimuth only (the two map azimuths
// it lies between and one more on each side), which holds while the azimuth moves by less than one map step.
// Only where that fails too is the skyline in the body's direction worked out; the body is in view when its centre
// stands above it (that is 50 % of the disc). When a cell changes between in view and out of view, the disc
// fractions of the sample before and of this one give the moment of the crossing, as in core/visibility.js.
// Cells wait in one list per sample (head, link). A cell whose stretch has passed capH is closed (Infinity).
const IN = 0, OUT = 1;
function bodyGaps(sk, samples, body, capH, part, onProgress) {
  const W = sk.width, H = sk.height, N = W * H, n = samples.n, stepH = samples.stepMs / HOUR_MS, capSteps = capH / stepH;
  const isEarth = body === 'earth', vec = isEarth ? samples.earth : samples.sun;
  const r = isEarth ? MOON_RADIUS_KM + RECEIVER_HEIGHT_M / 1000 : 0;
  // over the window: the largest radius of the disc, and the largest turn of the direction between two samples
  let rMax = SUN_RADIUS_DEG, turn = 0, dMin = Infinity;
  for (let t = 0; t < n; t++) {
    const x = vec[3 * t], y = vec[3 * t + 1], z = vec[3 * t + 2], d = Math.sqrt(x * x + y * y + z * z);
    if (d < dMin) dMin = d;
    if (t) { const px = vec[3 * t - 3], py = vec[3 * t - 2], pz = vec[3 * t - 1], pd = Math.sqrt(px * px + py * py + pz * pz), cx = py * z - pz * y, cy = pz * x - px * z, cz = px * y - py * x;
      turn = Math.max(turn, Math.atan2(Math.sqrt(cx * cx + cy * cy + cz * cz), px * x + py * y + pz * z) / RAD * (isEarth ? Math.max(d, pd) / (Math.min(d, pd) - r) : 1)); }
  }
  if (isEarth) rMax = Math.asin(EARTH_RADIUS_KM / (dMin - r)) / RAD;
  // seen from a cell the Earth's direction turns with the Earth's own motion; the change of its distance shifts the
  // parallax (0.26 deg at most) by far less than the 0.01 deg allowed for here
  const w = turn * 1.01 + .01, clear = .02;
  const bytes = sk.bytes, NA = sk.azimuths, azStep = 360 / (NA || 1), minDeg = sk.minDeg, stepDeg = sk.stepDeg;
  // near the skyline (elevation up to 31 deg, and 12 samples further on) the azimuth moves at most 1.3 w per sample
  const nearWait = Math.max(1, Math.min(12, Math.floor(azStep / (1.3 * w)) - 1));
  const sl = new Float64Array(H), cl = new Float64Array(H), so = new Float64Array(W), co = new Float64Array(W);
  for (let j = 0; j < H; j++) { const p = (-90 + (j + .5) * 180 / H) * RAD; sl[j] = Math.sin(p); cl[j] = Math.cos(p); }
  for (let i = 0; i < W; i++) { const l = (-180 + (i + .5) * 360 / W) * RAD; so[i] = Math.sin(l); co[i] = Math.cos(l); }
  const sHi = new Float32Array(N), sLo = new Float32Array(N);
  for (let i = 0; i < N; i++) { sHi[i] = Math.sin(Math.min(90, sk.hi[i] + clear) * RAD) + 1e-6; sLo[i] = Math.sin(Math.max(-90, sk.lo[i] - clear) * RAD) - 1e-6; }
  // elevation of the body's centre above the skyline in its direction (deg) for a cell at sample t, and the disc's radius
  let radius = SUN_RADIUS_DEG;
  function above(idx, t) {
    const j = (idx / W) | 0, i = idx - j * W, c = cl[j], s = sl[j], vx = vec[3 * t], vy = vec[3 * t + 1], vz = vec[3 * t + 2];
    const a = co[i] * vx + so[i] * vy, up = c * a + s * vz;
    const len = isEarth ? Math.sqrt(vx * vx + vy * vy + vz * vz - 2 * r * up + r * r) : 1;
    if (isEarth) radius = Math.asin(EARTH_RADIUS_KM / len) / RAD;
    let skyline = 0;
    if (bytes) {
      const az = Math.atan2(co[i] * vy - so[i] * vx, c * vz - s * a) / RAD, q = (((az % 360) + 360) % 360) / azStep;
      const k0 = Math.floor(q) % NA, f = q - Math.floor(q), k1 = (k0 + 1) % NA;
      skyline = minDeg + (bytes[k0 * N + idx] * (1 - f) + bytes[k1 * N + idx] * f) * stepDeg;
    }
    return Math.asin(Math.max(-1, Math.min(1, (up - r) / len))) / RAD - skyline;
  }
  const state = new Uint8Array(N), gapStart = new Float32Array(N), longest = new Float32Array(N);
  const head = new Int32Array(n).fill(-1), link = new Int32Array(N);
  // every cell of this part's rows is looked at in the first sample
  for (let j = H - 1; j >= 0; j--) if (j % part.of === part.k) for (let i = W - 1; i >= 0; i--) { link[j * W + i] = head[0]; head[0] = j * W + i; }
  for (let t = 0; t < n; t++) {
    const vx = vec[3 * t], vy = vec[3 * t + 1], vz = vec[3 * t + 2], d2 = vx * vx + vy * vy + vz * vz;
    for (let idx = head[t], next; idx >= 0; idx = next) {
      next = link[idx];
      const j = (idx / W) | 0, i = idx - j * W, c = cl[j], s = sl[j];
      const a = co[i] * vx + so[i] * vy, up = c * a + s * vz;              // a: the body's vector towards the cell's meridian, up: along its vertical
      const len = isEarth ? Math.sqrt(d2 - 2 * r * up + r * r) : 1, sinEl = (up - r) / len;   // Earth: from the cell itself
      let now, wait = 1;
      if (sinEl > sHi[idx]) { now = IN; wait = Math.floor((sinEl - sHi[idx]) / RAD / w); }
      else if (sinEl < sLo[idx]) { now = OUT; wait = Math.floor((sLo[idx] - sinEl) / RAD / w); }
      else if (!bytes) now = sinEl < 0 ? OUT : IN;
      else {
        const el = Math.asin(Math.max(-1, Math.min(1, sinEl))) / RAD;
        const az = Math.atan2(co[i] * vy - so[i] * vx, c * vz - s * a) / RAD, q = (((az % 360) + 360) % 360) / azStep;
        const k0 = Math.floor(q) % NA, f = q - Math.floor(q), k1 = (k0 + 1) % NA;
        const b0 = bytes[k0 * N + idx], b1 = bytes[k1 * N + idx], bm = bytes[(k0 + NA - 1) % NA * N + idx], bp = bytes[(k1 + 1) % NA * N + idx];
        const over = el - (minDeg + Math.max(b0, b1, bm, bp) * stepDeg) - clear, under = minDeg + Math.min(b0, b1, bm, bp) * stepDeg - clear - el;
        if (over > 0) { now = IN; wait = Math.min(nearWait, Math.floor(over / w)); }
        else if (under > 0) { now = OUT; wait = Math.min(nearWait, Math.floor(under / w)); }
        else now = el - (minDeg + (b0 * (1 - f) + b1 * f) * stepDeg) < 0 ? OUT : IN;
      }
      if (t === 0) { state[idx] = now; gapStart[idx] = 0; }
      else if (now !== state[idx]) {
        // it changed between the sample before and this one: the 50 % crossing between the two disc fractions
        const fa = discFraction(above(idx, t - 1), radius), fb = discFraction(above(idx, t), radius), x = t - 1 + (fb === fa ? .5 : (IN_VIEW - fa) / (fb - fa));
        if (now === OUT) gapStart[idx] = x; else if (x - gapStart[idx] > longest[idx]) longest[idx] = x - gapStart[idx];
        state[idx] = now;
      }
      if (now === OUT && t - gapStart[idx] > capSteps) { longest[idx] = Infinity; continue; }     // past the cap: closed
      const at = t + (wait < 1 ? 1 : wait);
      if (at < n) { link[idx] = head[at]; head[at] = idx; }
    }
    if (onProgress && (t & 63) === 63) onProgress(t / n);
  }
  const hours = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let g = longest[i];
    if (g !== Infinity && state[i] === OUT) g = Math.max(g, n - 1 - gapStart[i]);       // still out of view at the end of the window
    g *= stepH; hours[i] = g > capH ? Infinity : g;
  }
  return hours;
}

/**
 * Longest darkness and longest time without the Earth for every cell, in hours.
 * skyline: makeSkyline(); samples: skySamples(); capH: stretches longer than this are returned as Infinity
 * (the calculation then stops early for that cell); sun, earth: false leaves that body out (its grid is null);
 * part { k, of }: only the rows whose number leaves k when divided by `of` are worked out, the others stay 0
 * (several workers share the rows; mergeParts puts their grids together); onProgress(0..1).
 * Returns { width, height, sun, earth: Float32Array (row 0 = southernmost, column 0 = longitude -180) | null, windowHours, capH, basis, source }.
 */
export function gapGrids(skyline, samples, { capH = Infinity, sun = true, earth = true, part = { k: 0, of: 1 }, onProgress = null } = {}) {
  const bodies = (sun ? 1 : 0) + (earth ? 1 : 0), share = k => onProgress && (f => onProgress((k + f) / bodies));
  const s = sun ? bodyGaps(skyline, samples, 'sun', capH, part, share(0)) : null;
  const e = earth ? bodyGaps(skyline, samples, 'earth', capH, part, share(sun ? 1 : 0)) : null;
  return { width: skyline.width, height: skyline.height, sun: s, earth: e, windowHours: (samples.n - 1) * samples.stepMs / HOUR_MS, capH, basis: skyline.basis, source: samples.source };
}

/** Copies the rows of a part (gapGrids with part { k, of }) from its grids into the grids of the whole Moon. */
export function mergeParts(whole, partGrids, k, of) {
  const W = whole.width;
  for (const body of ['sun', 'earth']) {
    if (!partGrids[body]) continue;
    whole[body] ??= new Float32Array(W * whole.height);
    for (let j = k; j < whole.height; j += of) whole[body].set(partGrids[body].subarray(j * W, j * W + W), j * W);
  }
  return whole;
}

/**
 * The cells within the limits. dark, dte: limits in hours, null = no limit (that body is not looked at, its grid may be null).
 * Returns share: the part of the Moon's surface within all limits that are set (cells weighted by their area), and
 * mask: one byte per cell for drawing, above 127 = within. The byte follows the margin to the nearer limit over
 * +-EDGE_H hours, so the outline can be drawn between the cell centres instead of along cell edges.
 */
const EDGE_H = 3;
export function withinLimits(grids, dark, dte) {
  const { width: W, height: H, sun, earth } = grids, mask = new Uint8Array(W * H);
  let inside = 0, total = 0;
  for (let j = 0; j < H; j++) {
    const w = Math.cos((-90 + (j + .5) * 180 / H) * RAD);
    for (let i = 0; i < W; i++) {
      const k = j * W + i, margin = Math.min(dark == null ? Infinity : dark - sun[k], dte == null ? Infinity : dte - earth[k]);
      total += w; if (margin >= 0) inside += w;
      // margin 0 (exactly on the limit) is within: 129; anything short of the limit stays at 127 or below
      mask[k] = margin >= 0 ? Math.min(255, 129 + Math.floor(margin / EDGE_H * 126)) : Math.max(0, 127 + Math.ceil(margin / EDGE_H * 127));
    }
  }
  return { mask, share: inside / total };
}
