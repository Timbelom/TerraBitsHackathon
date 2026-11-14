// Landing page: a real-time 3D Moon (three.js) instead of a flat hero image.
// Colour: NASA SVS CGI Moon Kit (LROC WAC), relief: normal map derived from our LOLA grid.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { inertialSky, SIDEREAL_DAYS, DAY_MS, MOON_RADIUS_KM, EARTH_RADIUS_KM, SUN_RADIUS_KM, AU_KM } from './lunar-sky.js';

const world = document.getElementById('world');
const canvas = document.getElementById('moon-canvas');
const hero = document.querySelector('.hero');
const target = document.getElementById('moon-target');
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const R = 2, FOV = 45;
let busy = false;

function leave() { location.href = 'globe.html'; }

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
} catch (e) {
  // No WebGL: keep the page usable, links still lead into the globe.
  world.classList.add('ready', 'no-webgl');
  document.querySelectorAll('[data-enter]').forEach(a => a.addEventListener('click', () => {}));
  target.addEventListener('click', leave);
  throw e;
}
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x02040b, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 20000);

// --- Moon -----------------------------------------------------------------
const loader = new THREE.TextureLoader();
const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
// The relief (normal map) may only shape sunlight where the Sun is actually above the local
// horizon of the smooth sphere. Without this, crater walls far inside the night side would
// catch light and sparkle.
material.onBeforeCompile = shader => {
  shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
    #if NUM_DIR_LIGHTS > 0
      float sunUp = smoothstep(-.02, .12, dot(normalize(vNormal), directionalLights[0].direction));
      reflectedLight.directDiffuse *= sunUp; reflectedLight.directSpecular *= sunUp;
    #endif`);
};
const moon = new THREE.Mesh(new THREE.SphereGeometry(R, 160, 80), material);
const pivot = new THREE.Group();             // the space: turns only when the user drags, never by itself
pivot.add(moon);
pivot.rotation.set(0.22, 1.76, 0);            // Earth sits behind the Moon to the right, so it shows in the distance
scene.add(pivot);

let pending = 2;
const done = () => { if (--pending === 0) world.classList.add('ready'); };
loader.load('assets/moon-color.jpg', t => {
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  material.map = t; material.needsUpdate = true; done();
}, undefined, done);
loader.load('assets/moon-normal.jpg', t => {
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  material.normalMap = t; material.normalScale.set(1.35, 1.35); material.needsUpdate = true; done();
}, undefined, done);

// --- Sun and Earth -----------------------------------------------------------------
// Frame: Moon-centred, axes fixed to the stars (inertialSky in lunar-sky.js, checked against JPL
// Horizons). The star field and the space stand still. Everything that moves does so from one
// clock (simMs): the Moon turns once per sidereal month, the Earth circles the Moon in the same
// time and spins once per day, the Sun goes round once per year.
// TIME_SCALE is the single time scale: simulated seconds per real second. Change it here to
// speed everything up or slow it down together. 1 = real time.
//   5000 -> one Earth day in 17 s, one sidereal month in 7.9 min, one year in 105 min.
const TIME_SCALE = 5000;
// Size scale, with NASA fact-sheet radii:
//   - 1 scene unit = Moon radius / R, so the Moon is true size by definition
//   - Earth: true distance (about 221 Moon radii), drawn EXAG times larger than true
//   - Sun: effectively at infinity; placed at SUN_DIST with its true angular size times EXAG
// So from the Moon the Earth looks about 3.6 times wider than the Sun, as in reality.
const KM = R / MOON_RADIUS_KM, EXAG = 3;
const EARTH_R = EARTH_RADIUS_KM * KM * EXAG;
const SUN_DIST = 2400, SUN_R = SUN_DIST * (SUN_RADIUS_KM / AU_KM) * EXAG;

const sunLight = new THREE.DirectionalLight(0xfff6e8, 4.4);
pivot.add(sunLight);                                   // target stays at the Moon (origin)
scene.add(new THREE.AmbientLight(0x8fa6c8, 0.05));    // faint fill so the night side is not black
// Start view only: a very weak, flat cool light, so the night side is not a
// pure black disc behind the title. The Sun does all the visible shading and shadows.
const FILL = .2;
const fill = new THREE.AmbientLight(0xbfd2ee, FILL);
scene.add(fill);

function radialTexture(stops) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  stops.forEach(([o, col]) => grad.addColorStop(o, col));
  g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
// Sun: procedural, no texture. Surface = animated granulation with limb darkening and a few
// sunspots; corona = camera-facing quad with a soft falloff and slowly moving streamers.
const NOISE = `
float hash(vec3 p){ p = fract(p * .3183099 + .1); p *= 17.; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec3 p){ float a = .5, s = 0.; for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + 7.1; a *= .5; } return s; }`;
const sunUniforms = { uTime: { value: 0 } };
const sunSurface = new THREE.Mesh(new THREE.SphereGeometry(SUN_R, 96, 48), new THREE.ShaderMaterial({
  uniforms: sunUniforms, toneMapped: false,
  vertexShader: `varying vec3 vP; varying vec3 vN; varying vec3 vV;
    void main(){ vP = normalize(position); vec4 mv = modelViewMatrix * vec4(position, 1.);
      vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform float uTime; varying vec3 vP; varying vec3 vN; varying vec3 vV;` + NOISE + `
    void main(){
      float t = uTime;
      vec3 q = vP + .12 * vec3(fbm(vP * 3. + t * .05), fbm(vP * 3. + 4.2 - t * .04), fbm(vP * 3. + 9.7));
      float cells = fbm(q * 9. + vec3(0., t * .09, 0.));               // granulation
      float large = fbm(q * 2.2 - vec3(t * .02, 0., 0.));               // slow large-scale brightness
      float spots = smoothstep(.27, .22, fbm(vP * 3.4 + 21.)) * smoothstep(.75, .35, abs(vP.y));
      float heat = clamp(.56 + .75 * (cells - .45) + .55 * (large - .5), 0., 1.);
      vec3 col = mix(vec3(.95, .30, .03), vec3(1., .66, .16), smoothstep(0., .55, heat));
      col = mix(col, vec3(1., .95, .74), smoothstep(.5, 1., heat));
      col *= 1. - .5 * spots;
      float mu = clamp(dot(normalize(vN), normalize(vV)), 0., 1.);
      col *= .38 + .62 * pow(mu, .55);                                  // limb darkening
      col = mix(vec3(1., .42, .10) * col.r * 1.2, col, smoothstep(0., .45, mu));
      gl_FragColor = vec4(col * 1.4, 1.);
    }` }));
const CORONA_SIZE = SUN_R * 16;
const corona = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
  uniforms: { uTime: sunUniforms.uTime, uSize: { value: CORONA_SIZE }, uR0: { value: SUN_R / (CORONA_SIZE / 2) } },
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  vertexShader: `uniform float uSize; varying vec2 vUv;
    void main(){ vUv = position.xy * 2.;
      float s = length(modelMatrix[0].xyz) * uSize;                      // always faces the camera
      vec4 c = modelViewMatrix * vec4(0., 0., 0., 1.); c.xy += position.xy * s; gl_Position = projectionMatrix * c; }`,
  fragmentShader: `uniform float uTime; uniform float uR0; varying vec2 vUv;` + NOISE + `
    void main(){
      float r = length(vUv), d = max(r - uR0, 0.), a = atan(vUv.y, vUv.x);
      vec3 ring = vec3(cos(a), sin(a), 0.);
      float rays = fbm(ring * 2.6 + vec3(0., 0., uTime * .03 + r * .6));
      float fine = fbm(ring * 9. + vec3(0., 0., 3. - uTime * .05 + r * 2.));
      float inner = exp(-d * 15.);                                       // bright rim right at the limb
      float mid = exp(-d * 5.2) * (.55 + .9 * rays);
      float outer = exp(-d * 2.1) * (.25 + .9 * rays * fine);
      float i = (1.15 * inner + .55 * mid + .22 * outer) * smoothstep(1., .55, r);
      vec3 col = mix(vec3(1., .50, .16), vec3(1., .93, .76), clamp(inner + .5 * mid, 0., 1.));
      gl_FragColor = vec4(col * i, 1.);
    }` }));
corona.frustumCulled = false;
const sun = new THREE.Group();
sun.add(sunSurface, corona);

// NASA Sun model (science.nasa.gov, "3D Model of the Sun", Sun_1_1391000.glb): a unit sphere with an
// emissive surface texture. We keep its geometry and texture, and add limb darkening and a slow
// shimmer. Until it has loaded (or if it fails) the procedural surface above stays visible.
new GLTFLoader().load('assets/sun.glb', gltf => {
  let mesh = null; gltf.scene.traverse(o => { if (o.isMesh && !mesh) mesh = o; });
  const map = mesh && (mesh.material.emissiveMap || mesh.material.map);
  if (!map) return;
  mesh.material = new THREE.ShaderMaterial({
    uniforms: { uTime: sunUniforms.uTime, uMap: { value: map } },
    vertexShader: `varying vec2 vUv; varying vec3 vP; varying vec3 vN; varying vec3 vV;
      void main(){ vUv = uv; vP = normalize(position); vec4 mv = modelViewMatrix * vec4(position, 1.);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uTime; uniform sampler2D uMap; varying vec2 vUv; varying vec3 vP; varying vec3 vN; varying vec3 vV;` + NOISE + `
      void main(){
        vec3 col = texture2D(uMap, vUv).rgb;
        col *= .9 + .22 * fbm(vP * 14. + vec3(0., uTime * .12, 0.));    // slow shimmer of the granulation
        float mu = clamp(dot(normalize(vN), normalize(vV)), 0., 1.);
        col *= .42 + .58 * pow(mu, .5);                                   // limb darkening
        gl_FragColor = vec4(col * 1.2, 1.);
        #include <colorspace_fragment>
      }` });
  const box = new THREE.Box3().setFromObject(gltf.scene), size = box.getSize(new THREE.Vector3());
  gltf.scene.scale.multiplyScalar(2 * SUN_R / Math.max(size.x, size.y, size.z));
  sun.remove(sunSurface); sun.add(gltf.scene);
});

const earth = new THREE.Group();
const earthMaterial = new THREE.MeshStandardMaterial({ color: 0x3b6ea8, roughness: .85, metalness: 0 });
const earthBall = new THREE.Mesh(new THREE.SphereGeometry(EARTH_R, 64, 32), earthMaterial);
const haze = new THREE.Sprite(new THREE.SpriteMaterial({ blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  map: radialTexture([[0, 'rgba(90,160,255,0)'], [.74, 'rgba(90,160,255,0)'], [.84, 'rgba(110,175,255,.30)'], [1, 'rgba(0,0,0,0)']]) }));
haze.scale.set(EARTH_R * 2.62, EARTH_R * 2.62, 1);
earth.add(earthBall, haze);
loader.load('assets/earth-day.jpg', t => {
  t.colorSpace = THREE.SRGBColorSpace; earthMaterial.map = t; earthMaterial.color.set(0xffffff); earthMaterial.needsUpdate = true;
});
pivot.add(sun, earth);

// Paths: the Earth's orbit around the Moon (one sidereal month) and the Sun's yearly path.
function path(fn, periodDays, color, opacity, t0) {
  const pts = [];
  for (let i = 0; i <= 360; i++) pts.push(new THREE.Vector3(...fn(inertialSky(t0 + (i / 360) * periodDays * DAY_MS))));
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
}
const scaled = (v, k) => [v[0] * k, v[1] * k, v[2] * k];
// Start view: Moon in front, Sun far behind it on the left, Earth far behind it on the right.
// We start at the next moment when the Sun stands 60 degrees ahead of the Earth as seen from the
// Moon, and turn the space once so both are in the frame. After that nothing turns by itself:
// the Earth moves on along its orbit (behind the Moon and out of the frame), the Sun hardly moves.
const rad = THREE.MathUtils.degToRad, az = v => Math.atan2(v[0], v[2]);
const wrap = x => Math.atan2(Math.sin(x), Math.cos(x));
const startMs = (() => {
  let best = Date.now(), score = 9;
  for (let i = 0; i < 1440; i++) {
    const ms = Date.now() + i / 1440 * 29.6 * DAY_MS, d = inertialSky(ms);
    const off = Math.abs(wrap(az(d.sun) - az(d.earth) - rad(60)));
    if (off < score) { score = off; best = ms; }
  }
  pivot.rotation.set(.04, rad(206) - az(inertialSky(best).sun), 0);      // Sun 26 degrees left of "straight behind"
  return best;
})();
const orbits = new THREE.Group();
orbits.add(path(d => scaled(d.sun, SUN_DIST), 365.25, 0xd9b377, .2, startMs));
orbits.add(path(d => scaled(d.earth, d.earthDistKm * KM), SIDEREAL_DAYS, 0x7fb0e0, .42, startMs));
orbits.children.forEach(l => { l.userData.opacity = l.material.opacity; l.material.opacity = 0; l.frustumCulled = false; });
pivot.add(orbits);

// Stars: fixed in this frame. One constant rotation takes catalogue (ICRS) directions to scene axes.
const sky = new THREE.Group();
pivot.add(sky);
const tmpMatrix = new THREE.Matrix4();
// Sphere-local axes (x = lon 0, y = north, z = lon 90 W) -> body-fixed axes (x = lon 0, y = lon 90 E, z = north),
// followed by the body -> scene rotation B (3x3 rows).
function orient(obj, B) {
  tmpMatrix.set(B[0][0], B[0][2], -B[0][1], 0, B[1][0], B[1][2], -B[1][1], 0, B[2][0], B[2][2], -B[2][1], 0, 0, 0, 0, 1);
  obj.quaternion.setFromRotationMatrix(tmpMatrix);
}
{ const S = inertialSky(startMs).icrsToScene;
  tmpMatrix.set(S[0][0], S[0][1], S[0][2], 0, S[1][0], S[1][1], S[1][2], 0, S[2][0], S[2][1], S[2][2], 0, 0, 0, 0, 1);
  sky.quaternion.setFromRotationMatrix(tmpMatrix); }
let simMs = startMs;
function placeBodies() {
  const d = inertialSky(simMs);
  sun.position.set(...d.sun).multiplyScalar(SUN_DIST);
  sunLight.position.set(...d.sun).multiplyScalar(100);
  earth.position.set(...d.earth).multiplyScalar(d.earthDistKm * KM);
  orient(moon, d.moonToScene);        // the Moon turns, always showing the Earth the same face
  orient(earthBall, d.earthToScene);  // true axis, one turn per day
}
placeBodies();

// --- Stars: real sky, Moon-fixed frame -------------------------------------------
// The star field is fixed; it only turns when the user drags the space.
// Stars: Yale Bright Star Catalogue (9096 stars, J2000). Seen from the Moon the sky is the same
// as from Earth; only its orientation differs. Orientation: IAU rotation model of the Moon
// (pole right ascension/declination and prime meridian W, first three periodic terms).
// Checked against JPL Horizons sub-solar points 2027-2066: within 0.04 degrees.
function starColor(k, out) {                      // rough blackbody tint from effective temperature
  const stops = [[2500, 1, .62, .38], [4000, 1, .80, .60], [5800, 1, .95, .88], [8000, .86, .90, 1], [15000, .72, .80, 1], [40000, .62, .72, 1]];
  let a = stops[0], b = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) if (k >= stops[i][0] && k <= stops[i + 1][0]) { a = stops[i]; b = stops[i + 1]; }
  const f = THREE.MathUtils.clamp((k - a[0]) / (b[0] - a[0] || 1), 0, 1);
  out[0] = a[1] + (b[1] - a[1]) * f; out[1] = a[2] + (b[2] - a[2]) * f; out[2] = a[3] + (b[3] - a[3]) * f;
}
const icrs = (raDeg, decDeg, r) => [r * Math.cos(rad(decDeg)) * Math.cos(rad(raDeg)), r * Math.cos(rad(decDeg)) * Math.sin(rad(raDeg)), r * Math.sin(rad(decDeg))];
fetch('assets/stars-bsc5.json').then(r => r.json()).then(cat => {
  const n = cat.stars.length / 4, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), c = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const [ra, dec, mag, k] = cat.stars.slice(i * 4, i * 4 + 4);
    pos.set(icrs(ra, dec, 6000), i * 3);
    const b = THREE.MathUtils.clamp(.22 + (6.5 - mag) * .14, .22, 1);     // brighter star = brighter and larger point
    starColor(k, c); col.set([c[0] * b, c[1] * b, c[2] * b], i * 3);
    size[i] = THREE.MathUtils.clamp(1.3 + (5.5 - mag) * .8, 1.3, 7.5);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const points = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: { uPx: { value: renderer.getPixelRatio() } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float size; attribute vec3 color; uniform float uPx; varying vec3 vC;
      void main(){ vC = color; gl_PointSize = size * uPx; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `varying vec3 vC; void main(){ float d = length(gl_PointCoord - .5) * 2.; gl_FragColor = vec4(vC * smoothstep(1., .15, d), 1.); }` }));
  points.frustumCulled = false;
  sky.add(points);
}).catch(() => {});

// --- Layout -----------------------------------------------------------------
let closeDistance = 11, systemDistance = 20, restDistance = 11;
let expanded = false, mix = 0, zoom = null;         // mix: 0 = close to the Moon, 1 = whole system
function layout() {
  const w = world.clientWidth, h = world.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  const k = 2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  // After the click: stay close, Moon diameter 46 % of the height (at most 66 % of the width).
  systemDistance = Math.max(2 * R / (.46 * k), 2 * R / (.66 * k * camera.aspect));
  // Start view: Moon diameter 56 % of the height, but never more than 78 % of the width.
  closeDistance = Math.max(2 * R / (.56 * k), 2 * R / (.78 * k * camera.aspect));
  restDistance = closeDistance + (systemDistance - closeDistance) * mix;
  if (!busy) camera.position.set(0, 0, restDistance);
  camera.updateProjectionMatrix();
  const d = 2 * R / (k * restDistance) * h;   // projected diameter in px, for the keyboard target
  Object.assign(target.style, { left: (w - d) / 2 + 'px', top: (h - d) / 2 + 'px', width: d + 'px', height: d + 'px' });
}
addEventListener('resize', layout);
layout();

// --- Interaction: drag to turn, click to enter ------------------------------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function onMoon(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return ray.intersectObject(moon).length > 0;
}
let drag = null, vy = 0, vx = 0;
hero.addEventListener('pointerdown', e => {
  if (busy || e.target.closest('a, .params')) return;                // drag anywhere turns the space
  drag = { x: e.clientX, y: e.clientY, moved: 0 };
  hero.setPointerCapture(e.pointerId); hero.classList.add('dragging');
});
hero.addEventListener('pointermove', e => {
  if (!drag) { hero.style.cursor = busy ? '' : expanded && onMoon(e) ? 'pointer' : 'grab'; return; }
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
  vy = dx * .006; vx = dy * .006;
  pivot.rotation.y += vy;
  pivot.rotation.x = THREE.MathUtils.clamp(pivot.rotation.x + vx, -1.1, 1.1);
});
let lastMoved = 0;
function release() {
  if (!drag) return;
  lastMoved = drag.moved; drag = null; hero.classList.remove('dragging');
}
hero.addEventListener('pointerup', release);
hero.addEventListener('pointercancel', release);
// First click anywhere: title away, zoom out to the whole system. After that a click on the Moon enters.
function expand() {
  if (expanded || busy) return; expanded = true;
  document.body.classList.add('expanded');
  // Only the camera moves back; the space keeps its orientation.
  if (reduce.matches) { applyMix(1); layout(); return; }
  zoom = { t0: performance.now(), ms: 2200 };
}
function applyMix(m) {
  mix = m;
  restDistance = closeDistance + (systemDistance - closeDistance) * m;
  camera.position.z = restDistance;
  orbits.children.forEach(l => { l.material.opacity = l.userData.opacity * m; });
  fill.intensity = FILL * (1 - m);
  placeBodies();
}
applyMix(0); layout();
hero.addEventListener('click', e => {
  const moved = lastMoved; lastMoved = 0;
  if (busy || moved >= 6 || e.target.closest('a, .params')) return;
  if (!expanded) expand(); else if (onMoon(e)) enter();
});

let flight = null;
function enter() {
  if (busy) return; busy = true;
  if (reduce.matches) return leave();
  document.body.classList.add('entering');
  zoom = null;
  flight = { t0: performance.now(), from: camera.position.z, to: R * 1.22, ms: 1050 };
  setTimeout(leave, 1000);
}
target.addEventListener('click', () => expanded ? enter() : expand());
target.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); expanded ? enter() : expand(); } });
document.querySelectorAll('[data-enter]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); enter(); }));
addEventListener('pageshow', e => { if (e.persisted) { busy = false; flight = null; document.body.classList.remove('entering'); layout(); } });

// --- Loop -------------------------------------------------------------------
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, .05); last = now;
  if (scrollY > innerHeight && !flight) return;           // hero is off screen
  if (!drag) {
    pivot.rotation.y += vy; pivot.rotation.x = THREE.MathUtils.clamp(pivot.rotation.x + vx, -1.1, 1.1);
    vy *= .94; vx *= .94;
  }
  if (!reduce.matches) {
    simMs += dt * 1000 * TIME_SCALE;                      // the one clock for every motion
    placeBodies();
  }
  sunUniforms.uTime.value += dt;
  if (zoom && !flight) {
    const p = Math.min((now - zoom.t0) / zoom.ms, 1);
    const e = p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    applyMix(e);
    if (p === 1) { zoom = null; layout(); }
  }
  if (flight) {
    const p = Math.min((now - flight.t0) / flight.ms, 1), e = p * p * (3 - 2 * p);
    camera.position.z = flight.from + (flight.to - flight.from) * e;
  }
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// Parameter drawer (left edge): the tab folds the panel in and out, each row switches one layer.
{ const box = document.getElementById('params'), tab = document.getElementById('params-tab');
  const layers = {
    sunPath: on => { orbits.children[0].visible = on; },
    earthOrbit: on => { orbits.children[1].visible = on; },
    stars: on => { sky.visible = on; },
    relief: on => { const k = on ? 1.35 : 0; material.normalScale.set(k, k); },
  };
  tab.addEventListener('click', () => tab.setAttribute('aria-expanded', box.classList.toggle('open')));
  box.querySelectorAll('.param').forEach(b => b.addEventListener('click', () => {
    const on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', on); layers[b.dataset.param]?.(on);
  }));
  addEventListener('keydown', e => { if (e.key === 'Escape' && box.classList.contains('open')) tab.click(); });
}
