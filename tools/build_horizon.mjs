// Horizon map of the whole Moon, for the shadows of the system view (view/moon-globe.js).
//   node tools/build_horizon.mjs
// Reads data/globe/ldem_me_1440x720 (0.25 deg LOLA means) and writes data/globe/horizon_720x360x24.bin + .json:
// for every node of a 0.5 deg grid and 24 azimuths, the elevation angle of the terrain skyline as seen from 2 m
// above the ground there. The page compares the Sun's elevation with it: no shadow map, no dependence on the
// graphics hardware. Geometry as in core/visibility.js: sphere of 1737.4 km, heights above it, exact angle
//   el = atan2((R + hq) cos g - (R + hp), (R + hq) sin g)   for a ground point at arc g.
// Rays run along great circles from 10 km to 350 km (a 10 km summit stands above the horizontal out to 186 km),
// step +12 %. Far steps read a max-pooled copy of the grid whose cells are about as wide as the step, so no
// summit between two samples is missed; that makes far skylines slightly high rather than low.
// This is the 7.6 km grid: it shows the shadows of basins, large craters and ranges, not of small craters.
import { readFileSync, writeFileSync } from 'node:fs';

const dir = new URL('../data/globe/', import.meta.url);
const meta = JSON.parse(readFileSync(new URL('ldem_me_1440x720.json', dir)));
const buf = readFileSync(new URL(meta.file, dir));
const W = meta.width, H = meta.height, base = new Float32Array(W * H);
for (let i = 0; i < W * H; i++) base[i] = buf.readInt16LE(i * 2) * meta.height_step_m;
const CELL = meta.cell_deg, LAT0 = meta.lat_first_center_deg, LON0 = meta.lon_first_center_deg;
const R = 1737400, RAD = Math.PI / 180, CELL_KM = meta.cell_km_at_equator;

// max-pooled levels: level k has cells of 2^k base cells
const levels = [{ w: W, h: H, v: base }];
for (let k = 1; k <= 3; k++) {
  const p = levels[k - 1], w = p.w / 2, h = p.h / 2, v = new Float32Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) v[r * w + c] = Math.max(p.v[2 * r * p.w + 2 * c], p.v[2 * r * p.w + 2 * c + 1], p.v[(2 * r + 1) * p.w + 2 * c], p.v[(2 * r + 1) * p.w + 2 * c + 1]);
  levels.push({ w, h, v });
}
function bilinear(lat, lon) {
  const rf = Math.min(Math.max((LAT0 - lat) / CELL, 0), H - 1), cf = (lon - LON0) / CELL;
  const r0 = Math.min(Math.floor(rf), H - 2), fr = rf - r0, cl = Math.floor(cf), fc = cf - cl, c0 = ((cl % W) + W) % W, c1 = (c0 + 1) % W, a = r0 * W, b = a + W;
  return (base[a + c0] * (1 - fc) + base[a + c1] * fc) * (1 - fr) + (base[b + c0] * (1 - fc) + base[b + c1] * fc) * fr;
}
function pooled(k, lat, lon) {
  const L = levels[k], cell = CELL * (1 << k);
  const r = Math.min(L.h - 1, Math.max(0, Math.floor((90 - lat) / cell))), c = ((Math.floor((lon + 180) / cell) % L.w) + L.w) % L.w;
  return L.v[r * L.w + c];
}

const NX = 720, NY = 360, NA = 24, MIN_DEG = -6, SPAN_DEG = 36, RECEIVER_M = 2;
const steps = [];
for (let d = 10; d <= 350; d *= 1.12) { const g = d * 1000 / R; steps.push({ cg: Math.cos(g), sg: Math.sin(g), level: Math.min(3, Math.max(0, Math.round(Math.log2(d * .12 / CELL_KM)))) }); }
const out = new Uint8Array(NX * NY * NA);
let clipped = 0;
for (let j = 0; j < NY; j++) {                       // row 0 = southernmost
  const lat = -90 + (j + .5) * 180 / NY, sl = Math.sin(lat * RAD), cl = Math.cos(lat * RAD);
  for (let i = 0; i < NX; i++) {
    const lon = -180 + (i + .5) * 360 / NX, so = Math.sin(lon * RAD), co = Math.cos(lon * RAD);
    // body axes: x = lon 0, y = lon 90 E, z = north
    const up = [cl * co, cl * so, sl], east = [-so, co, 0], north = [-sl * co, -sl * so, cl], rp = R + bilinear(lat, lon) + RECEIVER_M;
    for (let a = 0; a < NA; a++) {
      const az = a * 2 * Math.PI / NA, ca = Math.cos(az), sa = Math.sin(az);
      const hx = ca * north[0] + sa * east[0], hy = ca * north[1] + sa * east[1], hz = ca * north[2] + sa * east[2];
      let best = -Infinity;
      for (const s of steps) {
        const qx = s.cg * up[0] + s.sg * hx, qy = s.cg * up[1] + s.sg * hy, qz = s.cg * up[2] + s.sg * hz;
        const qlat = Math.asin(Math.max(-1, Math.min(1, qz))) / RAD, qlon = Math.atan2(qy, qx) / RAD;
        const rq = R + (s.level ? pooled(s.level, qlat, qlon) : bilinear(qlat, qlon)), t = (rq * s.cg - rp) / (rq * s.sg);
        if (t > best) best = t;
      }
      const deg = Math.atan(best) / RAD, q = Math.round((deg - MIN_DEG) / SPAN_DEG * 255);
      if (q < 0 || q > 255) clipped++;
      out[(a * NY + j) * NX + i] = Math.max(0, Math.min(255, q));
    }
  }
}
writeFileSync(new URL('horizon_720x360x24.bin', dir), out);
writeFileSync(new URL('horizon_720x360x24.json', dir), JSON.stringify({
  file: 'horizon_720x360x24.bin',
  description: 'Terrain skyline of the whole Moon: elevation angle of the horizon for every node of a 0.5 deg grid and 24 azimuths, from the 0.25 deg LOLA grid.',
  width: NX, height: NY, azimuths: NA,
  layout: 'azimuth layers (layer k = azimuth k * 15 deg, clockwise from north), in each layer row 0 = southernmost, column 0 = longitude -180 deg; values at cell centres',
  dtype: 'uint8', min_deg: MIN_DEG, span_deg: SPAN_DEG, decode: 'degrees = min_deg + value / 255 * span_deg',
  receiver_height_m: RECEIVER_M, ray_km: [10, 350], frame: meta.frame, source: meta.file, built_with: 'tools/build_horizon.mjs',
}, null, 1) + '\n');
console.log('horizon map written:', NX + ' x ' + NY + ' x ' + NA + ',', (out.length / 1e6).toFixed(1) + ' MB,', clipped, 'values outside ' + MIN_DEG + ' .. ' + (MIN_DEG + SPAN_DEG) + ' deg (clamped)');
