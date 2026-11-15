// Where the Sun and the Earth stand, as seen from the Moon. The one sky source of the page.
// No page, no three.js: runs in the browser and in Node (tests/).
//
// Source 1, used wherever it covers the date: NASA JPL Horizons (DE441), hourly sub-solar and sub-Earth
//   point and Earth distance, 2027-01-01 to 2067-01-01 UTC, frame MOON_ME
//   (expiry-date/data/sky_2027_2066.bin, built and checked by expiry-date/tools). Between the hours the
//   values are interpolated linearly.
// Source 2, outside those years or until the file has loaded: the analytic model of lunar-sky.js
//   (Sun within 0.05 deg, Earth within 0.34 deg of Horizons).
// Every result says which of the two it came from (source: 'horizons' | 'analytic').
//
// The Moon's orientation among the stars (needed for the star field and the turning Earth only) always
// comes from lunar-sky.js. Sun and Earth are placed relative to the Moon's own axes, so that orientation
// does not enter where they stand over the lunar surface.
import { bodySky, inertialSky as analyticInertial, MOON_RADIUS_KM } from '../lunar-sky.js';
import { RAD, unitFromLatLon, latLonFromUnit, basisAt, azEl } from './frames.js';

export { DAY_MS, SYNODIC_DAYS, SIDEREAL_DAYS, MOON_RADIUS_KM, EARTH_RADIUS_KM, SUN_RADIUS_KM, AU_KM } from '../lunar-sky.js';

const HOUR_MS = 3600000;

/** The Horizons table. meta: sky_meta.json, buffer: the .bin file (five float32 arrays of length n). */
export class HorizonsSky {
  constructor(meta, buffer) {
    const n = meta.n;
    if (buffer.byteLength !== 20 * n) throw new Error('sky file has ' + buffer.byteLength + ' bytes, expected ' + 20 * n);
    if (meta.step_hours !== 1) throw new Error('sky file: expected hourly steps');
    this.n = n; this.meta = meta;
    this.eLon = new Float32Array(buffer, 0, n);
    this.eLat = new Float32Array(buffer, 4 * n, n);
    this.sLon = new Float32Array(buffer, 8 * n, n);
    this.sLat = new Float32Array(buffer, 12 * n, n);
    this.dist = new Float32Array(buffer, 16 * n, n);
    this.startMs = Date.parse(meta.start_utc);
    this.endMs = this.startMs + (n - 1) * HOUR_MS;
  }
  covers(ms) { return ms >= this.startMs && ms <= this.endMs; }
  /** Fills out.sun (unit vector), out.earth (km, from the Moon's centre) and out.earthDistKm; Moon-fixed frame. */
  at(ms, out) {
    const x = Math.min(Math.max((ms - this.startMs) / HOUR_MS, 0), this.n - 1);
    const i = Math.min(Math.floor(x), this.n - 2), f = x - i, j = i + 1;
    const lerpLon = (a, b) => a + (((b - a + 540) % 360) - 180) * f;      // across the 0/360 seam
    const s = unitFromLatLon(this.sLat[i] + (this.sLat[j] - this.sLat[i]) * f, lerpLon(this.sLon[i], this.sLon[j]));
    const e = unitFromLatLon(this.eLat[i] + (this.eLat[j] - this.eLat[i]) * f, lerpLon(this.eLon[i], this.eLon[j]));
    const d = this.dist[i] + (this.dist[j] - this.dist[i]) * f;
    out.sun = s; out.earth = [e[0] * d, e[1] * d, e[2] * d]; out.earthDistKm = d;
    return out;
  }
}

let horizons = null;
const listeners = new Set();
/** Make a Horizons table the source (null: analytic model only). Listeners are told: every value may have changed. */
export function setHorizons(table) { horizons = table; listeners.forEach(fn => fn()); }
export function onSkyChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
/** Browser: fetch the table from a folder (default: where Expiry Date keeps it) and make it the source. */
export async function loadHorizons(dir = 'expiry-date/data/') {
  const get = async (name, kind) => {
    const r = await fetch(dir + name);
    if (!r.ok) throw new Error(dir + name + ' (HTTP ' + r.status + ')');
    return r[kind]();
  };
  const meta = await get('sky_meta.json', 'json');
  setHorizons(new HorizonsSky(meta, await get(meta.file, 'arrayBuffer')));
  return horizons;
}
/** { startMs, endMs } of the Horizons table, or null. */
export const horizonsRange = () => horizons && { startMs: horizons.startMs, endMs: horizons.endMs };
export const skySource = ms => horizons && horizons.covers(ms) ? 'horizons' : 'analytic';
export const SOURCE_LABEL = { horizons: 'JPL Horizons (DE441)', analytic: 'analytic model' };

/**
 * Sun and Earth for a UTC time in ms, in the Moon-fixed frame (x = lon 0, y = lon 90 E, z = north):
 * out.sun unit vector, out.earth position of the Earth's centre in km, out.earthDistKm, out.source.
 */
export function skyAt(ms, out = {}) {
  if (horizons && horizons.covers(ms)) { horizons.at(ms, out); out.source = 'horizons'; return out; }
  const a = bodySky(ms);
  out.sun = a.sun; out.earth = a.earth; out.earthDistKm = a.earthDistKm; out.source = 'analytic';
  return out;
}

const apply = (M, v) => [M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2], M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2], M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2]];
const tmp = {};
/**
 * The state the system view draws (same fields as inertialSky in lunar-sky.js, axes fixed to the stars),
 * with Sun and Earth taken from skyAt(). Their place relative to the Moon's own axes is then exactly
 * the one of the source, whatever the orientation model says.
 */
export function inertialSky(ms) {
  const a = analyticInertial(ms), s = skyAt(ms, tmp);
  a.source = s.source;
  if (s.source === 'horizons') {
    const e = apply(a.moonToScene, s.earth), d = Math.hypot(e[0], e[1], e[2]);
    a.sun = apply(a.moonToScene, s.sun);
    a.earth = [e[0] / d, e[1] / d, e[2] / d];
    a.earthDistKm = s.earthDistKm;
  }
  return a;
}

/**
 * Sun and Earth as seen from one site, smooth sphere (no terrain): for values that do not depend on the
 * ground. heightM: height of the site above the reference sphere.
 * subSolar, subEarth: [lat, lon] in degrees, lon 0-360 E. Elevations: centre of the disc above the local
 * horizontal. Azimuths: clockwise from north. The Earth is taken from the site (parallax up to 0.26 deg).
 */
export function siteSky(ms, latDeg, lonDeg, heightM = 0) {
  const s = skyAt(ms, tmp), b = basisAt(latDeg, lonDeg), r = MOON_RADIUS_KM + heightM / 1000;
  const toEarth = [s.earth[0] - r * b.up[0], s.earth[1] - r * b.up[1], s.earth[2] - r * b.up[2]];
  const sun = azEl(s.sun, b), earth = azEl(toEarth, b);
  const ss = latLonFromUnit(s.sun), se = latLonFromUnit(s.earth);
  return {
    subSolar: [ss.lat, ss.lon], subEarth: [se.lat, se.lon],
    sunElevDeg: sun.el, sunAzDeg: sun.az, earthElevDeg: earth.el, earthAzDeg: earth.az,
    earthRadiusDeg: Math.asin(6371.0 / Math.hypot(toEarth[0], toEarth[1], toEarth[2])) / RAD,
    source: s.source,
  };
}
