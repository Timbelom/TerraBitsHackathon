// Can a site see the Sun and the Earth? One calculation for every number the page shows:
// info cards, time series, the two limits of the sidebar and the terrain view all call these functions.
// No page, no three.js: runs in the browser and in Node (tests/).
//
// Definitions
//   Horizon   360 values, one per degree of azimuth (clockwise from north): the elevation angle of the
//             skyline as seen from the site, 2 m above the ground. It may be negative: from a summit the
//             horizon lies below the horizontal.
//   Visible   the fraction of the Sun's or the Earth's disc above the horizon at the azimuth of the disc
//             centre (straight horizon line across the disc). A body counts as "in view" from 50 %.
//   Sun       radius 0.2666 deg, direction from the Moon's centre (parallax 0.0007 deg).
//   Earth     radius from its distance (about 0.95 deg), direction from the site itself (parallax up to 0.26 deg).
//   No atmosphere, so no refraction. Sampling: hourly, as the Horizons table.
import { RAD, MOON_RADIUS_KM, unitFromLatLon, localBasis, azEl } from './frames.js';
import { skyAt } from './sky.js';

export const SUN_RADIUS_DEG = 0.2666;
export const EARTH_RADIUS_KM = 6371.0;
export const RECEIVER_HEIGHT_M = 2;
export const IN_VIEW = 0.5;
export const HOUR_MS = 3600000;

/** Fraction of a disc of radius r whose centre stands d above a straight horizon line (same unit for both). */
export function discFraction(d, r) {
  if (d >= r) return 1;
  if (d <= -r) return 0;
  return 0.5 + (d * Math.sqrt(r * r - d * d) / (r * r) + Math.asin(d / r)) / Math.PI;
}

/**
 * A site ready for the calculation. horizon: { angle: 360 values in deg, basis, ... } or null (smooth sphere).
 * heightM: height of the ground above the reference sphere (enters the Earth's parallax only).
 */
export function makeSite(latDeg, lonDeg, heightM = 0, horizon = null) {
  const b = localBasis(unitFromLatLon(latDeg, lonDeg));
  return { lat: latDeg, lon: lonDeg, heightM, rKm: MOON_RADIUS_KM + (heightM + RECEIVER_HEIGHT_M) / 1000, up: b.up, east: b.east, north: b.north, horizon };
}

/** Horizon height (deg) at an azimuth; 0 for a site without a horizon profile. */
export function horizonAt(horizon, azDeg) {
  if (!horizon) return 0;
  const a = ((azDeg % 360) + 360) % 360, i = Math.floor(a) % 360, f = a - Math.floor(a), ang = horizon.angle;
  return ang[i] * (1 - f) + ang[(i + 1) % 360] * f;
}

const sky = {};
/**
 * Sun and Earth at a site for a UTC time (ms). For each body: az, el (deg, disc centre against the local
 * horizontal), radius (deg), horizon (deg, the skyline at that azimuth) and frac (visible share of the disc, 0..1).
 */
export function siteState(ms, site, out = { sun: {}, earth: {} }) {
  const s = skyAt(ms, sky), r = site.rKm, up = site.up;
  const toEarth = [s.earth[0] - r * up[0], s.earth[1] - r * up[1], s.earth[2] - r * up[2]];
  const sun = azEl(s.sun, site), earth = azEl(toEarth, site);
  const eRad = Math.asin(EARTH_RADIUS_KM / Math.hypot(toEarth[0], toEarth[1], toEarth[2])) / RAD;
  const hs = horizonAt(site.horizon, sun.az), he = horizonAt(site.horizon, earth.az);
  out.sun.az = sun.az; out.sun.el = sun.el; out.sun.radius = SUN_RADIUS_DEG; out.sun.horizon = hs; out.sun.frac = discFraction(sun.el - hs, SUN_RADIUS_DEG);
  out.earth.az = earth.az; out.earth.el = earth.el; out.earth.radius = eRad; out.earth.horizon = he; out.earth.frac = discFraction(earth.el - he, eRad);
  out.source = s.source;
  return out;
}

/**
 * Visibility over a time span, one sample per step (default: hourly, from startMs to endMs inclusive).
 * sun, earth: visible share of the disc; sunAbove: elevation of the Sun's centre above the skyline (deg).
 */
export function visibilitySeries(site, startMs, endMs, stepMs = HOUR_MS) {
  const n = Math.max(1, Math.floor((endMs - startMs) / stepMs) + 1);
  const sun = new Float32Array(n), earth = new Float32Array(n), sunAbove = new Float32Array(n), st = { sun: {}, earth: {} };
  let analytic = 0;
  for (let i = 0; i < n; i++) {
    siteState(startMs + i * stepMs, site, st);
    sun[i] = st.sun.frac; earth[i] = st.earth.frac; sunAbove[i] = st.sun.el - st.sun.horizon;
    if (st.source !== 'horizons') analytic++;
  }
  return { startMs, stepMs, n, sun, earth, sunAbove, source: analytic === 0 ? 'horizons' : analytic === n ? 'analytic' : 'mixed' };
}

/**
 * Hours "in view" and the longest stretch out of view in a series of disc fractions.
 * The moment a fraction crosses 50 % is interpolated linearly between two samples, so a stretch is not
 * rounded to whole steps. A stretch that runs into the start or the end of the series is counted as far as
 * the series goes (open: true): its true length may be longer.
 */
export function viewStats(frac, stepMs = HOUR_MS) {
  const n = frac.length, stepH = stepMs / HOUR_MS;
  let inView = 0, longest = 0, longestOpen = false, gapStart = frac[0] < IN_VIEW ? 0 : -1, open = gapStart === 0;
  const close = (end, isOpen) => {
    const len = (end - gapStart) * stepH;
    if (len > longest) { longest = len; longestOpen = isOpen; }
  };
  for (let i = 1; i < n; i++) {
    const a = frac[i - 1], b = frac[i], ia = a >= IN_VIEW, ib = b >= IN_VIEW;
    if (ia && ib) inView += 1;
    else if (!ia && !ib) { /* still out of view */ }
    else {
      const x = (IN_VIEW - a) / (b - a);                 // crossing between the two samples, 0..1
      if (ia) { inView += x; gapStart = i - 1 + x; open = false; }
      else { inView += 1 - x; close(i - 1 + x, open); gapStart = -1; }
    }
  }
  if (gapStart >= 0) close(n - 1, true);
  const hours = (n - 1) * stepH;
  return { hours, inViewHours: inView * stepH, share: hours > 0 ? inView / (n - 1) : (frac[0] >= IN_VIEW ? 1 : 0), longestGapHours: longest, longestGapOpen: longestOpen };
}

/** The numbers of a span for one site: sunlight, Earth contact, longest darkness, longest gap without Earth. */
export function spanMetrics(site, startMs, endMs, stepMs = HOUR_MS) {
  const s = visibilitySeries(site, startMs, endMs, stepMs);
  return { startMs, endMs: startMs + (s.n - 1) * stepMs, source: s.source, sun: viewStats(s.sun, stepMs), earth: viewStats(s.earth, stepMs), series: s };
}

/**
 * UTC time (ms) of the next moment a body ('sun' | 'earth') passes 50 % visibility after ms, or null if it
 * does not within the search (hourly for 60 days, then every 6 h up to endMs; found to the minute).
 */
export function nextChange(ms, site, body, endMs) {
  const st = { sun: {}, earth: {} }, inView = t => siteState(t, site, st)[body].frac >= IN_VIEW, now = inView(ms);
  const FINE = 60 * 24 * HOUR_MS;
  for (let a = ms, t = ms + HOUR_MS; a < endMs; a = t, t += (t - ms < FINE ? 1 : 6) * HOUR_MS) {
    if (inView(t) === now) continue;
    let lo = a, hi = t;
    while (hi - lo > 60000) { const m = (lo + hi) / 2; if (inView(m) === now) lo = m; else hi = m; }
    return hi;
  }
  return null;
}

// --- Horizon profiles ------------------------------------------------------------------------
// Rays leave the site along great circles. Every sample gives an elevation angle against the local
// horizontal with exact spherical geometry, so the Moon's curvature is included:
//     tan(el) = ((R + z) cos(theta) - r0) / ((R + z) sin(theta)),   theta = distance / R,   r0 = R + z0 + 2 m
// Rays are cast every 0.25 deg; value i is the highest angle within azimuth i +- 0.5 deg, so the profile is
// never lower than the sampled skyline. Same rule as the 5 m profiles of Expiry Date (tools/build_horizon.py).
function traceHorizon(heightAt, z0M, distancesKm) {
  const r0 = MOON_RADIUS_KM + (z0M + RECEIVER_HEIGHT_M) / 1000, RAYS = 1440;
  const ang = new Float32Array(RAYS), dist = new Float32Array(RAYS);
  const cos = distancesKm.map(d => Math.cos(d / MOON_RADIUS_KM)), sin = distancesKm.map(d => Math.sin(d / MOON_RADIUS_KM));
  for (let k = 0; k < RAYS; k++) {
    const az = k / 4 * RAD, sx = Math.sin(az), sy = Math.cos(az);
    let best = -Infinity, bestD = 0;
    for (let i = 0; i < distancesKm.length; i++) {
      const d = distancesKm[i], z = heightAt(d * sx, d * sy);
      if (z !== z) break;                                 // NaN: beyond the data in this direction
      const rq = MOON_RADIUS_KM + z / 1000, t = (rq * cos[i] - r0) / (rq * sin[i]);
      if (t > best) { best = t; bestD = d; }
    }
    ang[k] = Math.atan(best) / RAD; dist[k] = bestD;
  }
  const angle = new Float32Array(360), distanceKm = new Float32Array(360);
  for (let i = 0; i < 360; i++) {
    let m = -Infinity, md = 0;
    for (let j = -2; j <= 2; j++) { const k = (i * 4 + j + RAYS) % RAYS; if (ang[k] > m) { m = ang[k]; md = dist[k]; } }
    angle[i] = m; distanceKm[i] = md;
  }
  return { angle, distanceKm };
}
const range = (from, to, step) => { const out = []; for (let d = from; d < to - 1e-9; d += step) out.push(d); return out; };

// Where the trace starts. A raster says nothing independent about ground closer than two of its pixels:
// between neighbouring pixels the surface is interpolation, and the site's own height comes from the same
// few values. Traced from closer in, the skyline follows that interpolation (at Connecting ridge it rises
// by 1.2 deg on average). So the trace starts two source pixels out; nearer ground counts as open.
// For LDEM64 that is 0.95 km. The site stands 2 m above the interpolated surface.
const UNRESOLVED_PIXELS = 2;

/**
 * Horizon of the site at the centre of a terrain block (core/terrain.js): from two source pixels out, half a
 * grid step apart as far as the near grid reaches, then every 0.5 km through the far grid to its edge
 * (300 km, more along the diagonals).
 */
export function horizonFromBlock(block) {
  const near = block.stepKm / 2, nearCorner = block.halfKm * Math.SQRT2, farCorner = block.farHalfKm * Math.SQRT2;
  const start = UNRESOLVED_PIXELS * block.sourceCellM / 1000;
  const d = [...range(start, nearCorner, near), ...range(Math.max(start, nearCorner), farCorner, 0.5)];
  const h = traceHorizon((x, y) => block.height(x, y), block.centerHeightM, d);
  return { ...h, heightM: block.centerHeightM, basis: block.coarse ? 'globe' : 'block', reachKm: block.farHalfKm, pixelM: block.sourceCellM, startKm: start };
}

// Height of the global grid at a point of a site's flat map (x km east, y km north).
function globeHeightAt(globe, b) {
  return (x, y) => {
    const rho = Math.hypot(x, y), chi = rho / MOON_RADIUS_KM, cc = Math.cos(chi), sc = Math.sin(chi) / rho;
    const ux = cc * b.up[0] + sc * (x * b.east[0] + y * b.north[0]), uy = cc * b.up[1] + sc * (x * b.east[1] + y * b.north[1]), uz = cc * b.up[2] + sc * (x * b.east[2] + y * b.north[2]);
    return globe.elevation(Math.asin(Math.max(-1, Math.min(1, uz))) / RAD, Math.atan2(uy, ux) / RAD);
  };
}

/** Horizon from the global grid alone (7.6 km cells): the large shapes only, from two cells out to 300 km. */
export function horizonFromGlobe(globe, latDeg, lonDeg) {
  const b = localBasis(unitFromLatLon(latDeg, lonDeg)), z0 = globe.elevation(latDeg, lonDeg);
  const cellKm = globe.cellDeg * RAD * MOON_RADIUS_KM, start = UNRESOLVED_PIXELS * cellKm;
  const h = traceHorizon(globeHeightAt(globe, b), z0, range(start, 300, cellKm / 2));
  return { ...h, heightM: z0, basis: 'globe', reachKm: 300, pixelM: cellKm * 1000, startKm: start };
}

/** The same in one direction only: elevation angle (deg) of the skyline at an azimuth, for values under the pointer. */
export function skylineFromGlobe(globe, latDeg, lonDeg, azDeg) {
  const b = localBasis(unitFromLatLon(latDeg, lonDeg)), heightAt = globeHeightAt(globe, b), cellKm = globe.cellDeg * RAD * MOON_RADIUS_KM;
  const r0 = MOON_RADIUS_KM + (globe.elevation(latDeg, lonDeg) + RECEIVER_HEIGHT_M) / 1000, sx = Math.sin(azDeg * RAD), sy = Math.cos(azDeg * RAD);
  let best = -Infinity;
  for (let d = UNRESOLVED_PIXELS * cellKm; d < 300; d += cellKm / 2) {
    const rq = MOON_RADIUS_KM + heightAt(d * sx, d * sy) / 1000, g = d / MOON_RADIUS_KM, t = (rq * Math.cos(g) - r0) / (rq * Math.sin(g));
    if (t > best) best = t;
  }
  return Math.atan(best) / RAD;
}

/** A 5 m site profile of Expiry Date (expiry-date/data/horizon_*.json) in the form used here. */
export function horizonFromProfile(json) {
  return {
    angle: Float32Array.from(json.angle_deg), distanceKm: Float32Array.from(json.distance_m, m => m / 1000),
    sigma: json.sigma_deg ? Float32Array.from(json.sigma_deg) : null,
    heightM: json.target.z_m, basis: 'profile', reachKm: 285, pixelM: 5,
  };
}

/** What a horizon rests on, for the line under every number that depends on it. */
export const BASIS_LABEL = {
  profile: 'LOLA 5 m site DEM, far field 80 m',
  block: 'LOLA LDEM64, 64 px/deg (474 m)',
  globe: 'LOLA global grid, 7.6 km cells',
  smooth: 'smooth sphere, no terrain',
};
export const basisOf = horizon => horizon ? horizon.basis : 'smooth';
