// Mean sunlight and mean Earth contact for the ground of a terrain block: for a grid of points over the drawn
// square, the mean share of the Sun's disc and of the Earth's disc in view over a time window.
// The terrain view shows them as colour-coded surfaces. No page, no three.js: browser (workers) and Node (tests/).
//
// Each point gets its own skyline, traced through the block's ground:
//   point     its height from the near grid, receiver 2 m above it, its own vertical (10 km from the site the
//             vertical is tilted by 0.33 deg, which matters against a Sun 1.5 deg high)
//   rays      AZIMUTHS directions around the point, along great circles, from two source pixels out to the edge
//             of the far grid; exact angle on the sphere: tan(el) = (rq cos g - rp) / (rq sin g), g = arc
//   steps     half a grid step near the point, growing by 3 % with the distance. In the near grid (to 125 km
//             from the site) heights are read between the nodes as they are. In the far grid, once a step is more
//             than twice as wide as a cell, a max-pooled copy with cells of at most half the step is read, so no
//             range between two samples is missed (far skylines slightly high rather than low)
// Directions are counted in the point's own tangent plane, from the direction of the site's north; the Sun's and
// the Earth's direction are counted the same way, so no convergence of meridians enters (it would at the poles).
// Then, per time sample, the visible share of each disc against that skyline (core/visibility.js definitions:
// straight horizon line across the disc, Sun radius 0.2666 deg, Earth from the point itself), averaged.
//
// Limits: the far grid ends 300 km from the site, so from a point at the edge of the square it reaches 200 km in
// one direction; terrain beyond is not seen. Between two directions the skyline is interpolated linearly.
import { RAD, MOON_RADIUS_KM } from './frames.js';
import { discFraction, SUN_RADIUS_DEG, EARTH_RADIUS_KM, RECEIVER_HEIGHT_M } from './visibility.js';
import { Block } from './terrain.js';

export const POINTS = 129;                // points per side of the drawn square (1.56 km apart on 200 km)
export const AZIMUTHS = 72;               // one ray every 5 deg
const GROWTH = .03, UNRESOLVED_PIXELS = 2, FAR_LEVELS = 4;

/** The fields of a block that describe its ground, for sending to a worker (blockFrom gives the Block back). */
export const blockFields = b => ({ lat: b.lat, lon: b.lon, res: b.res, visibleKm: b.visibleKm, padKm: b.padKm, zMin: b.zMin, zStep: b.zStep, near: b.near,
  farRes: b.farRes, farHalfKm: b.farHalfKm, farMin: b.farMin, farStep: b.farStep, far: b.far, sourceCellM: b.sourceCellM, coarse: b.coarse });
export const blockFrom = f => new Block(f);

// A square grid of heights (m) and max-pooled copies of it: level k has cells of 2^k nodes.
function pyramid(values, n, zero, scale, levels) {
  const base = new Float32Array(n * n);
  for (let i = 0; i < base.length; i++) base[i] = zero + values[i] * scale;
  const out = [{ n, v: base }];
  for (let k = 1; k < levels; k++) {
    const p = out[k - 1], m = Math.ceil(p.n / 2), v = new Float32Array(m * m);
    for (let r = 0; r < m; r++) for (let c = 0; c < m; c++) {
      const r1 = Math.min(2 * r + 1, p.n - 1), c1 = Math.min(2 * c + 1, p.n - 1);
      v[r * m + c] = Math.max(p.v[2 * r * p.n + 2 * c], p.v[2 * r * p.n + c1], p.v[r1 * p.n + 2 * c], p.v[r1 * p.n + c1]);
    }
    out.push({ n: m, v });
  }
  return out;
}

/** What the tracing needs of a block, built once: the far grid's pooled copies and the list of ray steps. */
export function prepare(block) {
  const far = pyramid(block.far, block.farRes, block.farMin, block.farStep, FAR_LEVELS);
  const steps = [], reach = block.farHalfKm * 2;
  for (let d = UNRESOLVED_PIXELS * block.sourceCellM / 1000, w; d < reach; d += w) {
    w = Math.max(block.stepKm / 2, d * GROWTH);
    const g = d / MOON_RADIUS_KM;
    steps.push({ cg: Math.cos(g), sg: Math.sin(g), farLevel: Math.min(FAR_LEVELS - 1, Math.max(0, Math.floor(Math.log2(w / block.farStepKm)) - 1)) });
  }
  return { block, far, steps };
}

// Height (m) at map x, y for a ray step: between the nodes of the grid, or the pooled value of the far grid for wide steps; NaN outside the far grid.
function heightFor(P, x, y, step) {
  const b = P.block;
  if (Math.abs(x) <= b.halfKm && Math.abs(y) <= b.halfKm) return b.heightNear(x, y);
  if (!step.farLevel) return b.heightFar(x, y);
  const last = b.farRes - 1, cf = (x + b.farHalfKm) / b.farStepKm, rf = (b.farHalfKm - y) / b.farStepKm;
  if (!(cf >= 0 && rf >= 0 && cf <= last && rf <= last)) return NaN;
  const L = P.far[step.farLevel];
  return L.v[(Math.round(rf) >> step.farLevel) * L.n + (Math.round(cf) >> step.farLevel)];
}

/**
 * A point of the site's map (x km east, y km north) ready for the calculation: its vertical and the two
 * directions azimuths are counted from, in the site's own axes [east, north, up], and its distance from the
 * Moon's centre (km, receiver height included).
 */
export function pointFrame(P, x, y) {
  const rho = Math.hypot(x, y), chi = rho / MOON_RADIUS_KM, s = rho > 1e-9 ? Math.sin(chi) / rho : 0;
  const up = [s * x, s * y, Math.cos(chi)];
  let n = [-up[1] * up[0], 1 - up[1] * up[1], -up[1] * up[2]];                 // the site's north, laid into the point's tangent plane
  const l = Math.hypot(n[0], n[1], n[2]); n = [n[0] / l, n[1] / l, n[2] / l];
  const e = [n[1] * up[2] - n[2] * up[1], n[2] * up[0] - n[0] * up[2], n[0] * up[1] - n[1] * up[0]];
  return { x, y, up, north: n, east: e, rKm: MOON_RADIUS_KM + (P.block.heightNear(x, y) + RECEIVER_HEIGHT_M) / 1000 };
}

/** Skyline of a point: elevation angle (deg) for AZIMUTHS directions, counted from pointFrame's north towards its east. */
export function skyline(P, f, out = new Float32Array(AZIMUTHS)) {
  const R = MOON_RADIUS_KM, { up, north, east, rKm } = f, steps = P.steps;
  for (let k = 0; k < AZIMUTHS; k++) {
    const a = k * 2 * Math.PI / AZIMUTHS, ca = Math.cos(a), sa = Math.sin(a);
    const hx = ca * north[0] + sa * east[0], hy = ca * north[1] + sa * east[1], hz = ca * north[2] + sa * east[2];
    let best = -Infinity;
    for (let i = 0; i < steps.length; i++) {
      const st = steps[i], qx = st.cg * up[0] + st.sg * hx, qy = st.cg * up[1] + st.sg * hy, qz = st.cg * up[2] + st.sg * hz;
      if (qz <= 0) break;
      const s2 = qx * qx + qy * qy, m = R * (1 + s2 * (1 / 6 + s2 * (3 / 40 + s2 * 15 / 336)));      // arc / sine of the arc from the site, as a series
      const z = heightFor(P, m * qx, m * qy, st);
      if (z !== z) break;                                  // beyond the data in this direction
      const rq = R + z / 1000, t = (rq * st.cg - rKm) / (rq * st.sg);
      if (t > best) best = t;
    }
    out[k] = best > -Infinity ? Math.atan(best) / RAD : -90;
  }
  return out;
}

/**
 * Sun and Earth of a time window in the site's own axes. samples: skySamples() of core/area.js (Moon-fixed frame);
 * basis: block.basis. Returns { n, sun: unit vectors [east, north, up], earth: km from the Moon's centre }.
 */
export function localSamples(samples, basis) {
  const n = samples.n, sun = new Float64Array(3 * n), earth = new Float64Array(3 * n), ax = [basis.east, basis.north, basis.up];
  for (let t = 0; t < n; t++) for (let k = 0; k < 3; k++) {
    const a = ax[k];
    sun[3 * t + k] = a[0] * samples.sun[3 * t] + a[1] * samples.sun[3 * t + 1] + a[2] * samples.sun[3 * t + 2];
    earth[3 * t + k] = a[0] * samples.earth[3 * t] + a[1] * samples.earth[3 * t + 1] + a[2] * samples.earth[3 * t + 2];
  }
  return { n, sun, earth };
}

/** Mean visible share of the Sun's and of the Earth's disc at a point over the samples: { sun, earth }, 0..1. */
export function meanInView(f, sky, local, out = {}) {
  const { up, north, east, rKm } = f, n = local.n;
  let hi = -90, lo = 90;
  for (let k = 0; k < AZIMUTHS; k++) { if (sky[k] > hi) hi = sky[k]; if (sky[k] < lo) lo = sky[k]; }
  for (const body of ['sun', 'earth']) {
    const isEarth = body === 'earth', v = local[body], r = isEarth ? rKm : 0, rMax = isEarth ? 1.0 : SUN_RADIUS_DEG;
    const sHi = Math.sin(Math.min(90, hi + rMax) * RAD), sLo = Math.sin(Math.max(-90, lo - rMax) * RAD);
    let sum = 0;
    for (let t = 0; t < n; t++) {
      const x = v[3 * t], y = v[3 * t + 1], z = v[3 * t + 2], along = x * up[0] + y * up[1] + z * up[2];
      const len = isEarth ? Math.sqrt(x * x + y * y + z * z - 2 * r * along + r * r) : 1, sinEl = (along - r) / len;
      if (sinEl >= sHi) { sum += 1; continue; }
      if (sinEl <= sLo) continue;
      const q = ((Math.atan2(x * east[0] + y * east[1] + z * east[2], x * north[0] + y * north[1] + z * north[2]) / (2 * Math.PI) + 1) % 1) * AZIMUTHS;
      const k0 = Math.floor(q) % AZIMUTHS, w = q - Math.floor(q), horizon = sky[k0] * (1 - w) + sky[(k0 + 1) % AZIMUTHS] * w;
      sum += discFraction(Math.asin(Math.max(-1, Math.min(1, sinEl))) / RAD - horizon, isEarth ? Math.asin(EARTH_RADIUS_KM / len) / RAD : SUN_RADIUS_DEG);
    }
    out[body] = sum / n;
  }
  return out;
}

/**
 * The two grids for a block. P: prepare(block); sunLocal, earthLocal: localSamples() of the windows for the Sun
 * and for the Earth (the Earth moves slowly and can be sampled more coarsely); part { k, of }: only the rows
 * whose number leaves k when divided by `of` (workers share the rows); onProgress(0..1).
 * Returns { n, sun, earth }: Float32Array n x n, row 0 = northern edge of the drawn square, column 0 = western edge.
 */
export function exposureGrids(P, sunLocal, earthLocal, { n = POINTS, part = { k: 0, of: 1 }, onProgress = null } = {}) {
  const b = P.block, half = b.visibleKm / 2, step = b.visibleKm / (n - 1), sun = new Float32Array(n * n), earth = new Float32Array(n * n);
  const sky = new Float32Array(AZIMUTHS), m = {}, local = { n: 0, sun: null, earth: null };
  for (let r = part.k; r < n; r += part.of) {
    for (let c = 0; c < n; c++) {
      const f = pointFrame(P, -half + c * step, half - r * step);
      skyline(P, f, sky);
      local.n = sunLocal.n; local.sun = sunLocal.sun; local.earth = sunLocal.earth; const s = meanInView(f, sky, local, m).sun;
      local.n = earthLocal.n; local.sun = earthLocal.sun; local.earth = earthLocal.earth; meanInView(f, sky, local, m);
      sun[r * n + c] = s; earth[r * n + c] = m.earth;
    }
    onProgress?.((r + 1) / n);
  }
  return { n, sun, earth };
}
