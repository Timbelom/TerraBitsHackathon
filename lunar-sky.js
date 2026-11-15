// Sun, Earth and star-field orientation as seen from the Moon, in a Moon-fixed frame.
// Small analytic model, no data files, valid for any date:
//   - Moon orientation: IAU rotation model (pole RA/Dec, prime meridian W, three periodic terms)
//   - Sun: low-precision solar position (Astronomical Almanac)
//   - Moon: low-precision lunar position (Astronomical Almanac), gives the Earth direction and distance
// Checked against JPL Horizons (DE441) sub-Earth / sub-solar points and Earth distance
// (expiry-date/data/sky_2027_2066.bin, 1662 samples across 2027-2066):
//   Earth direction: mean 0.10 deg, max 0.34 deg | Sun direction: mean 0.02 deg, max 0.05 deg
//   Earth distance: mean 283 km, max 1240 km
// The page takes Sun and Earth from JPL Horizons where that file covers the date (core/sky.js); this model
// is the fallback outside 2027-2066 and gives the Moon's orientation among the stars.
//
// Two frames are offered:
//   lunarSky(ms)     Moon-fixed (rotates with the Moon): x = lunar longitude 90 E, y = lunar north pole,
//                    z = longitude 0 (centre of the near side). This is the frame of the Horizons check.
//   inertialSky(ms)  Moon-centred, axes fixed to the stars: y = ecliptic north pole, z = vernal equinox
//                    (J2000), x completes the right-handed set. Stars stand still; the Moon turns,
//                    the Earth circles the Moon once per sidereal month, the Sun once per year.
// Both are the same model; they differ only by the Moon's own rotation.

export const DAY_MS = 86400000;
export const SYNODIC_DAYS = 29.530589, SIDEREAL_DAYS = 27.321661;
// NASA planetary fact sheet values (km)
export const MOON_RADIUS_KM = 1737.4, EARTH_RADIUS_KM = 6371.0, SUN_RADIUS_KM = 695700, AU_KM = 149597870.7;

const J2000_MS = Date.UTC(2000, 0, 1, 12);
const rad = d => d * Math.PI / 180;
const EPS = rad(23.4393);                 // obliquity J2000
const PRECESSION = 1.3969713;             // degrees per century, ecliptic of date -> J2000

function eclToIcrs(lonDeg, latDeg, r) {
  const l = rad(lonDeg), b = rad(latDeg), x = Math.cos(b) * Math.cos(l), y = Math.cos(b) * Math.sin(l), z = Math.sin(b);
  return [r * x, r * (y * Math.cos(EPS) - z * Math.sin(EPS)), r * (y * Math.sin(EPS) + z * Math.cos(EPS))];
}
const s = d => Math.sin(rad(d)), c = d => Math.cos(rad(d));

/** Geocentric Sun, ICRS, km. */
export function sunIcrs(d) {
  const g = 357.528 + .9856003 * d, L = 280.460 + .9856474 * d;
  const lon = L + 1.915 * s(g) + .020 * s(2 * g) - PRECESSION * d / 36525;
  return eclToIcrs(lon, 0, (1.00014 - .01671 * c(g) - .00014 * c(2 * g)) * AU_KM);
}
/** Geocentric Moon, ICRS, km. */
export function moonIcrs(d) {
  const T = d / 36525;
  const lon = 218.32 + 481267.881 * T + 6.29 * s(135.0 + 477198.87 * T) - 1.27 * s(259.3 - 413335.36 * T) + .66 * s(235.7 + 890534.22 * T)
    + .21 * s(269.9 + 954397.74 * T) - .19 * s(357.5 + 35999.05 * T) - .11 * s(186.5 + 966404.03 * T) - PRECESSION * T;
  const lat = 5.13 * s(93.3 + 483202.02 * T) + .28 * s(228.2 + 960400.89 * T) - .28 * s(318.3 + 6003.15 * T) - .17 * s(217.6 - 407332.21 * T);
  const par = .9508 + .0518 * c(135.0 + 477198.87 * T) + .0095 * c(259.3 - 413335.36 * T) + .0078 * c(235.7 + 890534.22 * T) + .0028 * c(269.9 + 954397.74 * T);
  return eclToIcrs(lon, lat, 6378.14 / s(par));
}
/** 3x3 matrix (rows) taking ICRS coordinates to Moon body-fixed coordinates (x = lon 0, y = lon 90 E, z = north). */
export function moonBodyMatrix(d) {
  const T = d / 36525;
  const E1 = rad(125.045 - .0529921 * d), E2 = rad(250.089 - .1059842 * d), E3 = rad(260.008 + 13.0120009 * d);
  const a0 = rad(269.9949 + .0031 * T - 3.8787 * Math.sin(E1) - .1204 * Math.sin(E2) + .0700 * Math.sin(E3));
  const d0 = rad(66.5392 + .0130 * T + 1.5419 * Math.cos(E1) + .0239 * Math.cos(E2) - .0278 * Math.cos(E3));
  const W = rad(38.3213 + 13.17635815 * d - 1.4e-12 * d * d + 3.5610 * Math.sin(E1) + .1208 * Math.sin(E2) - .0642 * Math.sin(E3));
  const ca = Math.cos(Math.PI / 2 + a0), sa = Math.sin(Math.PI / 2 + a0), cd = Math.cos(Math.PI / 2 - d0), sd = Math.sin(Math.PI / 2 - d0), cw = Math.cos(W), sw = Math.sin(W);
  const A = [[ca, sa, 0], [-sa, ca, 0], [0, 0, 1]], B = [[1, 0, 0], [0, cd, sd], [0, -sd, cd]], C = [[cw, sw, 0], [-sw, cw, 0], [0, 0, 1]];
  const mul = (X, Y) => X.map(r => [0, 1, 2].map(k => r[0] * Y[0][k] + r[1] * Y[1][k] + r[2] * Y[2][k]));
  return mul(C, mul(B, A));
}
const apply = (M, v) => M.map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const unit = v => { const n = Math.hypot(...v); return [v[0] / n, v[1] / n, v[2] / n]; };
const toScene = b => [b[1], b[2], b[0]];

/**
 * State of the sky for a UTC time in milliseconds.
 * sun, earth: unit vectors from the Moon's centre (scene axes); earthDistKm, sunDistKm: distances;
 * icrsToScene: 3x3 rows, rotates ICRS (star catalogue) directions into scene axes; gmstDeg: Earth rotation angle.
 */
export function lunarSky(ms) {
  const d = (ms - J2000_MS) / DAY_MS;
  const M = moonBodyMatrix(d), moon = moonIcrs(d), sun = sunIcrs(d);
  const earthB = apply(M, [-moon[0], -moon[1], -moon[2]]);
  const sunB = apply(M, [sun[0] - moon[0], sun[1] - moon[1], sun[2] - moon[2]]);
  return {
    earth: toScene(unit(earthB)), sun: toScene(unit(sunB)),
    earthDistKm: Math.hypot(...earthB), sunDistKm: Math.hypot(...sunB),
    icrsToScene: [M[1], M[2], M[0]],
    gmstDeg: ((280.46061837 + 360.98564736629 * d) % 360 + 360) % 360,
  };
}

/**
 * The same model in the Moon's body-fixed frame (x = lon 0, y = lon 90 E, z = north), for core/sky.js:
 * sun: unit vector from the Moon's centre; earth: position of the Earth's centre in km; distances in km.
 */
export function bodySky(ms) {
  const d = (ms - J2000_MS) / DAY_MS;
  const M = moonBodyMatrix(d), moon = moonIcrs(d), sun = sunIcrs(d);
  const earth = apply(M, [-moon[0], -moon[1], -moon[2]]);
  const sunB = apply(M, [sun[0] - moon[0], sun[1] - moon[1], sun[2] - moon[2]]);
  return { sun: unit(sunB), earth, earthDistKm: Math.hypot(...earth), sunDistKm: Math.hypot(...sunB) };
}

// ICRS -> inertial scene axes (ecliptic of J2000): x = ecliptic y, y = ecliptic pole, z = ecliptic x.
const Q = [[0, Math.cos(EPS), Math.sin(EPS)], [0, -Math.sin(EPS), Math.cos(EPS)], [1, 0, 0]];
const mul = (X, Y) => X.map(r => [0, 1, 2].map(k => r[0] * Y[0][k] + r[1] * Y[1][k] + r[2] * Y[2][k]));
const transpose = X => [0, 1, 2].map(i => [X[0][i], X[1][i], X[2][i]]);

/**
 * Moon-centred inertial state for a UTC time in milliseconds.
 * earth, sun: unit vectors from the Moon's centre; earthDistKm, sunDistKm: distances;
 * moonToScene: 3x3 rows, Moon body-fixed (x = lon 0, y = lon 90 E, z = north) -> scene;
 * earthToScene: 3x3 rows, Earth-fixed (x = lon 0, y = lon 90 E, z = north) -> scene;
 * icrsToScene: 3x3 rows, constant, for star catalogue directions.
 */
export function inertialSky(ms) {
  const d = (ms - J2000_MS) / DAY_MS;
  const moon = moonIcrs(d), sun = sunIcrs(d);
  const e = [-moon[0], -moon[1], -moon[2]], su = [sun[0] - moon[0], sun[1] - moon[1], sun[2] - moon[2]];
  const g = rad(280.46061837 + 360.98564736629 * d), cg = Math.cos(g), sg = Math.sin(g);
  return {
    earth: unit(apply(Q, e)), sun: unit(apply(Q, su)),
    earthDistKm: Math.hypot(...e), sunDistKm: Math.hypot(...su),
    moonToScene: mul(Q, transpose(moonBodyMatrix(d))),
    earthToScene: mul(Q, [[cg, -sg, 0], [sg, cg, 0], [0, 0, 1]]),
    icrsToScene: Q,
  };
}

/**
 * Sun and Earth as seen from one site on the Moon, for a UTC time in milliseconds.
 * latDeg: planetocentric latitude, lonDeg: east longitude (Moon body-fixed frame of moonBodyMatrix).
 * subSolar, subEarth: [lat, lon] in degrees, lon 0-360 E. sunElevDeg, earthElevDeg: elevation of the
 * disc centre above the horizon of the smooth sphere (radius MOON_RADIUS_KM): no terrain, no refraction.
 * The Earth is taken from the site (parallax up to 0.26 deg); for the Sun the difference is negligible.
 */
export function siteSky(ms, latDeg, lonDeg) {
  const k = lunarSky(ms), la = rad(latDeg), lo = rad(lonDeg), deg = x => x * 180 / Math.PI;
  const p = [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];   // scene axes of lunarSky
  const sub = v => [deg(Math.asin(v[1])), (deg(Math.atan2(v[0], v[2])) + 360) % 360];
  const elev = v => deg(Math.asin(Math.max(-1, Math.min(1, p[0] * v[0] + p[1] * v[1] + p[2] * v[2]))));
  const e = unit(k.earth.map((c, i) => c * k.earthDistKm - p[i] * MOON_RADIUS_KM));
  return { subSolar: sub(k.sun), subEarth: sub(k.earth), sunElevDeg: elev(k.sun), earthElevDeg: elev(e) };
}
