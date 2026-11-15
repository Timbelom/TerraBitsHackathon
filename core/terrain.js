// Lunar terrain as the page uses it: the global grid and the block around one site.
// No three.js. parseBlock, Block and GlobeGrid also run in Node (tests/); the loaders need fetch.
//
// Heights are metres above the reference sphere of 1737.4 km, coordinates MOON_ME.
// The files are written by tools/build_globe.py, tools/build_terrain.py and tools/serve.py (format: tools/lunar.py).
import { MOON_RADIUS_KM, basisAt, localKmToUnit, latLonFromUnit } from './frames.js';

/** Global grid, 0.25 deg cells (7.6 km at the equator): area means of LOLA LDEM64. */
export class GlobeGrid {
  constructor(meta, buffer) {
    if (buffer.byteLength !== meta.width * meta.height * 2) throw new Error('globe grid: file length does not fit ' + meta.width + ' x ' + meta.height);
    this.meta = meta; this.width = meta.width; this.height = meta.height;
    this.values = new Int16Array(buffer);
    this.step = meta.height_step_m;
    this.cellDeg = meta.cell_deg; this.lat0 = meta.lat_first_center_deg; this.lon0 = meta.lon_first_center_deg;
    this.minM = meta.min_m; this.maxM = meta.max_m;
  }
  /** Bilinear height in metres. */
  elevation(latDeg, lonDeg) {
    const w = this.width, h = this.height, v = this.values;
    const rf = Math.min(Math.max((this.lat0 - latDeg) / this.cellDeg, 0), h - 1);
    const cf = (lonDeg - this.lon0) / this.cellDeg;
    const r0 = Math.min(Math.floor(rf), h - 2), fr = rf - r0, cFloor = Math.floor(cf), fc = cf - cFloor;
    const c0 = ((cFloor % w) + w) % w, c1 = (c0 + 1) % w, a = r0 * w, b = a + w;
    return ((v[a + c0] * (1 - fc) + v[a + c1] * fc) * (1 - fr) + (v[b + c0] * (1 - fc) + v[b + c1] * fc) * fr) * this.step;
  }
  static async load(dir = 'data/globe/', name = 'ldem_me_1440x720') {
    const meta = await fetchOk(dir + name + '.json').then(r => r.json());
    return new GlobeGrid(meta, await fetchOk(dir + meta.file).then(r => r.arrayBuffer()));
  }
}

async function fetchOk(url, init) {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(url + ' (HTTP ' + r.status + ')');
  return r;
}

const HEADER_BYTES = 64, VERSION = 3;

/**
 * The ground around one site, in the site's flat map: x km east, y km north, distances along the surface.
 * near: res x res heights over fullKm (shown: the inner visibleKm; the rim only casts shadows).
 * far: farRes x farRes heights out to farHalfKm, one per farStepKm: what can still stand on the horizon.
 * Row 0 is the northern edge, column 0 the western edge.
 */
export class Block {
  constructor(f) {
    Object.assign(this, f);
    this.fullKm = this.visibleKm + 2 * this.padKm;
    this.halfKm = this.fullKm / 2;
    this.stepKm = this.fullKm / (this.res - 1);
    this.farStepKm = 2 * this.farHalfKm / (this.farRes - 1);
    this.basis = basisAt(this.lat, this.lon);
    this.centerHeightM = this.heightNear(0, 0);
  }
  /** Height (m) inside the near grid; coordinates are clamped to it. */
  heightNear(xKm, yKm) {
    const n = this.res, last = n - 1;
    const cf = Math.min(Math.max((xKm + this.halfKm) / this.stepKm, 0), last), rf = Math.min(Math.max((this.halfKm - yKm) / this.stepKm, 0), last);
    const c0 = Math.min(Math.floor(cf), last - 1), r0 = Math.min(Math.floor(rf), last - 1), fc = cf - c0, fr = rf - r0, a = r0 * n + c0, b = a + n, v = this.near;
    return this.zMin + ((v[a] * (1 - fc) + v[a + 1] * fc) * (1 - fr) + (v[b] * (1 - fc) + v[b + 1] * fc) * fr) * this.zStep;
  }
  /** Height (m) from the far grid, NaN outside it. */
  heightFar(xKm, yKm) {
    const n = this.farRes, last = n - 1, cf = (xKm + this.farHalfKm) / this.farStepKm, rf = (this.farHalfKm - yKm) / this.farStepKm;
    if (!(cf >= 0 && rf >= 0 && cf <= last && rf <= last)) return NaN;
    const c0 = Math.min(Math.floor(cf), last - 1), r0 = Math.min(Math.floor(rf), last - 1), fc = cf - c0, fr = rf - r0, a = r0 * n + c0, b = a + n, v = this.far;
    return this.farMin + ((v[a] * (1 - fc) + v[a + 1] * fc) * (1 - fr) + (v[b] * (1 - fc) + v[b + 1] * fc) * fr) * this.farStep;
  }
  /** Height (m): the near grid where it reaches, the far grid beyond, NaN outside both. */
  height(xKm, yKm) {
    return Math.abs(xKm) <= this.halfKm && Math.abs(yKm) <= this.halfKm ? this.heightNear(xKm, yKm) : this.heightFar(xKm, yKm);
  }
  /** { lat, lon } of a point of the map. */
  latLon(xKm, yKm) { return latLonFromUnit(localKmToUnit(this.basis, xKm, yKm)); }
}

/** A terrain block file (version 3, see tools/lunar.py) as a Block. */
export function parseBlock(buffer) {
  if (buffer.byteLength < HEADER_BYTES) throw new Error('terrain block: file too short');
  const dv = new DataView(buffer);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'LTIL' || dv.getUint16(4, true) !== VERSION) throw new Error('terrain block: unknown format');
  const res = dv.getUint16(6, true), farRes = dv.getUint16(40, true);
  if (buffer.byteLength !== HEADER_BYTES + 2 * (res * res + farRes * farRes)) throw new Error('terrain block: wrong length');
  if (dv.getUint16(42, true) !== 1) throw new Error('terrain block: not in MOON_ME');
  const zMin = dv.getFloat32(32, true), zMax = dv.getFloat32(36, true), farMin = dv.getFloat32(48, true), farMax = dv.getFloat32(52, true);
  return new Block({
    lat: dv.getFloat64(8, true), lon: dv.getFloat64(16, true), res, visibleKm: dv.getFloat32(24, true), padKm: dv.getFloat32(28, true),
    zMin, zStep: (zMax - zMin) / 65535, near: new Uint16Array(buffer, HEADER_BYTES, res * res),
    farRes, farHalfKm: dv.getFloat32(44, true), farMin, farStep: (farMax - farMin) / 65535,
    far: new Uint16Array(buffer, HEADER_BYTES + 2 * res * res, farRes * farRes),
    sourceCellM: dv.getFloat32(56, true), coarse: false,
  });
}

/**
 * A block filled from the global grid, for places where no full-resolution block can be had.
 * Same layout as a real block, but the ground is only as fine as the grid (7.6 km): coarse = true.
 */
export function blockFromGlobe(globe, latDeg, lonDeg, { res = 640, visibleKm = 200, padKm = 25, farRes = 601, farHalfKm = 300 } = {}) {
  const basis = basisAt(latDeg, lonDeg), fullKm = visibleKm + 2 * padKm;
  const fill = (n, half) => {
    const z = new Float32Array(n * n), step = 2 * half / (n - 1);
    let lo = Infinity, hi = -Infinity;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const ll = latLonFromUnit(localKmToUnit(basis, -half + c * step, half - r * step)), h = globe.elevation(ll.lat, ll.lon);
      z[r * n + c] = h; if (h < lo) lo = h; if (h > hi) hi = h;
    }
    if (hi <= lo) hi = lo + 1;
    const u = new Uint16Array(n * n), k = 65535 / (hi - lo);
    for (let i = 0; i < u.length; i++) u[i] = Math.round((z[i] - lo) * k);
    return { u, lo, step: (hi - lo) / 65535 };
  };
  const near = fill(res, fullKm / 2), far = fill(farRes, farHalfKm);
  return new Block({
    lat: latDeg, lon: ((lonDeg % 360) + 360) % 360, res, visibleKm, padKm, zMin: near.lo, zStep: near.step, near: near.u,
    farRes, farHalfKm, farMin: far.lo, farStep: far.step, far: far.u,
    sourceCellM: globe.cellDeg * Math.PI / 180 * MOON_RADIUS_KM * 1000, coarse: true,
  });
}

const key = (lat, lon) => lat.toFixed(5) + ',' + (((lon % 360) + 360) % 360).toFixed(5);

/**
 * Where terrain blocks come from, tried in this order:
 *   'static'  a file in data/terrain/ (the listed sites; works on any static host)
 *   'server'  cut on request by tools/serve.py (any point; needs the local server with the LOLA raster)
 *   null      neither: the page falls back to the global grid and says so
 */
export class TerrainSource {
  constructor({ staticDir = 'data/terrain/', api = 'api/' } = {}) {
    this.staticDir = staticDir; this.api = api;
    this.listed = new Map();          // coordinate key -> index entry
    this.server = null;               // /api/status of the local server, or null
    this.pixelM = null;               // north-south pixel of the source raster
    this.cache = new Map();           // coordinate key -> Promise<Block>, most recently used last
  }
  /** Finds out what is there. Never throws: a missing index or server simply narrows what is offered. */
  async init() {
    const [index, status] = await Promise.all([
      fetchOk(this.staticDir + 'index.json').then(r => r.json()).catch(() => null),
      fetchOk(this.api + 'status').then(r => r.json()).catch(() => null),
    ]);
    if (index) { for (const b of index.blocks) this.listed.set(key(b.lat, b.lon), b); this.pixelM = index.source?.pixel_m_north_south ?? null; }
    if (status && status.terrain) { this.server = status; this.pixelM = status.pixel_m ?? this.pixelM; }
    return this;
  }
  /** 'static' | 'server' | null for a point. */
  availability(latDeg, lonDeg) {
    return this.listed.has(key(latDeg, lonDeg)) ? 'static' : this.server ? 'server' : null;
  }
  /**
   * The block around a point. onProgress(stage, fraction): 'request' while the server reads the raster,
   * 'download' while the bytes arrive. Rejects if there is no source for the point or the transfer fails.
   */
  load(latDeg, lonDeg, onProgress = () => {}) {
    const k = key(latDeg, lonDeg), hit = this.cache.get(k);
    if (hit) { this.cache.delete(k); this.cache.set(k, hit); hit.then(() => onProgress('download', 1), () => {}); return hit; }
    const how = this.availability(latDeg, lonDeg);
    if (!how) return Promise.reject(new Error('no terrain data for this point'));
    const url = how === 'static' ? this.staticDir + this.listed.get(k).file
      : this.api + 'terrain?lat=' + latDeg.toFixed(5) + '&lon=' + (((lonDeg % 360) + 360) % 360).toFixed(5);
    const job = this.#fetchBlock(url, onProgress);
    this.cache.set(k, job);
    job.catch(() => this.cache.delete(k));                    // a failed load may be tried again
    while (this.cache.size > 6) this.cache.delete(this.cache.keys().next().value);
    return job;
  }
  async #fetchBlock(url, onProgress) {
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 60000);
    try {
      onProgress('request', 0);
      const resp = await fetch(url, { signal: ctrl.signal });
      if (!resp.ok) {
        const msg = await resp.json().then(j => j.error, () => null);
        throw new Error(msg || 'terrain request failed (HTTP ' + resp.status + ')');
      }
      // a compressed transfer announces the compressed length: then there is no progress to show
      const total = resp.headers.get('Content-Encoding') ? 0 : +resp.headers.get('Content-Length') || 0;
      if (!resp.body || !total) return parseBlock(await resp.arrayBuffer());
      const bytes = new Uint8Array(total), reader = resp.body.getReader();
      for (let got = 0; ;) {
        const { done, value } = await reader.read();
        if (done) { if (got !== total) throw new Error('terrain block: transfer incomplete'); break; }
        if (got + value.length > total) throw new Error('terrain block: longer than announced');
        bytes.set(value, got); got += value.length; onProgress('download', got / total);
      }
      return parseBlock(bytes.buffer);
    } catch (err) {
      if (err?.name === 'AbortError') throw new Error('the terrain server did not answer within 60 s');
      throw err;
    } finally { clearTimeout(timer); }
  }
}
