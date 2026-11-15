// The terrain view: the ground around one site in true proportions, lit by the Sun as it stands there.
// A second scene for the page's renderer (the system view is the first). The page owns the clock, the
// Sun and Earth objects and every text; this module owns the ground.
//
// World axes (km): x east, y up, z south; the origin is the site's ground point. Heights are not
// exaggerated. The ground is the terrain block of core/terrain.js:
//   near grid  640 x 640 heights over 250 km; the inner 200 km are drawn, the rim only casts shadows
//   far grid   to 300 km, never drawn: it casts shadows into the square, because with a low Sun
//              (near the poles always) mountains far outside still cover it
// Every point is placed in 3D on the sphere, so the Moon's curvature is in the picture: the ground
// 100 km from the site lies 2.9 km below the site's horizontal.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MOON_RADIUS_KM, RAD } from '../core/frames.js';
import { discFraction, SUN_RADIUS_DEG, RECEIVER_HEIGHT_M } from '../core/visibility.js';
import { VIRIDIS, colorAt } from './colors.js';

const SOLAR_CONSTANT = 1361;                 // W/m2 at 1 au
const SKY_KM = 1400;                         // distance at which Sun and Earth are drawn
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
  controls.minDistance = 6; controls.maxDistance = 620; controls.maxPolarAngle = Math.PI * .497; controls.zoomSpeed = .8;

  // faint cool fill, as in the system view, so ground in shadow keeps its shape
  scene.add(new THREE.AmbientLight(0x8fa6c8, .05), new THREE.AmbientLight(0xbfd2ee, .2));
  const sunLight = new THREE.DirectionalLight(0xfff6e8, 4.4);
  sunLight.castShadow = true; sunLight.shadow.mapSize.set(4096, 4096); sunLight.shadow.normalBias = .08;
  scene.add(sunLight, sunLight.target);

  let block = null, RES = 0, FAR = 0, half = 0, visHalf = 100;
  let positions, farPositions, heightColors, geometry, farGeometry, mesh, farMesh;
  let minY = -2, maxY = 2, farMinY = -30, farMaxY = 5, minM = 0, maxM = 1, r0 = MOON_RADIUS_KM;
  const clip = [new THREE.Plane(new THREE.Vector3(1, 0, 0), 100), new THREE.Plane(new THREE.Vector3(-1, 0, 0), 100),
                new THREE.Plane(new THREE.Vector3(0, 0, 1), 100), new THREE.Plane(new THREE.Vector3(0, 0, -1), 100)];
  const reliefMat = new THREE.MeshStandardMaterial({ color: 0xc2c6cc, roughness: .95, metalness: 0, clippingPlanes: clip, clipShadows: false });
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
    scale.add(e, n); ticks.push({ sp: e, v: h + 18, axis: 'x', title: true }, { sp: n, v: -h - 18, axis: 'z', title: true });
    scale.userData.baseY = baseY;
  }
  /** Labels stand on the two edges nearest to the camera and keep one size on screen. */
  function placeScale() {
    const baseY = scale.userData.baseY, sx = camera.position.x >= 0 ? 1 : -1, sz = camera.position.z >= 0 ? 1 : -1, off = visHalf + 9;
    for (const t of ticks) {
      const p = t.sp.position;
      if (t.axis === 'x') p.set(t.v, baseY, sz * off); else p.set(sx * off, baseY, t.v);
      const k = camera.position.distanceTo(p) * (t.title ? .03 : .024);
      t.sp.scale.set(k * t.sp.userData.aspect, k, 1);
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
  const sky = new THREE.Group(); scene.add(sky);
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
    positions = new Float32Array(RES * RES * 3); heightColors = new Float32Array(RES * RES * 3); farPositions = new Float32Array(FAR * FAR * 3);
    const idx = new Uint32Array((RES - 1) * (RES - 1) * 6);
    for (let r = 0, p = 0; r < RES - 1; r++) for (let c = 0; c < RES - 1; c++) {
      const a = r * RES + c, d = a + 1, e = a + RES, f = e + 1;
      idx[p++] = a; idx[p++] = e; idx[p++] = d; idx[p++] = e; idx[p++] = f; idx[p++] = d;
    }
    geometry?.dispose(); farGeometry?.dispose();
    geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(heightColors, 3));
    geometry.setIndex(new THREE.BufferAttribute(idx, 1));
    // far grid: only the cells outside the near grid (those inside are covered by the fine mesh)
    const farStep = 2 * b.farHalfKm / (FAR - 1), fidx = [];
    for (let r = 0; r < FAR - 1; r++) for (let c = 0; c < FAR - 1; c++) {
      const x0 = -b.farHalfKm + c * farStep, y0 = b.farHalfKm - r * farStep;
      if (Math.abs(x0) <= b.halfKm && Math.abs(x0 + farStep) <= b.halfKm && Math.abs(y0) <= b.halfKm && Math.abs(y0 - farStep) <= b.halfKm) continue;
      const a = r * FAR + c, d = a + 1, e = a + FAR, f = e + 1;
      fidx.push(a, e, d, e, f, d);
    }
    farGeometry = new THREE.BufferGeometry();
    farGeometry.setAttribute('position', new THREE.BufferAttribute(farPositions, 3));
    farGeometry.setIndex(new THREE.BufferAttribute(new Uint32Array(fidx), 1));
    if (mesh) group.remove(mesh, farMesh);
    mesh = new THREE.Mesh(geometry, reliefMat); mesh.castShadow = mesh.receiveShadow = true;
    farMesh = new THREE.Mesh(farGeometry, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, clippingPlanes: clip }));
    farMesh.castShadow = true; farMesh.frustumCulled = false;
    group.add(mesh, farMesh);
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
    farGeometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    onProgress(.85, 'Scale and contours'); await pause();
    buildScale(Math.floor(minY - 4));
    const top = heightAt(0, 0);
    pin.position.set(0, top, 0); mast.scale.set(1, 9, 1);
    if (contours.visible) buildContours();
    else contourKey = '';
    camera.position.set(104, top + 84, 128);
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
  const lastSun = new THREE.Vector3(), sunDir = new THREE.Vector3(0, 1, 0), corner = new THREE.Vector3();
  let shadowDirty = true, mode = 'relief';
  // Shadow camera: sideways it only has to cover the drawn square (keeps the shadow map sharp); in depth it
  // must reach every caster, the far grid towards the Sun included.
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
      z0 = Math.min(z0, corner.z); z1 = Math.max(z1, corner.z);
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
    if (earthObj) { earthObj.position.set(earthENU[0], earthENU[2], -earthENU[1]).multiplyScalar(SKY_KM); earthObj.position.y += top; }
    for (const [line, obj] of [[sunRay, sunObj], [earthRay, earthObj]]) if (obj) {
      const a = line.geometry.attributes.position.array;
      a[0] = 0; a[1] = top; a[2] = 0; a[3] = obj.position.x * .12; a[4] = top + (obj.position.y - top) * .12; a[5] = obj.position.z * .12;
      line.geometry.attributes.position.needsUpdate = true; line.computeLineDistances();
    }
    if (sunDir.angleTo(lastSun) > .05 * RAD || shadowDirty) {
      lastSun.copy(sunDir); shadowDirty = false;
      const el = Math.asin(Math.max(-1, Math.min(1, sunDir.y))) / RAD;
      sunLight.position.copy(sunDir).multiplyScalar(block.farHalfKm * 2.4);
      sunLight.intensity = mode === 'relief' ? 4.4 * THREE.MathUtils.smoothstep(el, LIGHT_OFF_DEG, LIGHT_FULL_DEG) : 0;
      if (mode === 'relief' && sunLight.intensity > 0) { fitShadow(); renderer.shadowMap.needsUpdate = true; }
    }
  }
  /** The page's Sun and Earth objects come over for as long as the view is open; scale: world size factor for each. */
  function adopt(sun, earth, sunK, earthK) {
    sunObj = sun; earthObj = earth; sunScale = sun.scale.x; earthScale = earth.scale.x;
    sky.add(sun, earth); sun.scale.setScalar(sunK); earth.scale.setScalar(earthK);
  }
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
    const vw = Math.max(w - left, 1);
    camera.aspect = vw / h;
    if (left > 0) camera.setViewOffset(vw, h, -left, 0, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  function render() { controls.update(); placeScale(); renderer.render(scene, camera); }

  return {
    scene, camera, controls, load, setSky, adopt, release, setMode, setContours, pick, resize, render,
    hideCursor: () => { cursor.visible = false; },
    get block() { return block; },
    get range() { return { minM, maxM }; },
    skyDistance: SKY_KM,
  };
}
