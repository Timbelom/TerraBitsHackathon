// The Moon of the system view as a body with real relief: a mesh over the global LOLA grid
// (core/terrain.js GlobeGrid, 0.25 deg cells), with the layers that can be laid over it.
// The page owns the scene, the light and every text; this module owns the lunar surface.
//
// Local axes are those of the page's Moon node (x = longitude 0, y = north, z = longitude 90 W), so the
// group is added to that node as it is. Radius `radius` stands for 1737.4 km; heights are not exaggerated.
//
// Surface modes
//   relief     grey ground, shaded and shadowed by the scene's Sun
//   imagery    the same with the albedo map of the page (LROC WAC mosaic)
//   elevation  height above the reference sphere in colour (not shaded: the colours are the legend's)
//   sunlight, earth   a value grid in colour (setValues), e.g. the mean illumination of a year
// Layers: latitude/longitude grid every 30 deg, contour lines (elevation mode), the 200 km squares.
import * as THREE from 'three';
import { MOON_RADIUS_KM, RAD, squares as makeSquares, squareAt, unitFromLatLon, localKmToUnit, bodyToThree } from '../core/frames.js';
import { VIRIDIS, colorAt } from './colors.js';
import { reliefShade, shadeMaterial } from './relief.js';

const R_M = MOON_RADIUS_KM * 1000;
const COMPRESS = 1;                          // brightness of the lit Moon: L / (1 + COMPRESS * L)

/**
 * grid: GlobeGrid; radius: scene radius of the reference sphere; albedo: THREE.Texture or null;
 * detail: 1 = every cell of the grid (1440 x 720), 2 = area means of 2 x 2 cells (for weak graphics hardware).
 */
export function createMoonGlobe({ grid, radius, albedo = null, detail = 1 }) {
  const cols = grid.width / detail, rows = grid.height / detail, cell = grid.cellDeg * detail;
  const lat0 = grid.lat0 + grid.cellDeg * (1 - detail) / 2, lon0 = grid.lon0 - grid.cellDeg * (1 - detail) / 2;
  // heights at the mesh's own nodes
  const z = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    let s = 0;
    for (let a = 0; a < detail; a++) for (let b = 0; b < detail; b++) s += grid.values[(r * detail + a) * grid.width + c * detail + b];
    z[r * cols + c] = s / (detail * detail) * grid.step;
  }
  const minM = grid.minM, maxM = grid.maxM, lift = radius * 9e-4;       // lines float 1.6 km above the ground

  // ---- mesh: rows x (cols + 1) nodes (the seam column twice, for the texture) and one node per pole ----
  const mc = cols + 1, n = rows * mc + 2, north = rows * mc, south = north + 1;
  const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), color = new Float32Array(n * 3), nodeLat = new Float32Array(n), nodeLon = new Float32Array(n);
  const put = (i, lat, lon, zM, u) => {
    const p = lat * RAD, l = lon * RAD, rr = radius * (1 + zM / R_M), cp = Math.cos(p);
    pos[i * 3] = rr * cp * Math.cos(l); pos[i * 3 + 1] = rr * Math.sin(p); pos[i * 3 + 2] = -rr * cp * Math.sin(l);
    uv[i * 2] = u; uv[i * 2 + 1] = (lat + 90) / 180; nodeLat[i] = lat; nodeLon[i] = lon;
  };
  let capN = 0, capS = 0;
  for (let c = 0; c < cols; c++) { capN += z[c]; capS += z[(rows - 1) * cols + c]; }
  for (let r = 0; r < rows; r++) for (let c = 0; c < mc; c++) put(r * mc + c, lat0 - r * cell, lon0 + c * cell, z[r * cols + c % cols], (lon0 + c * cell + 180) / 360);
  put(north, 90, 0, capN / cols, .5); put(south, -90, 0, capS / cols, .5);
  const idx = new Uint32Array((rows - 1) * cols * 6 + cols * 6);
  let k = 0;
  for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols; c++) {
    const a = r * mc + c, b = a + mc;
    idx[k++] = a; idx[k++] = b; idx[k++] = a + 1; idx[k++] = b; idx[k++] = b + 1; idx[k++] = a + 1;
  }
  for (let c = 0; c < cols; c++) {
    idx[k++] = north; idx[k++] = c; idx[k++] = c + 1;
    const a = (rows - 1) * mc + c; idx[k++] = south; idx[k++] = a + 1; idx[k++] = a;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
  geometry.setIndex(new THREE.BufferAttribute(idx, 1));
  // relief shading (view/relief.js): one factor per node from the heights; the grid's cells get narrower towards the poles
  { const cellM = cell * RAD * R_M, s = reliefShade({ cols, rows, height: i => z[i], cellX: r => cellM * Math.max(.05, Math.cos((lat0 - r * cell) * RAD)), cellY: cellM,
      wrap: true, slopeRefDeg: 8, reach: 1, curvRefM: 350 }), shade = new Float32Array(n).fill(1);
    for (let r = 0; r < rows; r++) for (let c = 0; c < mc; c++) shade[r * mc + c] = s[r * cols + c % cols];
    geometry.setAttribute('shade', new THREE.BufferAttribute(shade, 1)); }
  geometry.computeVertexNormals();
  { const nm = geometry.attributes.normal.array;                        // one normal for the two copies of the seam column
    for (let r = 0; r < rows; r++) { const a = r * mc * 3, b = (r * mc + cols) * 3;
      const x = nm[a] + nm[b], y = nm[a + 1] + nm[b + 1], w = nm[a + 2] + nm[b + 2], l = Math.hypot(x, y, w) || 1;
      nm[a] = nm[b] = x / l; nm[a + 1] = nm[b + 1] = y / l; nm[a + 2] = nm[b + 2] = w / l; } }
  geometry.computeBoundingSphere();

  const offset = { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 };      // lines lie just above the ground
  // Shadows: where the skyline map (setHorizon) is there, the Sun's light is scaled per fragment by the Sun's
  // elevation against the terrain skyline; the shadow map of the page's light is then not used for the Moon.
  const horizon = { uHorizon: { value: null }, uHorizonOn: { value: 0 }, uSunObj: { value: new THREE.Vector3(1, 0, 0) }, uHorizonMin: { value: -6 }, uHorizonSpan: { value: 36 } };
  const materials = {
    // The lit surfaces carry the relief shading, and their brightness is bent so the ground under a high Sun does
    // not burn out to white and its craters stay readable (COMPRESS, see view/relief.js).
    relief: shadeMaterial(new THREE.MeshStandardMaterial({ color: 0xc2c6cc, roughness: .96, metalness: 0, ...offset }), { compress: COMPRESS, horizon }),
    imagery: shadeMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, map: albedo, ...offset }), { compress: COMPRESS, horizon }),
    data: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, ...offset }),
  };
  const mesh = new THREE.Mesh(geometry, materials.relief);
  mesh.castShadow = mesh.receiveShadow = true;
  const group = new THREE.Group(); group.add(mesh);

  // ---- colours of the data modes ---------------------------------------------------------------
  const layers = new Map();          // name -> { values, width, height, stops }
  let mode = 'relief', painted = '';
  function paint(name) {
    if (painted === name) return; painted = name;
    if (name === 'elevation') {
      const span = Math.max(1, maxM - minM);
      for (let i = 0; i < n; i++) colorAt((height(i) - minM) / span, VIRIDIS, color, i * 3);
    } else {
      const L = layers.get(name), w = L.width, h = L.height, v = L.values;
      for (let i = 0; i < n; i++) {
        const rf = Math.min(Math.max((90 - nodeLat[i]) / 180 * h - .5, 0), h - 1), cf = (nodeLon[i] + 180) / 360 * w - .5;
        const r0 = Math.min(Math.floor(rf), h - 2), fr = rf - r0, cFloor = Math.floor(cf), fc = cf - cFloor, c0 = ((cFloor % w) + w) % w, c1 = (c0 + 1) % w;
        colorAt((v[r0 * w + c0] * (1 - fc) + v[r0 * w + c1] * fc) * (1 - fr) + (v[(r0 + 1) * w + c0] * (1 - fc) + v[(r0 + 1) * w + c1] * fc) * fr, L.stops, color, i * 3);
      }
    }
    geometry.attributes.color.needsUpdate = true;
  }
  const height = i => i >= north ? (i === north ? capN : capS) / cols : z[Math.floor(i / mc) * cols + (i % mc) % cols];
  /** A value grid (0..1, row 0 = north, column 0 = longitude -180, cell centres) and its colour scale, shown by setMode(name). */
  function setValues(name, values, width, heightCells, stops) { layers.set(name, { values, width, height: heightCells, stops }); if (painted === name) { painted = ''; if (mode === name) paint(name); } }
  /** Value of a grid layer at a point (bilinear), or NaN if the layer is not there. */
  function valueAt(name, latDeg, lonDeg) {
    const L = layers.get(name); if (!L) return NaN;
    const w = L.width, h = L.height, v = L.values, rf = Math.min(Math.max((90 - latDeg) / 180 * h - .5, 0), h - 1), cf = (((lonDeg + 180) % 360 + 360) % 360) / 360 * w - .5;
    const r0 = Math.min(Math.floor(rf), h - 2), fr = rf - r0, cFloor = Math.floor(cf), fc = cf - cFloor, c0 = ((cFloor % w) + w) % w, c1 = (c0 + 1) % w;
    return (v[r0 * w + c0] * (1 - fc) + v[r0 * w + c1] * fc) * (1 - fr) + (v[(r0 + 1) * w + c0] * (1 - fc) + v[(r0 + 1) * w + c1] * fc) * fr;
  }
  /** 'relief' | 'imagery' | 'elevation' | the name of a value grid. Returns the mode that is now shown. */
  function setMode(m) {
    if (m === 'imagery' && !materials.imagery.map) m = 'relief';
    if (m !== 'relief' && m !== 'imagery' && m !== 'elevation' && !layers.has(m)) m = 'relief';
    mode = m;
    const lit = m === 'relief' || m === 'imagery';
    if (!lit) paint(m);
    mesh.material = lit ? materials[m] : materials.data;
    mesh.castShadow = mesh.receiveShadow = lit && !horizon.uHorizonOn.value;
    contours.visible = contoursOn && m === 'elevation';
    if (contours.visible) buildContours();
    return m;
  }
  /** The skyline map: bytes (azimuth layers of height x width, row 0 south) and its description file. */
  function setHorizon(bytes, meta) {
    const t = new THREE.Data3DTexture(bytes, meta.width, meta.height, meta.azimuths);
    t.format = THREE.RedFormat; t.type = THREE.UnsignedByteType; t.minFilter = t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapR = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; t.unpackAlignment = 1; t.needsUpdate = true;
    horizon.uHorizon.value = t; horizon.uHorizonMin.value = meta.min_deg; horizon.uHorizonSpan.value = meta.span_deg; horizon.uHorizonOn.value = 1;
    mesh.castShadow = mesh.receiveShadow = false;
  }
  /** Unit vector to the Sun in the Moon's own axes of the mesh (x = lon 0, y = north, z = lon 90 W). */
  function setSun(v) { horizon.uSunObj.value.copy(v); }
  function setAlbedo(tex) { materials.imagery.map = tex; materials.imagery.needsUpdate = true; }

  // ---- lines on the ground ----------------------------------------------------------------------
  const onGround = (latDeg, lonDeg, up, out) => {
    const p = latDeg * RAD, l = lonDeg * RAD, rr = radius * (1 + grid.elevation(latDeg, lonDeg) / R_M) + up, cp = Math.cos(p);
    out.push(rr * cp * Math.cos(l), rr * Math.sin(p), -rr * cp * Math.sin(l));
  };
  const lines = (pts, opacity) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xf4f5f8, transparent: true, opacity, depthWrite: false })); };

  // latitude/longitude grid every 30 deg; equator and prime meridian stronger
  const graticule = new THREE.Group(); graticule.visible = false; group.add(graticule);
  { const thin = [], strong = [];
    for (let lat = -60; lat <= 60; lat += 30) for (let lon = -180; lon < 180; lon += 2) { const t = lat === 0 ? strong : thin; onGround(lat, lon, lift, t); onGround(lat, lon + 2, lift, t); }
    for (let lon = -180; lon < 180; lon += 30) for (let lat = -90; lat < 90; lat += 2) { const t = lon === 0 ? strong : thin; onGround(lat, lon, lift, t); onGround(lat + 2, lon, lift, t); }
    graticule.add(lines(thin, .2), lines(strong, .42)); }

  // the 200 km squares
  const squareList = makeSquares(), squaresGroup = new THREE.Group(); squaresGroup.visible = false; group.add(squaresGroup);
  const outline = (sq, up, out) => {
    const h = 100, e = [[-h, -h, h, -h], [h, -h, h, h], [h, h, -h, h], [-h, h, -h, -h]];
    for (const [x0, y0, x1, y1] of e) for (let i = 0; i < 4; i++) for (const t of [i / 4, (i + 1) / 4]) {
      const u = localKmToUnit(sq.basis, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t), b = bodyToThree(u);
      const lat = Math.asin(Math.max(-1, Math.min(1, u[2]))) / RAD, lon = Math.atan2(u[1], u[0]) / RAD, rr = radius * (1 + grid.elevation(lat, lon) / R_M) + up;
      out.push(b[0] * rr, b[1] * rr, b[2] * rr);
    }
  };
  let squaresBuilt = false;
  const marked = lines(new Array(96).fill(0), .95); marked.visible = false; squaresGroup.add(marked);
  function setSquares(on) {
    if (on && !squaresBuilt) { squaresBuilt = true; const all = []; for (const s of squareList) outline(s, lift, all); squaresGroup.add(lines(all, .26)); }
    squaresGroup.visible = on;
  }
  /** Outlines one square (index of core/frames.js squares(), -1: none). */
  function markSquare(i) {
    marked.visible = i >= 0; if (i < 0) return;
    const pts = []; outline(squareList[i], lift * 2, pts);
    marked.geometry.attributes.position.array.set(pts); marked.geometry.attributes.position.needsUpdate = true;
  }

  // contour lines of the elevation mode
  const contours = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .75, depthWrite: false }));
  contours.visible = false; group.add(contours);
  let contoursOn = true, contourInterval = 1000, contourBuilt = 0;
  function buildContours() {
    if (contourBuilt === contourInterval) return; contourBuilt = contourInterval;
    const iv = contourInterval, first = Math.ceil(minM / iv) * iv, seg = [], col = [], span = Math.max(1, maxM - minM);
    const cut = (a, ha, b, hb, rr) => { const t = Math.abs(hb - ha) < 1e-9 ? .5 : (rr.iso - ha) / (hb - ha), p = a * 3, q = b * 3;
      const x = pos[p] + t * (pos[q] - pos[p]), y = pos[p + 1] + t * (pos[q + 1] - pos[p + 1]), w = pos[p + 2] + t * (pos[q + 2] - pos[p + 2]), s = rr.r / Math.hypot(x, y, w);
      seg.push(x * s, y * s, w * s); };
    const tri = (i0, h0, i1, h1, i2, h2, rr) => {
      const n0 = seg.length, iso = rr.iso;
      if ((h0 < iso) !== (h1 < iso)) cut(i0, h0, i1, h1, rr);
      if ((h1 < iso) !== (h2 < iso)) cut(i1, h1, i2, h2, rr);
      if (seg.length - n0 < 6 && (h2 < iso) !== (h0 < iso)) cut(i2, h2, i0, h0, rr);
      if (seg.length - n0 === 6) col.push(rr.c, rr.c, rr.c, rr.c, rr.c, rr.c); else seg.length = n0;
    };
    const rr = { iso: 0, r: 0, c: 0 };
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols; c++) {
      const a = r * mc + c, b = a + 1, d = a + mc, e = d + 1, ha = height(a), hb = height(b), hd = height(d), he = height(e);
      const lo = Math.min(ha, hb, hd, he), hi = Math.max(ha, hb, hd, he);
      for (let j = Math.max(0, Math.ceil((lo - first) / iv)), iso = first + j * iv; iso <= hi; j++, iso = first + j * iv) {
        const major = Math.round(iso / iv) % 4 === 0, dark = (iso - minM) / span >= .25;       // dark lines on the bright part of the scale
        rr.iso = iso; rr.r = radius * (1 + iso / R_M) + lift * .5; rr.c = dark ? (major ? .03 : .1) : (major ? 1 : .82);
        tri(a, ha, d, hd, b, hb, rr); tri(d, hd, e, he, b, hb, rr);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    contours.geometry.dispose(); contours.geometry = g;
  }
  function setContours(on, interval = contourInterval) {
    contoursOn = on; contourInterval = interval;
    contours.visible = on && mode === 'elevation';
    if (contours.visible) buildContours();
  }

  // ---- the point under a ray --------------------------------------------------------------------
  const maxR = radius * (1 + maxM / R_M), stepW = cell * RAD * radius * .5, p = new THREE.Vector3();
  const under = () => { const r = p.length(), lat = Math.asin(Math.max(-1, Math.min(1, p.y / r))) / RAD, lon = Math.atan2(-p.z, p.x) / RAD;
    return r <= radius * (1 + grid.elevation(lat, lon) / R_M); };
  /**
   * Where a ray meets the relief. origin, dir (unit): THREE.Vector3 in the group's local axes.
   * Returns { lat, lon (0..360 E), elevM, point: Vector3 (local) } or null.
   */
  function raycast(origin, dir) {
    const b = origin.dot(dir), c = origin.lengthSq() - maxR * maxR, disc = b * b - c;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc), t0 = Math.max(0, -b - sq), t1 = -b + sq;
    for (let t = t0, prev = t0; t <= t1; prev = t, t += stepW) {
      p.copy(origin).addScaledVector(dir, t);
      if (!under()) continue;
      let lo = prev, hi = t;
      for (let j = 0; j < 8; j++) { const m = (lo + hi) / 2; p.copy(origin).addScaledVector(dir, m); if (under()) hi = m; else lo = m; }
      p.copy(origin).addScaledVector(dir, (lo + hi) / 2);
      const r = p.length(), lat = Math.asin(Math.max(-1, Math.min(1, p.y / r))) / RAD, lon = ((Math.atan2(-p.z, p.x) / RAD) % 360 + 360) % 360;
      return { lat, lon, elevM: grid.elevation(lat, lon), point: p.clone() };
    }
    return null;
  }

  function dispose() {
    geometry.dispose(); Object.values(materials).forEach(m => m.dispose());
    group.traverse(o => { if (o !== mesh && o.geometry) { o.geometry.dispose(); o.material.dispose(); } });
  }
  return {
    group, mesh, detail, triangles: idx.length / 3, range: { minM, maxM },
    setMode, get mode() { return mode; }, setAlbedo, setHorizon, setSun, get hasHorizon() { return horizon.uHorizonOn.value > 0; }, setValues, valueAt, hasLayer: name => layers.has(name),
    setGraticule: on => { graticule.visible = on; }, setSquares, markSquare, setContours,
    squareAt: (latDeg, lonDeg) => squareAt(squareList, unitFromLatLon(latDeg, lonDeg)), squares: squareList,
    raycast, dispose,
  };
}
