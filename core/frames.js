// Coordinates on the Moon. No page, no three.js: runs in the browser and in Node (tests/).
//
// Frame: MOON_ME (mean Earth / polar axis), the frame of JPL Horizons and of the usual lunar coordinates.
// Latitude -90..90 deg, east longitude 0..360 deg. Vectors are plain arrays [x, y, z] in the Moon-fixed
// frame: x = longitude 0, y = longitude 90 E, z = north.
// The Moon mesh of the page uses three.js axes instead: x = longitude 0, y = north, z = longitude 90 W
// (bodyToThree / threeToBody).
// tools/lunar.py holds the same formulas for the data files; the two must stay in step.

export const MOON_RADIUS_KM = 1737.4;
export const RAD = Math.PI / 180;

export function unitFromLatLon(latDeg, lonDeg) {
  const p = latDeg * RAD, l = lonDeg * RAD, c = Math.cos(p);
  return [c * Math.cos(l), c * Math.sin(l), Math.sin(p)];
}
/** { lat, lon } in degrees, lon 0..360 E. */
export function latLonFromUnit(u) {
  const n = Math.hypot(u[0], u[1], u[2]) || 1;
  const lon = Math.atan2(u[1], u[0]) / RAD;
  return { lat: Math.asin(Math.max(-1, Math.min(1, u[2] / n))) / RAD, lon: ((lon % 360) + 360) % 360 };
}
export const bodyToThree = v => [v[0], v[2], -v[1]];
export const threeToBody = v => [v[0], -v[2], v[1]];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Local axes at a point given by its unit vector: { up, east, north }. At the poles "north" is fixed by convention. */
export function localBasis(up) {
  let east, north;
  if (Math.abs(up[2]) < 0.999999) {
    const h = Math.hypot(up[0], up[1]);
    east = [-up[1] / h, up[0] / h, 0];
    north = [up[1] * east[2] - up[2] * east[1], up[2] * east[0] - up[0] * east[2], up[0] * east[1] - up[1] * east[0]];
    const n = Math.hypot(north[0], north[1], north[2]);
    north = [north[0] / n, north[1] / n, north[2] / n];
  } else if (up[2] < 0) {           // south pole: "north" along longitude 0
    east = [0, 1, 0]; north = [1, 0, 0];
  } else {                          // north pole: "north" along longitude 180
    east = [0, 1, 0]; north = [-1, 0, 0];
  }
  return { up: [up[0], up[1], up[2]], east, north };
}
export const basisAt = (latDeg, lonDeg) => localBasis(unitFromLatLon(latDeg, lonDeg));

/**
 * The flat map of a site (azimuthal equidistant): x km east, y km north, measured along the surface, so
 * distance and azimuth from the site are true. Returns the unit vector of the point.
 */
export function localKmToUnit(basis, xKm, yKm) {
  const rho = Math.hypot(xKm, yKm), chi = rho / MOON_RADIUS_KM;
  const cc = Math.cos(chi), sc = rho > 1e-9 ? Math.sin(chi) / rho : 1 / MOON_RADIUS_KM;
  const { up, east, north } = basis;
  const v = [cc * up[0] + sc * (xKm * east[0] + yKm * north[0]),
             cc * up[1] + sc * (xKm * east[1] + yKm * north[1]),
             cc * up[2] + sc * (xKm * east[2] + yKm * north[2])];
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
}
/** Inverse of localKmToUnit: [x km, y km], or null for points on the far hemisphere of the site. */
export function unitToLocalKm(basis, u) {
  const d = Math.max(-1, Math.min(1, dot(u, basis.up)));
  if (d <= 0) return null;
  const rho = MOON_RADIUS_KM * Math.acos(d), px = dot(u, basis.east), py = dot(u, basis.north), pl = Math.hypot(px, py);
  return pl < 1e-12 ? [0, 0] : [px / pl * rho, py / pl * rho];
}
/** Azimuth (deg, clockwise from north) and elevation (deg) of a direction as seen with the local axes. */
export function azEl(dir, basis) {
  const n = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const az = Math.atan2(dot(dir, basis.east), dot(dir, basis.north)) / RAD;
  return { az: (az + 360) % 360, el: Math.asin(Math.max(-1, Math.min(1, dot(dir, basis.up) / n))) / RAD };
}

// --- The 200 km squares ---------------------------------------------------------------------
// A browsing grid: 6 x n x n squares of 200 x 200 km laid over a cube sphere, each a flat map around its
// centre. They overlap near the cube's edges and leave gaps towards the poles (0.12 % of the surface,
// both poles included), so they are a layer to look at, not the way terrain is addressed: terrain is
// always cut around the point that was asked for (core/terrain.js).
const FACES = [
  [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, -1, 0], [0, 0, 1]],
  [[0, 1, 0], [-1, 0, 0], [0, 0, 1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [0, 1, 0], [-1, 0, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
];
export const SQUARE_KM = 200;
export function squares(n = 20) {
  const out = [];
  for (const [normal, axU, axV] of FACES) for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const u = -1 + 2 * (c + .5) / n, v = -1 + 2 * (r + .5) / n;
    const p = [normal[0] + axU[0] * u + axV[0] * v, normal[1] + axU[1] * u + axV[1] * v, normal[2] + axU[2] * u + axV[2] * v];
    const len = Math.hypot(p[0], p[1], p[2]), center = [p[0] / len, p[1] / len, p[2] / len];
    const idx = out.length, ll = latLonFromUnit(center);
    out.push({ idx, label: '#' + String(idx + 1).padStart(4, '0'), center, basis: localBasis(center), lat: ll.lat, lon: ll.lon });
  }
  return out;
}
/** Index of the square whose 200 km area holds the point (the nearest centre if several do), or -1. */
export function squareAt(list, u, halfKm = SQUARE_KM / 2) {
  let best = -1, bestD = Infinity;
  for (const s of list) {
    if (dot(u, s.center) < .99) continue;
    const xy = unitToLocalKm(s.basis, u);
    if (!xy || Math.abs(xy[0]) > halfKm || Math.abs(xy[1]) > halfKm) continue;
    const d = xy[0] * xy[0] + xy[1] * xy[1];
    if (d < bestD) { bestD = d; best = s.idx; }
  }
  return best;
}

/** "89.4390° S, 222.8441° E" */
export function coordLabel(latDeg, lonDeg, digits = 4) {
  return Math.abs(latDeg).toFixed(digits) + '° ' + (latDeg < 0 ? 'S' : 'N') + ', ' + ((lonDeg % 360 + 360) % 360).toFixed(digits) + '° E';
}
