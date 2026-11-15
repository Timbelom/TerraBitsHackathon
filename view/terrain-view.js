// The terrain view: the ground around one site in true proportions, lit by the Sun as it stands there.
// A second scene for the page's renderer (the system view is the first). The page owns the clock, the
// Sun and Earth objects and every text; this module owns the ground.
//
// World axes (km): x east, y up, z south; the origin is the site's ground point. Heights are not
// exaggerated. The ground is the terrain block of core/terrain.js:
//   near grid  640 x 640 heights over 250 km; the inner 200 km are drawn, the rim only casts shadows
//   far grid   to 300 km, never drawn: it casts shadows into the square, because with a low Sun
//              (near the poles always) mountains far outside still cover it
// The ground is always drawn and shadowed at the full resolution of its block; there is no lighter variant.
// What keeps the shadows affordable is in the shadow pass instead (see "light" below): they are redone only
// when the Sun has moved, the far grid is cut into pieces so only those between the square and the Sun are
// drawn into the shadow map, and it is left out of every frame in which no shadows are redone.
// Every point is placed in 3D on the sphere, so the Moon's curvature is in the picture: the ground
// 100 km from the site lies 2.9 km below the site's horizontal.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MOON_RADIUS_KM, RAD } from '../core/frames.js';
import { discFraction, SUN_RADIUS_DEG, RECEIVER_HEIGHT_M } from '../core/visibility.js';
import { VIRIDIS, colorAt } from './colors.js';
import { reliefShade, shadeMaterial } from './relief.js';

const SOLAR_CONSTANT = 1361;                 // W/m2 at 1 au
// Sun and Earth stand on a sky dome around the site, close enough to be in the picture together with the ground
// (the square is 200 km wide). Their directions are true; their distance and size are not: both are drawn
// BODY_EXAG times larger than in the system view, the Earth still about 3.7 times as wide as the Sun.
const SKY_KM = 170, BODY_EXAG = 1.5;
const PATH_COLORS = { sun: 0xd9b377, earth: 0x7fb0e0 };   // as the paths of the system view
// The far grid ends 300 km out. Seen from the site the sphere's surface there lies 4.9 deg below the
// horizontal; a Sun lower than that would shine in under the edge of the data. The light is faded out
// just above that limit. Above it nothing is dimmed: there is no atmosphere, a rising Sun has full strength.
const LIGHT_OFF_DEG = -4.6, LIGHT_FULL_DEG = -4.2;

function label(text, { px = 44, color = '#b3b7bd', weight = 500 } = {}) {
  const c = document.createElement('canvas'), g = c.getContext('2d'), font = weight + ' ' + px + 'px Inter, "Helvetica Neue", Arial, sans-serif';
  g.font = font; c.width = Math.ceil(g.measureText(text).width) + 16; c.height = Math.ceil(px * 1.4);
  g.font = font; g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(text, 8, c.height / 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false }));
  s.userData.aspect = c.width / c.height; s.renderOrder = 5;
  return s;
}

/** renderer: the page's WebGLRenderer; input: the element that receives the pointer for orbiting. */
export function createTerrainView({ renderer, input }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 9000);
  const controls = new OrbitControls(camera, input);
  controls.enableDamping = true; controls.dampingFactor = .07; controls.enabled = false;
  controls.minDistance = 6; controls.maxDistance = 900; controls.maxPolarAngle = Math.PI * .497; controls.zoomSpeed = .8;

  // faint cool fill, as in the system view, so ground in shadow keeps its shape
  scene.add(new THREE.AmbientLight(0x8fa6c8, .05), new THREE.AmbientLight(0xbfd2ee, .2));
  // Earthshine: with the Sun down the ground is lit by the Earth, from the Earth's direction, stronger the more
  // of its disc is lit. Drawn far stronger than true (true: about 1/10000 of sunlight), like the fill, so
  // the ground keeps its shape at night. It throws no shadows.
  const earthLight = new THREE.DirectionalLight(0xa9c4ea, 0);
  scene.add(earthLight, earthLight.target);
  const sunLight = new THREE.DirectionalLight(0xfff6e8, 4.4);
  sunLight.castShadow = true; sunLight.shadow.mapSize.set(4096, 4096); sunLight.shadow.normalBias = .08;
  scene.add(sunLight, sunLight.target);

  let block = null, RES = 0, FAR = 0, half = 0, visHalf = 100;
  let positions, farPositions, heightColors, shade, geometry, mesh;
  const FAR_PIECES = 10, farGroup = new THREE.Group(), farMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  farGroup.visible = false;
  let minY = -2, maxY = 2, farMinY = -30, farMaxY = 5, minM = 0, maxM = 1, r0 = MOON_RADIUS_KM;
  const clip = [new THREE.Plane(new THREE.Vector3(1, 0, 0), 100), new THREE.Plane(new THREE.Vector3(-1, 0, 0), 100),
                new THREE.Plane(new THREE.Vector3(0, 0, 1), 100), new THREE.Plane(new THREE.Vector3(0, 0, -1), 100)];
  const reliefMat = shadeMaterial(new THREE.MeshStandardMaterial({ color: 0xc2c6cc, roughness: .95, metalness: 0, clippingPlanes: clip, clipShadows: false }));   // relief shading: view/relief.js
  const dataMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, clippingPlanes: clip, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const group = new THREE.Group(); scene.add(group);
  const contours = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .8, clippingPlanes: clip }));
  contours.visible = false; group.add(contours);

  // Scale: the 200 km square on a base plane below the ground, a tick every 50 km, east and north named.
  const scale = new THREE.Group(); group.add(scale);
  const ticks = [];
  function buildScale(baseY) {
    scale.clear(); ticks.length = 0;
    const h = visHalf, pts = [-h, baseY, -h, h, baseY, -h, h, baseY, -h, h, baseY, h, h, baseY, h, -h, baseY, h, -h, baseY, h, -h, baseY, -h];
    for (let v = -h + 50; v < h; v += 50) pts.push(v, baseY, -h, v, baseY, h, -h, baseY, v, h, baseY, v);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    scale.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xb3b7bd, transparent: true, opacity: .34 })));
    for (let v = -h; v <= h; v += 50) {
      const t = (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v) + ' km';
      const a = label(t), b = label(t); scale.add(a, b); ticks.push({ sp: a, v, axis: 'x' }, { sp: b, v, axis: 'z' });
    }
    const e = label('East', { color: '#f4f5f8', weight: 600 }), n = label('North', { color: '#f4f5f8', weight: 600 });
    scale.add(e, n); ticks.push({ sp: e, v: 75, axis: 'x', title: true }, { sp: n, v: -75, axis: 'z', title: true });
    // order in which labels claim their place: axis names first, then the ticks from the middle outwards
    ticks.sort((p, q) => (q.title ? 1 : 0) - (p.title ? 1 : 0) || Math.abs(p.v) - Math.abs(q.v));
    scale.userData.baseY = baseY;
  }
  /**
   * Labels stand on the two edges nearest to the camera and keep one size on screen. The axis names stand in a
   * second row further out. A label that would run into one already placed is left out (at the corners, and
   * when an edge is seen end-on): its value follows from the ticks beside it, the grid is every 50 km.
   */
  const placed = [], ndcP = new THREE.Vector3();
  let viewW = 1, viewH = 1;
  function placeScale() {
    const baseY = scale.userData.baseY, sx = camera.position.x >= 0 ? 1 : -1, sz = camera.position.z >= 0 ? 1 : -1;
    const pxPerUnit = viewH / (2 * Math.tan(camera.fov * RAD / 2));
    placed.length = 0;
    for (const t of ticks) {
      const p = t.sp.position, off = visHalf + (t.title ? 26 : 9);
      if (t.axis === 'x') p.set(t.v, baseY, sz * off); else p.set(sx * off, baseY, t.v);
      const k = camera.position.distanceTo(p) * (t.title ? .024 : .02);
      t.sp.scale.set(k * t.sp.userData.aspect, k, 1);
      ndcP.copy(p).project(camera);
      const depth = ndcP.z < 1 ? camera.position.distanceTo(p) : 0;
      let ok = depth > 0;
      if (ok) {
        const hh = k / depth * pxPerUnit * .5, hw = hh * t.sp.userData.aspect, cx = (ndcP.x * .5 + .5) * viewW, cy = (.5 - ndcP.y * .5) * viewH;
        const r = [cx - hw, cy - hh * .8, cx + hw, cy + hh * .8];
        ok = !placed.some(q => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]);
        if (ok) placed.push(r);
      }
      t.sp.visible = ok;
    }
  }

  // The site: a thin mast with a ring at its foot, in the page's near-white
  const pin = new THREE.Group();
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(.12, .12, 1, 8), new THREE.MeshBasicMaterial({ color: 0xeceef1 })); mast.geometry.translate(0, .5, 0);
  const foot = new THREE.Mesh(new THREE.RingGeometry(.7, 1, 32), new THREE.MeshBasicMaterial({ color: 0xeceef1, side: THREE.DoubleSide })); foot.rotation.x = -Math.PI / 2;
  pin.add(mast, foot); group.add(pin);
  // The point under the pointer
  const cursor = new THREE.Mesh(new THREE.RingGeometry(.55, .8, 32), new THREE.MeshBasicMaterial({ color: 0xeceef1, side: THREE.DoubleSide, depthTest: false, transparent: true }));
  cursor.visible = false; cursor.renderOrder = 4; group.add(cursor);

  // Sun and Earth: the page's own objects, drawn at their direction from the site; a line from the site points to each
  // They and their paths are a scene of their own, drawn after the ground with the same camera and depth buffer:
  // the ground still hides them, but their light is theirs alone. The Earth is lit by the Sun at full strength
  // whether or not the Sun is up at the site, so it shows its true phase and does not go dark with the ground.
  const skyScene = new THREE.Scene(), sky = new THREE.Group(); skyScene.add(sky);
  const skySun = new THREE.DirectionalLight(0xfff6e8, 4.4);
  skyScene.add(skySun, skySun.target, new THREE.AmbientLight(0xbfd2ee, .25));
  const pathLine = color => { const l = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color, transparent: true, opacity: .6 })); l.frustumCulled = false; l.visible = false; skyScene.add(l); return l; };
  const sunPath = pathLine(PATH_COLORS.sun), earthPath = pathLine(PATH_COLORS.earth);
  let pathsOn = true;
  const ray = color => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const l = new THREE.Line(g, new THREE.LineDashedMaterial({ color, dashSize: 3, gapSize: 3, transparent: true, opacity: .5 })); l.frustumCulled = false; group.add(l); return l; };
  const sunRay = ray(0xfff0c8), earthRay = ray(0x9cc4ee);
  let sunObj = null, earthObj = null, sunScale = 1, earthScale = 1;

  // ---- geometry of a block -----------------------------------------------------------------
  function worldOf(xKm, yKm, zM, out, o) {            // map coordinates + height -> world position
    const rho = Math.hypot(xKm, yKm), chi = rho / MOON_RADIUS_KM, r = MOON_RADIUS_KM + zM / 1000, k = rho > 1e-9 ? r * Math.sin(chi) / rho : r / MOON_RADIUS_KM;
    out[o] = k * xKm; out[o + 1] = r * Math.cos(chi) - r0; out[o + 2] = -k * yKm;
  }
  function ensureBuffers(b) {
    if (RES === b.res && FAR === b.farRes) return;
    RES = b.res; FAR = b.farRes;
    positions = new Float32Array(RES * RES * 3); heightColors = new Float32Array(RES * RES * 3); shade = new Float32Array(RES * RES).fill(1); farPositions = new Float32Array(FAR * FAR * 3);
    const idx = new Uint32Array((RES - 1) * (RES - 1) * 6);
    for (let r = 0, p = 0; r < RES - 1; r++) for (let c = 0; c < RES - 1; c++) {
      const a = r * RES + c, d = a + 1, e = a + RES, f = e + 1;
      idx[p++] = a; idx[p++] = e; idx[p++] = d; idx[p++] = e; idx[p++] = f; idx[p++] = d;
    }
    geometry?.dispose(); farGroup.children.forEach(m => m.geometry.dispose()); farGroup.clear();
    geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(heightColors, 3));
    geometry.setAttribute('shade', new THREE.BufferAttribute(shade, 1));
    geometry.setIndex(new THREE.BufferAttribute(idx, 1));
    // Far grid: only the cells outside the near grid (those inside are covered by the fine mesh), in FAR_PIECES x
    // FAR_PIECES pieces that share one position buffer. Each piece has its own bounding sphere (set in load), so the
    // shadow pass draws only the pieces inside the shadow camera's box: the strip between the square and the Sun.
    const farStep = 2 * b.farHalfKm / (FAR - 1), farAttr = new THREE.BufferAttribute(farPositions, 3), per = Math.ceil((FAR - 1) / FAR_PIECES);
    for (let pr = 0; pr < FAR_PIECES; pr++) for (let pc = 0; pc < FAR_PIECES; pc++) {
      const fidx = [], r1 = Math.min(FAR - 1, (pr + 1) * per), c1 = Math.min(FAR - 1, (pc + 1) * per);
      for (let r = pr * per; r < r1; r++) for (let c = pc * per; c < c1; c++) {
        const x0 = -b.farHalfKm + c * farStep, y0 = b.farHalfKm - r * farStep;
        if (Math.abs(x0) <= b.halfKm && Math.abs(x0 + farStep) <= b.halfKm && Math.abs(y0) <= b.halfKm && Math.abs(y0 - farStep) <= b.halfKm) continue;
        const a = r * FAR + c, d = a + 1, e = a + FAR, f = e + 1;
        fidx.push(a, e, d, e, f, d);
      }
      if (!fidx.length) continue;
      const g = new THREE.BufferGeometry(); g.setAttribute('position', farAttr); g.setIndex(new THREE.BufferAttribute(new Uint32Array(fidx), 1));
      const piece = new THREE.Mesh(g, farMat); piece.castShadow = true; piece.userData.range = [pr * per, r1, pc * per, c1];
      farGroup.add(piece);
    }
    if (mesh) group.remove(mesh);
    mesh = new THREE.Mesh(geometry, reliefMat); mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh, farGroup);
  }
  const pause = () => new Promise(done => { const t = setTimeout(done, 60); requestAnimationFrame(() => { clearTimeout(t); done(); }); });

  /** Builds the scene for a block. onProgress(fraction, text). The camera is set to its opening place. */
  async function load(b, onProgress = () => {}) {
    onProgress(0, 'Building the ground');
    await pause();
    block = b; half = b.halfKm; visHalf = b.visibleKm / 2;
    clip.forEach(p => { p.constant = visHalf; });
    ensureBuffers(b);
    r0 = MOON_RADIUS_KM + b.centerHeightM / 1000;
    minY = Infinity; maxY = -Infinity; minM = Infinity; maxM = -Infinity;
    for (let r = 0, i = 0; r < RES; r++) {
      const y = half - r * b.stepKm;
      for (let c = 0; c < RES; c++, i++) {
        const x = -half + c * b.stepKm, z = b.zMin + b.near[i] * b.zStep;
        worldOf(x, y, z, positions, i * 3);
        if (Math.abs(x) <= visHalf && Math.abs(y) <= visHalf) {
          const wy = positions[i * 3 + 1];
          if (wy < minY) minY = wy; if (wy > maxY) maxY = wy; if (z < minM) minM = z; if (z > maxM) maxM = z;
        }
      }
    }
    onProgress(.35, 'Surroundings to ' + Math.round(b.farHalfKm) + ' km'); await pause();
    farMinY = Infinity; farMaxY = -Infinity;
    for (let r = 0, i = 0; r < FAR; r++) {
      const y = b.farHalfKm - r * b.farStepKm;
      for (let c = 0; c < FAR; c++, i++) {
        worldOf(-b.farHalfKm + c * b.farStepKm, y, b.farMin + b.far[i] * b.farStep, farPositions, i * 3);
        const wy = farPositions[i * 3 + 1]; if (wy < farMinY) farMinY = wy; if (wy > farMaxY) farMaxY = wy;
      }
    }
    onProgress(.55, 'Shading'); await pause();
    const span = Math.max(1, maxM - minM);
    for (let i = 0; i < RES * RES; i++) colorAt((b.zMin + b.near[i] * b.zStep - minM) / span, VIRIDIS, heightColors, i * 3);
    geometry.attributes.position.needsUpdate = true; geometry.attributes.color.needsUpdate = true;
    farGroup.children[0].geometry.attributes.position.needsUpdate = true;
    for (const piece of farGroup.children) {                      // bounding sphere of each piece, from its corner and edge nodes
      const [ra, rb, ca, cb] = piece.userData.range, box = new THREE.Box3(), p = new THREE.Vector3();
      for (let r = ra; r <= rb; r++) for (let c = ca; c <= cb; c++) { const i = (r * FAR + c) * 3; box.expandByPoint(p.set(farPositions[i], farPositions[i + 1], farPositions[i + 2])); }
      piece.geometry.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    }
    // relief shading from the block's heights (474 m nodes): slopes of crater walls, rims and floors
    shade.set(reliefShade({ cols: RES, rows: RES, height: i => b.zMin + b.near[i] * b.zStep, cellX: () => b.stepKm * 1000, cellY: b.stepKm * 1000, slopeRefDeg: 15, reach: 3, curvRefM: 120 }));
    geometry.attributes.shade.needsUpdate = true;
    geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    onProgress(.85, 'Scale and contours'); await pause();
    buildScale(Math.floor(minY - 4));
    const top = heightAt(0, 0);
    pin.position.set(0, top, 0); mast.scale.set(1, 9, 1);
    if (contours.visible) buildContours();
    else contourKey = '';
    camera.position.set(250, top + 170, 325);          // the whole square with the sky dome above it
    controls.target.set(0, top, 0); controls.update();
    lastSun.set(0, 0, 0);
    onProgress(1, 'Ready');
  }

  // World height (km) of the ground at world x, z. Inside the near grid from the mesh, beyond from the far grid, NaN outside both.
  function heightAt(wx, wz) {
    if (Math.abs(wx) <= half * .985 && Math.abs(wz) <= half * .985) {     // world x/z are slightly shorter than map km (curvature)
      const k = mapScale(wx, wz), last = RES - 1;
      const cf = Math.min(Math.max((wx * k + half) / block.stepKm, 0), last), rf = Math.min(Math.max((wz * k + half) / block.stepKm, 0), last);
      const c0 = Math.min(Math.floor(cf), last - 1), q0 = Math.min(Math.floor(rf), last - 1), fc = cf - c0, fr = rf - q0, a = (q0 * RES + c0) * 3 + 1, b = a + RES * 3;
      return (positions[a] * (1 - fc) + positions[a + 3] * fc) * (1 - fr) + (positions[b] * (1 - fc) + positions[b + 3] * fc) * fr;
    }
    const k = mapScale(wx, wz), last = FAR - 1, cf = (wx * k + block.farHalfKm) / block.farStepKm, rf = (wz * k + block.farHalfKm) / block.farStepKm;
    if (!(cf >= 0 && rf >= 0 && cf <= last && rf <= last)) return NaN;
    const c0 = Math.min(Math.floor(cf), last - 1), q0 = Math.min(Math.floor(rf), last - 1), fc = cf - c0, fr = rf - q0, a = (q0 * FAR + c0) * 3 + 1, b = a + FAR * 3;
    return (farPositions[a] * (1 - fc) + farPositions[a + 3] * fc) * (1 - fr) + (farPositions[b] * (1 - fc) + farPositions[b + 3] * fc) * fr;
  }
  // The grids are laid out by distance along the surface; world x/z are the horizontal part of the 3D position.
  // Factor from one to the other for a point at the reference radius (heights change it by less than 1 %).
  function mapScale(wx, wz) {
    const d = Math.hypot(wx, wz);
    return d > 1e-6 ? MOON_RADIUS_KM * Math.asin(Math.min(1, d / r0)) / d : 1;
  }

  // ---- contours -------------------------------------------------------------------------------
  let contourInterval = 250, contourKey = '';
  function buildContours() {
    const key = contourInterval + '|' + block.lat + '|' + block.lon;
    if (key === contourKey) return; contourKey = key;
    const iv = contourInterval, first = Math.ceil(minM / iv) * iv, seg = [], col = [], lift = .12, span = Math.max(1, maxM - minM);
    const H = i => block.zMin + block.near[i] * block.zStep;
    const cut = (a, ha, b, hb, iso) => { const t = Math.abs(hb - ha) < 1e-9 ? .5 : (iso - ha) / (hb - ha), p = a * 3, q = b * 3;
      seg.push(positions[p] + t * (positions[q] - positions[p]), positions[p + 1] + t * (positions[q + 1] - positions[p + 1]) + lift, positions[p + 2] + t * (positions[q + 2] - positions[p + 2])); };
    const tri = (i0, h0, i1, h1, i2, h2, iso, c) => {
      const n0 = seg.length;
      if ((h0 < iso) !== (h1 < iso)) cut(i0, h0, i1, h1, iso);
      if ((h1 < iso) !== (h2 < iso)) cut(i1, h1, i2, h2, iso);
      if (seg.length - n0 < 6 && (h2 < iso) !== (h0 < iso)) cut(i2, h2, i0, h0, iso);
      if (seg.length - n0 === 6) col.push(c, c, c, c, c, c); else seg.length = n0;
    };
    const lo = Math.round((half - visHalf) / block.stepKm) - 1, hi = RES - 1 - lo;         // only what is drawn
    for (let r = Math.max(0, lo); r < Math.min(RES - 1, hi); r++) for (let c = Math.max(0, lo); c < Math.min(RES - 1, hi); c++) {
      const a = r * RES + c, b = a + 1, d = a + RES, e = d + 1, ha = H(a), hb = H(b), hd = H(d), he = H(e);
      const qmin = Math.min(ha, hb, hd, he), qmax = Math.max(ha, hb, hd, he);
      for (let k = Math.max(0, Math.ceil((qmin - first) / iv)), iso = first + k * iv; iso <= qmax; k++, iso = first + k * iv) {
        const major = Math.abs(Math.round(iso / iv) % 5) === 0, dark = (iso - minM) / span >= .25;      // dark lines on the bright part of the scale
        const shade = dark ? (major ? .03 : .1) : (major ? 1 : .82);
        tri(a, ha, d, hd, b, hb, iso, shade); tri(d, hd, e, he, b, hb, iso, shade);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    contours.geometry.dispose(); contours.geometry = g;
  }

  // ---- light ------------------------------------------------------------------------------------
  const lastSun = new THREE.Vector3(), sunDir = new THREE.Vector3(0, 1, 0), earthDir = new THREE.Vector3(0, 1, 0), corner = new THREE.Vector3();
  let shadowDirty = true, mode = 'relief';
  // Shadow camera: sideways it only has to cover the drawn square (keeps the shadow map sharp); in depth it
  // starts at the nearest caster towards the Sun, the far grid included, and ends behind the square. Pieces of
  // the far grid outside this box are not drawn into the shadow map.
  function fitShadow() {
    const cam = sunLight.shadow.camera;
    sunLight.updateMatrixWorld(); sunLight.target.updateMatrixWorld();
    cam.position.copy(sunLight.position); cam.up.set(0, 1, 0); cam.lookAt(sunLight.target.position); cam.updateMatrixWorld();
    const view = cam.matrixWorldInverse;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < 16; i++) {
      const caster = i >= 8, h = caster ? block.farHalfKm : visHalf;
      const lo = (caster ? Math.min(minY, farMinY) : minY) - .5, hi = (caster ? Math.max(maxY, farMaxY) : maxY) + .5;
      corner.set(i & 1 ? h : -h, i & 2 ? hi : lo, i & 4 ? h : -h).applyMatrix4(view);
      if (!caster) { x0 = Math.min(x0, corner.x); x1 = Math.max(x1, corner.x); y0 = Math.min(y0, corner.y); y1 = Math.max(y1, corner.y); }
      if (!caster) z0 = Math.min(z0, corner.z);                   // far plane: the far side of the square (nothing behind it casts into it)
      z1 = Math.max(z1, corner.z);                                // near plane: the nearest caster, far grid included
    }
    const px = (x1 - x0) * .03 + 2, py = (y1 - y0) * .03 + 2;
    cam.left = x0 - px; cam.right = x1 + px; cam.bottom = y0 - py; cam.top = y1 + py;
    cam.near = Math.max(1, -z1 - 5); cam.far = Math.max(cam.near + 10, -z0 + 5);
    cam.updateProjectionMatrix();
    sunLight.shadow.bias = -.08 / (cam.far - cam.near);          // a constant 80 m, whatever the depth range
  }
  /**
   * Where Sun and Earth stand, as unit vectors in the site's local axes [east, north, up].
   * Light and shadows follow the Sun; they are redone when it has moved by more than 0.05 deg.
   */
  function setSky(sunENU, earthENU) {
    sunDir.set(sunENU[0], sunENU[2], -sunENU[1]);
    const top = pin.position.y + RECEIVER_HEIGHT_M / 1000;
    if (sunObj) { sunObj.position.copy(sunDir).multiplyScalar(SKY_KM); sunObj.position.y += top; }
    earthDir.set(earthENU[0], earthENU[2], -earthENU[1]);
    if (earthObj) { earthObj.position.copy(earthDir).multiplyScalar(SKY_KM); earthObj.position.y += top; }
    sunPath.position.y = earthPath.position.y = top;
    skySun.position.copy(sunDir).multiplyScalar(1000);
    // earthshine: Earth above the horizontal, times the lit share of its disc (1 = full Earth, Sun opposite)
    const earthEl = Math.asin(Math.max(-1, Math.min(1, earthDir.y))) / RAD, lit = (1 - sunDir.dot(earthDir)) / 2;
    earthLight.position.copy(earthDir).multiplyScalar(1000);
    earthLight.intensity = mode === 'relief' ? .6 * Math.sqrt(lit) * THREE.MathUtils.smoothstep(earthEl, -1, 3) : 0;
    for (const [line, obj] of [[sunRay, sunObj], [earthRay, earthObj]]) if (obj) {
      const a = line.geometry.attributes.position.array;
      a[0] = 0; a[1] = top; a[2] = 0; a[3] = obj.position.x; a[4] = obj.position.y; a[5] = obj.position.z;
      line.geometry.attributes.position.needsUpdate = true; line.computeLineDistances();
    }
    if (sunDir.angleTo(lastSun) > .05 * RAD || shadowDirty) {
      lastSun.copy(sunDir); shadowDirty = false;
      const el = Math.asin(Math.max(-1, Math.min(1, sunDir.y))) / RAD;
      sunLight.position.copy(sunDir).multiplyScalar(block.farHalfKm * 2.4);
      // Exposure: level ground is shown equally bright for every Sun above about 18 deg (strength ~ 1 / sin elevation),
      // so a high Sun does not wash the relief out to white. Below that the strength stays at 4.8 and the ground
      // darkens towards sunset, as it does. Display brightness only; the readout's W/m2 are not affected.
      const expose = Math.min(4.8, 1.45 / Math.max(Math.sin(el * RAD), .05));
      sunLight.intensity = mode === 'relief' ? expose * THREE.MathUtils.smoothstep(el, LIGHT_OFF_DEG, LIGHT_FULL_DEG) : 0;
      if (mode === 'relief' && sunLight.intensity > 0) { fitShadow(); renderer.shadowMap.needsUpdate = true; }
    }
  }
  /** The page's Sun and Earth objects come over for as long as the view is open; scale: world size factor for each. */
  function adopt(sun, earth, sunK, earthK) {
    sunObj = sun; earthObj = earth; sunScale = sun.scale.x; earthScale = earth.scale.x;
    sky.add(sun, earth); sun.scale.setScalar(sunK * BODY_EXAG); earth.scale.setScalar(earthK * BODY_EXAG);
  }
  /**
   * The paths of Sun and Earth across the site's sky: arrays of unit vectors [east, north, up] in time order
   * (the page chooses the span: one lunar day for the Sun, one month for the Earth).
   */
  function setPaths(sunENU, earthENU) {
    for (const [line, pts] of [[sunPath, sunENU], [earthPath, earthENU]]) {
      const a = new Float32Array(pts.length * 3);
      pts.forEach((v, i) => { a[i * 3] = v[0] * SKY_KM; a[i * 3 + 1] = v[2] * SKY_KM; a[i * 3 + 2] = -v[1] * SKY_KM; });
      line.geometry.dispose(); line.geometry = new THREE.BufferGeometry(); line.geometry.setAttribute('position', new THREE.BufferAttribute(a, 3));
      line.visible = pathsOn && pts.length > 1;
    }
  }
  function showPaths(on) { pathsOn = on; sunPath.visible = on && !!sunPath.geometry.attributes.position; earthPath.visible = on && !!earthPath.geometry.attributes.position; }
  function release(parent) {
    if (!sunObj) return;
    sunObj.scale.setScalar(sunScale); earthObj.scale.setScalar(earthScale);
    parent.add(sunObj, earthObj); sunObj = earthObj = null;
  }

  function setMode(m) {
    mode = m === 'elevation' ? 'elevation' : 'relief';
    if (mesh) { mesh.material = mode === 'relief' ? reliefMat : dataMat; mesh.castShadow = mesh.receiveShadow = mode === 'relief'; }
    contours.visible = mode === 'elevation' && contoursOn;
    if (contours.visible && block) buildContours();
    shadowDirty = true;
  }
  let contoursOn = true;
  function setContours(on, interval = contourInterval) {
    contoursOn = on; contourInterval = interval;
    contours.visible = mode === 'elevation' && on;
    if (contours.visible && block) buildContours();
  }

  // ---- the point under the pointer -------------------------------------------------------------
  const ro = new THREE.Vector3(), rd = new THREE.Vector3(), normal = new THREE.Vector3(), up = new THREE.Vector3(), hz = new THREE.Vector3();
  /**
   * The ground point under a pointer position (normalised device coordinates), or null beside the square:
   * { xKm, yKm (map of the site, east and north), lat, lon, elevM, slopeDeg, sunElevDeg (above that point's own
   * horizontal), horizonDeg (skyline towards the Sun from there), discFrac, incidenceDeg, fluxWm2 }.
   */
  function pick(ndcX, ndcY) {
    if (!block) return null;
    ro.setFromMatrixPosition(camera.matrixWorld); rd.set(ndcX, ndcY, .5).unproject(camera).sub(ro).normalize();
    // into the box of the drawn square, then march until the ray is below the ground
    let t0 = 0, t1 = 9000;
    for (const [o, d, lo, hi] of [[ro.x, rd.x, -visHalf, visHalf], [ro.y, rd.y, minY - 2, maxY + 2], [ro.z, rd.z, -visHalf, visHalf]]) {
      const a = (lo - o) / d, b = (hi - o) / d; t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b));
    }
    if (!(t1 >= t0)) { cursor.visible = false; return null; }
    const step = block.stepKm * .45, below = t => ro.y + rd.y * t <= heightAt(ro.x + rd.x * t, ro.z + rd.z * t);
    let hit = -1;
    for (let t = t0, prev = t0; t <= t1; prev = t, t += step) if (below(t)) {
      let lo = prev, hi = t; for (let k = 0; k < 8; k++) { const m = (lo + hi) / 2; if (below(m)) hi = m; else lo = m; }
      hit = (lo + hi) / 2; break;
    }
    if (hit < 0) { cursor.visible = false; return null; }
    const wx = THREE.MathUtils.clamp(ro.x + rd.x * hit, -visHalf, visHalf), wz = THREE.MathUtils.clamp(ro.z + rd.z * hit, -visHalf, visHalf), wy = heightAt(wx, wz);
    const e = block.stepKm * .5;
    normal.set(heightAt(wx - e, wz) - heightAt(wx + e, wz), 2 * e, heightAt(wx, wz - e) - heightAt(wx, wz + e)).normalize();
    up.set(wx, wy + r0, wz).normalize();                                   // the point's own vertical
    cursor.position.set(wx, wy + .15, wz); cursor.quaternion.setFromUnitVectors(Z, normal); cursor.visible = true;
    const k = mapScale(wx, wz), xKm = wx * k, yKm = -wz * k, ll = block.latLon(xKm, yKm);
    const sunEl = Math.asin(Math.max(-1, Math.min(1, sunDir.dot(up)))) / RAD;
    // skyline towards the Sun from this point: along the great circle in the Sun's azimuth, exact geometry
    hz.copy(sunDir).addScaledVector(up, -sunDir.dot(up));
    let horizon = -90;
    if (hz.lengthSq() > 1e-12) {
      hz.normalize();
      const rp = Math.hypot(wx, wy + r0, wz) + RECEIVER_HEIGHT_M / 1000, start = 2 * block.sourceCellM / 1000;
      let best = -Infinity;
      for (let d = start; d < 2 * block.farHalfKm; d += d < half ? block.stepKm * .5 : .5) {
        const g = d / MOON_RADIUS_KM, cg = Math.cos(g), sg = Math.sin(g);
        const qx = cg * up.x + sg * hz.x, qy = cg * up.y + sg * hz.y, qz = cg * up.z + sg * hz.z;       // direction of the sample from the Moon's centre
        if (qy <= 0) break;
        const sx = qx * r0, sz = qz * r0, h = heightAt(sx, sz);            // world x, z of the ground in that direction
        if (h !== h) break;
        const rq = Math.hypot(sx, h + r0, sz), t = (rq * cg - rp) / (rq * sg);
        if (t > best) best = t;
      }
      horizon = best > -Infinity ? Math.atan(best) / RAD : -90;
    }
    const frac = discFraction(sunEl - horizon, SUN_RADIUS_DEG), cosInc = normal.dot(sunDir);
    return {
      xKm, yKm, lat: ll.lat, lon: ll.lon, elevM: (Math.hypot(wx, wy + r0, wz) - MOON_RADIUS_KM) * 1000,
      slopeDeg: Math.acos(Math.max(-1, Math.min(1, normal.dot(up)))) / RAD, sunElevDeg: sunEl, horizonDeg: horizon, discFrac: frac,
      incidenceDeg: Math.acos(Math.max(-1, Math.min(1, cosInc))) / RAD, fluxWm2: SOLAR_CONSTANT * frac * Math.max(0, cosInc),
    };
  }
  const Z = new THREE.Vector3(0, 0, 1);

  /** w, h: size of the drawing area in px; left: width taken by the sidebar (the scene is drawn beside it). */
  function resize(w, h, left) {
    const vw = Math.max(w - left, 1); viewW = w; viewH = h;
    camera.aspect = vw / h;
    if (left > 0) camera.setViewOffset(vw, h, -left, 0, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  function render() {
    controls.update(); placeScale();
    farGroup.visible = renderer.shadowMap.needsUpdate && mode === 'relief';   // the far grid only casts shadows: in the frame only when they are redone
    renderer.render(scene, camera);
    farGroup.visible = false;
    const auto = renderer.autoClear; renderer.autoClear = false;       // keep colour and depth: the ground hides what is behind it
    renderer.render(skyScene, camera); renderer.autoClear = auto;
  }

  return {
    scene, camera, controls, load, setSky, adopt, release, setPaths, showPaths, setMode, setContours, pick, resize, render,
    hideCursor: () => { cursor.visible = false; },
    get block() { return block; },
    get range() { return { minM, maxM }; },
    skyDistance: SKY_KM,
  };
}
