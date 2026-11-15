// Landing page: the system view (Moon, Earth, Sun and stars from one clock) and, from "View terrain", the
// ground around one point. One renderer and one clock for both; the terrain view is a second scene (view/terrain-view.js).
// The Moon is a mesh over the global LOLA grid (view/moon-globe.js). Albedo for the "Imagery" surface:
// NASA SVS CGI Moon Kit (LROC WAC). Until the grid has loaded, or if it cannot be loaded, a smooth sphere
// with that albedo stands in.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createPins } from './landing-pins.js';
import { createSearch } from './landing-search.js';
import { createCards } from './landing-cards.js';
import { createSeries, windowFor } from './landing-series.js';
import { createSky } from './landing-sky.js';
import { createArea, LIMIT_MAX_H } from './landing-area.js';
import { createExposure } from './landing-exposure.js';
import { inertialSky, loadHorizons, onSkyChange, skySource, SOURCE_LABEL, SIDEREAL_DAYS, DAY_MS, MOON_RADIUS_KM, EARTH_RADIUS_KM, SUN_RADIUS_KM, AU_KM } from './core/sky.js';
import { TerrainSource, GlobeGrid } from './core/terrain.js';
import { createSiteData } from './ui/site-data.js';
import { createMoonGlobe } from './view/moon-globe.js';
import { createTerrainView } from './view/terrain-view.js?v=4';
import { VIRIDIS, SUNLIGHT, EARTHVIEW, cssGradient } from './view/colors.js';
import { siteState, makeSite, skylineFromGlobe, discFraction, SUN_RADIUS_DEG, basisLabel } from './core/visibility.js';
import { RAD, basisAt, bodyToThree, coordLabel } from './core/frames.js';

const world = document.getElementById('world');
const canvas = document.getElementById('moon-canvas');
const hero = document.querySelector('.hero');
const target = document.getElementById('moon-target');
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const R = 2, FOV = 45;
let busy = false;
let scope = 'system';                          // 'system': Moon, Earth, Sun | 'terrain': the ground around one point
let globe = null;                              // the lunar relief mesh (view/moon-globe.js), once the global grid has loaded
let terrain = null;                            // the terrain view (view/terrain-view.js)

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
} catch (e) {
  // No WebGL: the page stays readable (title, text, links), the 3D views are not there.
  world.classList.add('ready', 'no-webgl');
  throw e;
}
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x02040b, 1);
// Shadows are redone only when the Sun has moved (shadowMap.needsUpdate), not with every frame.
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.shadowMap.autoUpdate = false;
renderer.localClippingEnabled = true;          // the terrain view cuts its ground to the drawn square

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 20000);

// --- Moon -----------------------------------------------------------------
// `moon` is the Moon's node: it carries the lunar axes (see orient below), the markers refer to it, and its
// smooth sphere is what pointer rays are tested against first. Its own material is only seen while the
// relief mesh is not there; that mesh is added to it further down (Lunar surface).
const loader = new THREE.TextureLoader();
const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
const moon = new THREE.Mesh(new THREE.SphereGeometry(R, 160, 80), material);
const pivot = new THREE.Group();             // the space: turns only when the user drags, never by itself
pivot.add(moon);
pivot.rotation.set(0.22, 1.76, 0);            // Earth sits behind the Moon to the right, so it shows in the distance
scene.add(pivot);

// The scene is shown once the albedo is there and the lunar surface is settled (relief mesh built, or given up).
let pending = 2, albedo = null;
const done = () => { if (--pending === 0) world.classList.add('ready'); };
loader.load('assets/moon-color.jpg', t => {
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  albedo = t; material.map = t; material.needsUpdate = true; globe?.setAlbedo(t); done();
}, undefined, done);

// --- Sun and Earth -----------------------------------------------------------------
// Frame: Moon-centred, axes fixed to the stars (inertialSky in core/sky.js: Sun and Earth from JPL Horizons
// where its table covers the date, the analytic model of lunar-sky.js otherwise). Everything that moves does so from one
// clock (simMs). The scene is shown Moon-fixed (see placeBodies): the Moon stands still and the sky turns
// around it once per sidereal month. In star-fixed terms: the Moon turns once per sidereal month, the Earth circles the Moon in the same
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
// The Sun throws the relief's shadows. The shadow camera looks at the whole Moon from the light's place
// (SUN_LIGHT_DIST Moon-scene units out, in the Sun's direction).
const SUN_LIGHT_DIST = 10;
sunLight.castShadow = true; sunLight.shadow.mapSize.set(4096, 4096);
{ const c = sunLight.shadow.camera, b = R * 1.02;
  c.left = c.bottom = -b; c.right = c.top = b; c.near = SUN_LIGHT_DIST - b * 1.01; c.far = SUN_LIGHT_DIST + b * 1.01; c.updateProjectionMatrix(); }
sunLight.shadow.bias = -.0004; sunLight.shadow.normalBias = R * 1.75e-4;
scene.add(new THREE.AmbientLight(0x8fa6c8, 0.05));    // faint fill so the night side is not black
// A very weak, flat cool light in both views, so the night side is not a pure black disc: its craters
// stay readable, and it still reads as the night side. The Sun does all the visible shading and shadows.
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
// sunspots; aura = camera-facing quad, see below.
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
// Aura instead of a halo: no wide soft glow. A thin bright rim at the limb, a low layer of plasma
// that streams outwards with uneven height, and a few prominences (loops) that rise, fade and
// reappear somewhere else. Everything is driven by uTime, nothing is a texture.
const CORONA_SIZE = SUN_R * 6;
const corona = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
  uniforms: { uTime: sunUniforms.uTime, uSize: { value: CORONA_SIZE }, uR0: { value: SUN_R / (CORONA_SIZE / 2) } },
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  vertexShader: `uniform float uSize; varying vec2 vUv;
    void main(){ vUv = position.xy * 2.;
      float s = length(modelMatrix[0].xyz) * uSize;                      // always faces the camera
      vec4 c = modelViewMatrix * vec4(0., 0., 0., 1.); c.xy += position.xy * s; gl_Position = projectionMatrix * c; }`,
  fragmentShader: `uniform float uTime; uniform float uR0; varying vec2 vUv;` + NOISE + `
    // One prominence, simplified: a magnetic loop of fixed shape anchored on the limb. Plasma climbs
    // slowly from one footpoint along the loop until it is filled, glows for a while, then cools and
    // thins out in place. The loop itself never changes size; a cycle lasts roughly a minute.
    float flare(vec2 dir, float h, float a, float seed, float t){
      float cyc = t * (.012 + .008 * hash(vec3(seed, 1., 2.))) + seed * 3.7;
      float k = floor(cyc), ph = fract(cyc);
      float a0 = 6.2832 * hash(vec3(seed, k, 5.));
      float s = atan(sin(a - a0), cos(a - a0));                          // signed angle from the anchor
      float w = .08 + .08 * hash(vec3(k, seed, 9.));
      float H = .16 + .26 * hash(vec3(seed, k, 3.));
      vec2 e = vec2(s / w, h / H);
      float ring = abs(length(e) - 1.);
      float u = atan(e.y, e.x) / 3.1416;                                 // 0..1 from one footpoint to the other
      if (hash(vec3(k, seed, 7.)) > .5) u = 1. - u;
      float front = smoothstep(0., .45, ph) * 1.2;                       // how far the plasma has climbed
      float filled = 1. - smoothstep(front - .18, front, u);
      float fade = smoothstep(1., .62, ph);
      float fil = .45 + 1.1 * fbm(vec3(u * 7. - t * .25, ring * 5., seed + k)); // plasma moving along the loop
      return smoothstep(.2 * (.6 + .4 * fade), 0., ring) * filled * fade * fil;
    }
    void main(){
      vec2 p = vUv / uR0;                                                // limb at length 1
      float rr = length(p), h = max(rr - 1., 0.), a = atan(p.y, p.x), t = uTime;
      vec2 dir = p / max(rr, 1e-4);
      float edge = fbm(vec3(dir * 2.4, t * .06));
      float height = .35 + 1.0 * edge * edge;                            // aura is higher in some directions
      float warp = fbm(vec3(dir * 4., h * 3. - t * .25));
      float plasma = fbm(vec3(dir * 7. + warp, h * 9. - t * .6));        // streams outwards
      float aura = exp(-h / height * 2.4) * (.25 + 1.5 * plasma * plasma * 2.);
      float rim = exp(-h * 40.);
      float fl = 0.;
      for (int i = 0; i < 5; i++) fl += flare(dir, h, a, float(i) + 1., t);
      float glow = exp(-h * 2.2) * (.6 + .5 * edge);                     // warm, close to the disc, uneven
      float i = (.9 * rim + .95 * aura + 1.2 * fl) * smoothstep(.96, 1., rr) * smoothstep(1. / uR0, .8 / uR0, rr);
      vec3 col = mix(vec3(1., .26, .04), vec3(1., .55, .11), smoothstep(.1, .7, i));
      col = mix(col, vec3(1., .93, .62), smoothstep(.8, 1.8, i));
      float mask = smoothstep(.96, 1., rr) * smoothstep(1. / uR0, .8 / uR0, rr);
      gl_FragColor = vec4(col * i + vec3(1., .34, .07) * glow * .5 * mask, 1.);
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
  sun.remove(sunSurface); sun.add(gltf.scene); gltf.scene.visible = !sdoLive;
});

// Real Sun, if the file is there: a full-disc movie from NASA's Solar Dynamics Observatory (AIA 304 A,
// 10 May 2024, a day with strong flares) on a camera-facing disc. SDO orbits the Earth, so this is
// the Sun as seen from the Earth-Moon system. It replaces the modelled surface and aura above; without the
// file (assets/sun-sdo.mp4) nothing changes. The footage is not synchronised with the simulated date.
// Courtesy of NASA/SDO and the AIA, EVE, and HMI science teams.
let sdoLive = false;
{ const SDO_LIMB = .774;                                   // solar radius / half image width in AIA full-disc frames
  const video = document.createElement('video');
  Object.assign(video, { src: 'assets/sun-sdo.mp4', muted: true, loop: true, playsInline: true, preload: 'auto' });
  video.addEventListener('loadeddata', () => {
    const map = new THREE.VideoTexture(video); map.colorSpace = THREE.SRGBColorSpace;
    const disc = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      uniforms: { uMap: { value: map }, uSize: { value: 2 * SUN_R / SDO_LIMB }, uLimb: { value: SDO_LIMB } },
      transparent: true, depthWrite: false, toneMapped: false,
      vertexShader: `uniform float uSize; varying vec2 vUv;
        void main(){ vUv = position.xy * 2.;
          float s = length(modelMatrix[0].xyz) * uSize;                  // always faces the camera
          vec4 c = modelViewMatrix * vec4(0., 0., 0., 1.); c.xy += position.xy * s; gl_Position = projectionMatrix * c; }`,
      fragmentShader: `uniform sampler2D uMap; uniform float uLimb; varying vec2 vUv;
        void main(){
          float r = length(vUv);
          vec3 col = texture2D(uMap, vUv * .5 + .5).rgb;
          float lum = max(col.r, max(col.g, col.b));
          float a = max(1. - smoothstep(uLimb - .012, uLimb, r), clamp(lum * 2.2, 0., 1.)); // solid disc, see-through sky around it
          a *= 1. - smoothstep(.9, .99, r);                              // cuts the frame corners with the time stamp
          col.g = min(1., col.g + .2 * col.r);                             // red towards orange
          col = mix(vec3(dot(col, vec3(.3, .59, .11))), col, .86);          // slightly less saturated
          gl_FragColor = vec4(col, a);
          #include <colorspace_fragment>
        }` }));
    disc.frustumCulled = false;
    sdoLive = true;
    sun.children.forEach(c => { c.visible = false; });
    sun.add(disc);
    video.playbackRate = .3;                                // one day of Sun in about 25 s, then it loops
    if (!reduce.matches) video.play().catch(() => {});
  }, { once: true });
  video.load();
}

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
  const points = t => { const pts = []; for (let i = 0; i <= 360; i++) pts.push(new THREE.Vector3(...fn(inertialSky(t + (i / 360) * periodDays * DAY_MS)))); return pts; };
  const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points(t0)), new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
  l.userData.retime = t => l.geometry.setFromPoints(points(t));     // the path from another moment on
  return l;
}
const scaled = (v, k) => [v[0] * k, v[1] * k, v[2] * k];
// The clock starts at the Start date and time of the sidebar (UTC); every body stands where it is at
// that moment. The space is turned once so the Sun is far behind the Moon on the left (26 degrees left
// of "straight behind"). With no Start set, the clock begins at the next moment the Earth then stands behind
// the Moon on the right (28 degrees right of "straight behind"), so the opening view shows Sun, Moon and Earth.
// After that nothing turns by itself; only the bodies move with the clock.
const rad = THREE.MathUtils.degToRad, az = v => Math.atan2(v[0], v[2]);
/** UTC ms of a date field and its time field, NaN if incomplete. */
const readUtc = (dateId, timeId) => Date.parse(document.getElementById(dateId).value + 'T' + (document.getElementById(timeId).value || '00:00') + 'Z');
// No time span is set at the start: the clock runs on without end. It starts now when the Horizons table covers
// today (2027 to 2066), otherwise on 7 July 2028, so the page opens on Horizons data.
const HORIZONS_FROM = Date.UTC(2027, 0, 1), HORIZONS_TO = Date.UTC(2066, 0, 1), DEFAULT_START = Date.UTC(2028, 6, 7);
const SUN_AT = rad(206), EARTH_AT = rad(152);
/** The next UTC time (ms) from `from` on, within 32 days, at which the Earth stands EARTH_AT when the Sun stands SUN_AT; `from` if none. */
function sunLeftEarthRight(from) {
  const off = t => { const d = inertialSky(t), x = az(d.earth) - az(d.sun) - (EARTH_AT - SUN_AT); return Math.atan2(Math.sin(x), Math.cos(x)); };
  const STEP = 3600000;
  for (let a = from, fa = off(a); a < from + 32 * DAY_MS; ) {
    const b = a + STEP, fb = off(b);
    if (Math.abs(fa) < 1 && Math.abs(fb) < 1 && fa * fb <= 0) return fa === fb ? a : Math.round(a + STEP * fa / (fa - fb));
    a = b; fa = fb;
  }
  return from;
}
const startMs = readUtc('p-from', 'p-from-time') || sunLeftEarthRight(Date.now() >= HORIZONS_FROM && Date.now() < HORIZONS_TO ? Date.now() : DEFAULT_START);
pivot.rotation.set(.04, SUN_AT - az(inertialSky(startMs).sun), 0);
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
const skyBase = sky.quaternion.clone();           // catalogue (ICRS) -> star-fixed scene axes
let simMs = startMs;
// Time control (sidebar). With Start and Stop set, the clock plays exactly that span and repeats it:
// at Stop it jumps back to Start. With the span cleared it runs on without end from where it is.
let playing = !reduce.matches, stopMs = Infinity, loopMs = startMs, onClock = null;
let speed = 1;                                       // speed buttons: a factor on TIME_SCALE
let scrubbing = false;                               // the time bar is being dragged: the clock waits
/** Jump to a UTC time: bodies and paths follow at once. */
function setTime(ms) { simMs = ms; orbits.children.forEach(l => l.userData.retime(ms)); placeBodies(); onClock?.(); }
function setPlaying(on) { playing = on; onClock?.(); }
// The Moon is held still: it keeps the orientation it has at the start (HOLD). Everything else (Sun, Earth,
// paths, stars) is turned as one rigid sky by `held`, the rotation that undoes the Moon's own turn since then.
// Geometry between the bodies is unchanged; only the frame the scene is shown in is Moon-fixed.
const HOLD = inertialSky(startMs).moonToScene, held = new THREE.Quaternion(), tmpVec = new THREE.Vector3();
const turned = v => tmpVec.set(...v).applyQuaternion(held);
/** Azimuths (rad, about the scene's vertical axis, in the space that is dragged) of Sun and Earth at a UTC time, Moon held still. */
function azimuths(ms) {
  const d = inertialSky(ms), m = d.moonToScene;
  const T = HOLD.map(r => [0, 1, 2].map(k => r[0] * m[k][0] + r[1] * m[k][1] + r[2] * m[k][2]));
  const at = v => Math.atan2(T[0][0] * v[0] + T[0][1] * v[1] + T[0][2] * v[2], T[2][0] * v[0] + T[2][1] * v[1] + T[2][2] * v[2]);
  return { sun: at(d.sun), earth: at(d.earth) };
}
// Opening view of the system: the Sun 90 degrees to the right (terminator in the middle of the disc) and the
// Earth EARTH_OPEN further round, so it stands in the distance to the right of the Moon. That needs the right
// phase, so the clock runs forward to the next moment the Earth stands EARTH_OPEN from the Sun.
const EARTH_OPEN = rad(70);
/** The next UTC time (ms) from `from` on, before `end`, at which the Earth stands EARTH_OPEN round from the Sun; null if none. */
function openingTime(from, end) {
  const off = t => { const a = azimuths(t), x = a.earth - a.sun - EARTH_OPEN; return Math.atan2(Math.sin(x), Math.cos(x)); };
  const STEP = 3600000;
  for (let a = from, fa = off(a); a < Math.min(end, from + 32 * DAY_MS); ) {
    const b = a + STEP, fb = off(b);
    if (Math.abs(fa) < 1 && Math.abs(fb) < 1 && fa * fb <= 0) return fa === fb ? a : a + STEP * fa / (fa - fb);
    a = b; fa = fb;
  }
  return null;
}
const lastShadowSun = new THREE.Vector3(), earthTurn = new THREE.Quaternion(), sunInMoon = new THREE.Vector3(), moonInverse = new THREE.Quaternion();
function placeBodies() {
  const d = inertialSky(simMs), m = d.moonToScene;
  const T = HOLD.map(r => [0, 1, 2].map(k => r[0] * m[k][0] + r[1] * m[k][1] + r[2] * m[k][2]));   // HOLD x transpose(moonToScene)
  tmpMatrix.set(T[0][0], T[0][1], T[0][2], 0, T[1][0], T[1][1], T[1][2], 0, T[2][0], T[2][1], T[2][2], 0, 0, 0, 0, 1);
  held.setFromRotationMatrix(tmpMatrix);
  sunLight.position.copy(turned(d.sun)).multiplyScalar(SUN_LIGHT_DIST);
  // shadows on the Moon: redone when the Sun has moved by more than 0.05 deg against the lunar surface
  if (tmpVec.angleTo(lastShadowSun) > .05 * RAD) { lastShadowSun.copy(tmpVec); if (scope === 'system') renderer.shadowMap.needsUpdate = true; }
  orient(moon, HOLD);                 // the Moon stands still
  globe?.setSun(sunInMoon.copy(tmpVec).applyQuaternion(moonInverse.copy(moon.quaternion).invert()).normalize());   // for the skyline shadows
  orient(earthBall, d.earthToScene); earthBall.quaternion.premultiply(held);  // true axis, one turn per day
  earthDistKm = d.earthDistKm;
  if (scope === 'terrain') { earthBall.quaternion.premultiply(earthTurn); return; }   // Sun and Earth are with the terrain view, which places them
  sun.position.copy(turned(d.sun)).multiplyScalar(SUN_DIST);
  earth.position.copy(turned(d.earth)).multiplyScalar(d.earthDistKm * KM);
  orbits.quaternion.copy(held);
  sky.quaternion.copy(held).multiply(skyBase);
}
let earthDistKm = 384400;
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
// In the system view the camera can come down to the Moon: zoomK 0 = the whole system as after the opening
// move, 1 = NEAR_DISTANCE from the Moon's centre (280 km above the surface), -1 = FAR_FACTOR times further away than
// the system view (the Moon small in the middle, room for many info cards). Always Moon-centred.
// Ctrl + mouse wheel (or a pinch on a touchpad), + and - keys, "Explore".
const NEAR_DISTANCE = R * 1.16, FAR_FACTOR = 4, ZOOM_MIN = -1;
let zoomK = 0, zoomAnim = null;
const distanceFor = m => m < 1 ? closeDistance + (systemDistance - closeDistance) * m : zoomK < 0 ? systemDistance * Math.pow(FAR_FACTOR, -zoomK) : systemDistance * Math.pow(NEAR_DISTANCE / systemDistance, zoomK);
function setZoom(k) { zoomK = THREE.MathUtils.clamp(k, ZOOM_MIN, 1); zoomAnim = null; layout(); }
function animateZoom(to, ms = 1400) {
  if (reduce.matches) return setZoom(to);
  zoomAnim = { t0: performance.now(), ms, from: zoomK, to: THREE.MathUtils.clamp(to, ZOOM_MIN, 1) };
}
// The canvas always covers the whole window. When the sidebar is open the camera renders the scene into
// the remaining width through a view offset, so the drawing buffer is never resized during the slide
// (resizing clears it and made the view go black for a moment).
const sideEl = document.getElementById('params');
let sideNow = 0, bufW = 0, bufH = 0;
const moonDisc = { x: 0, y: 0, r: 0 };            // the Moon on screen, px relative to the hero (for the info cards)
function layout() {
  const w = world.clientWidth, h = world.clientHeight;
  if (w !== bufW || h !== bufH) { renderer.setSize(w, h, false); bufW = w; bufH = h; }
  const vw = Math.max(w - sideNow, 1);          // width left for the scene
  camera.aspect = vw / h;
  if (sideNow > 0) camera.setViewOffset(vw, h, -sideNow, 0, w, h); else camera.clearViewOffset();
  const k = 2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  // After the click: stay close, Moon diameter 46 % of the height (at most 66 % of the width).
  systemDistance = Math.max(2 * R / (.46 * k), 2 * R / (.66 * k * camera.aspect));
  // Start view: Moon diameter 56 % of the height, but never more than 78 % of the width.
  closeDistance = Math.max(2 * R / (.56 * k), 2 * R / (.78 * k * camera.aspect));
  restDistance = distanceFor(mix);
  if (!busy) camera.position.set(0, 0, restDistance);
  camera.updateProjectionMatrix();
  terrain?.resize(w, h, sideNow);
  const d = 2 * R / (k * restDistance) * h;   // projected diameter in px, for the keyboard target
  moonDisc.x = vw / 2; moonDisc.y = h / 2; moonDisc.r = d / 2;
  Object.assign(target.style, { left: (vw - d) / 2 + 'px', top: (h - d) / 2 + 'px', width: d + 'px', height: d + 'px' });
}
addEventListener('resize', layout);
layout();

// --- Interaction: drag to turn, click on the Moon to set a marker -----------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), hitLocal = new THREE.Vector3(), rayDir = new THREE.Vector3(), toLocal = new THREE.Matrix4();
const TILT = Math.PI / 2;                            // the space can be tilted until a pole faces the camera
function pointerNdc(e) {
  const r = canvas.getBoundingClientRect();
  return ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
}
/** The point of the Moon under the pointer as [lat, lon] in degrees (lon 0-360 E), or null beside the Moon. */
function moonPoint(e) {
  ray.setFromCamera(pointerNdc(e), camera);
  if (globe) {                                       // on the relief itself
    toLocal.copy(moon.matrixWorld).invert();
    hitLocal.copy(ray.ray.origin).applyMatrix4(toLocal); rayDir.copy(ray.ray.direction).transformDirection(toLocal);
    const hit = globe.raycast(hitLocal, rayDir);
    return hit ? [hit.lat, hit.lon] : null;
  }
  const hit = ray.intersectObject(moon)[0];
  if (!hit) return null;
  // sphere-local axes of the Moon mesh: x = lon 0, y = north, z = lon 90 W (same as place() in landing-pins.js)
  moon.worldToLocal(hitLocal.copy(hit.point)).normalize();
  const lat = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(hitLocal.y, -1, 1)));
  const lon = THREE.MathUtils.radToDeg(Math.atan2(-hitLocal.z, hitLocal.x));
  return [lat, ((lon % 360) + 360) % 360];
}
let dropPin = null;                                  // set by the sidebar block below: (lat, lon) => marker + Coordinates field
let drag = null, vy = 0, vx = 0, hoverEvent = null;
const OVERLAYS = 'a, .params, .pin, .card, .series, .tbar, .timebar, .legend, .offscreen';
hero.addEventListener('pointerdown', e => {
  if (busy || scope !== 'system' || e.target.closest(OVERLAYS)) return;         // drag anywhere turns the space
  drag = { x: e.clientX, y: e.clientY, moved: 0 };
  hero.setPointerCapture(e.pointerId); hero.classList.add('dragging'); hideReadout();
});
hero.addEventListener('pointermove', e => {
  if (scope !== 'system') return;
  if (!drag) {
    const over = !busy && expanded && !e.target.closest(OVERLAYS);
    hoverEvent = over ? e : null;                    // the values under the pointer are read once per frame (see frame)
    if (!over) hideReadout();
    hero.style.cursor = busy ? '' : hoverPoint ? 'crosshair' : 'grab';
    return;
  }
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
  const fine = THREE.MathUtils.clamp((restDistance - R) / (systemDistance - R), .04, 1);   // closer to the ground, slower turn
  vy = dx * .006 * fine; vx = dy * .006 * fine;
  pivot.rotation.y += vy;
  pivot.rotation.x = THREE.MathUtils.clamp(pivot.rotation.x + vx, -TILT, TILT);
});
hero.addEventListener('pointerleave', () => { hoverEvent = null; hideReadout(); });
// Ctrl + wheel: towards the Moon and back, the Moon stays in the middle. The wheel alone scrolls the page (and
// long cards) as on any page. Ctrl + wheel is the browser's page zoom otherwise; over the scene it is taken for this.
hero.addEventListener('wheel', e => {
  if (!e.ctrlKey || scope !== 'system') return;
  e.preventDefault();
  if (!expanded || busy || zoom) return;
  setZoom(zoomK - e.deltaY * (e.deltaMode === 1 ? .04 : .0012));
}, { passive: false });
/** Moon radius on screen (px) at a camera distance, and the zoom that gives a radius. */
const discRadius = dist => R / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * dist) * world.clientHeight;
function zoomForRadius(r) {
  const dist = discRadius(1) / r;
  return dist > systemDistance ? -Math.log(dist / systemDistance) / Math.log(FAR_FACTOR) : Math.log(dist / systemDistance) / Math.log(NEAR_DISTANCE / systemDistance);
}
let lastMoved = 0;
function release() {
  if (!drag) return;
  lastMoved = drag.moved; drag = null; hero.classList.remove('dragging');
}
hero.addEventListener('pointerup', release);
hero.addEventListener('pointercancel', release);
// First click anywhere: title away, zoom out to the whole system. After that a click on the Moon sets the
// marker there (same pin as typed coordinates). The globe page is reached through the links only.
function expand() {
  if (expanded || busy) return; expanded = true;
  document.body.classList.add('expanded');
  // The camera moves back and, in the same move, goes round the Moon to the right until it looks at the
  // terminator: night side on the left half of the disc, day side on the right (Sun 90 degrees to the right).
  // Dragging during the move takes over and the turn stops.
  // In the same move the clock runs forward (a short time-lapse) to the moment the Earth stands to the right
  // of the Moon in that view; from there it goes on as usual. No such moment inside the time span: no time-lapse.
  vy = vx = 0;
  const to = openingTime(simMs, stopMs);
  const y0 = pivot.rotation.y, want = Math.PI / 2 - azimuths(to ?? simMs).sun;
  let dy = (want - y0) % (2 * Math.PI); if (dy > 0) dy -= 2 * Math.PI;        // camera to the right = space to the left
  if (dy < -1.5 * Math.PI) dy += 2 * Math.PI;                                 // unless that is nearly a full turn
  if (reduce.matches) { pivot.rotation.y = y0 + dy; if (to) setTime(to); applyMix(1); layout(); return; }
  zoom = { t0: performance.now(), ms: to ? 3600 : 2600, y0, dy, from: simMs, to };
}
function applyMix(m) {
  mix = m;
  restDistance = distanceFor(m);
  camera.position.z = restDistance;
  orbits.children.forEach(l => { l.material.opacity = l.userData.opacity * m; });
  placeBodies();
}
applyMix(0); layout();
hero.addEventListener('click', e => {
  const moved = lastMoved; lastMoved = 0;
  if (busy || scope !== 'system' || moved >= 6 || e.target.closest(OVERLAYS)) return;
  if (!expanded) return expand();
  const c = moonPoint(e); if (c) dropPin?.(c[0], c[1]);
});

// "Explore": the system view, then down to the Moon. If the title is still up, the opening move runs first.
let exploreAfterOpening = false;
function explore() {
  if (scope === 'terrain') closeTerrain();
  scrollTo({ top: 0, behavior: reduce.matches ? 'auto' : 'smooth' });
  if (!expanded) { exploreAfterOpening = true; return expand(); }
  animateZoom(.7);
}
target.addEventListener('click', expand);
target.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); expand(); } });
document.querySelectorAll('[data-enter]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); explore(); }));
addEventListener('keydown', e => {
  if (scope !== 'system' || !expanded || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
  if (e.key === '+' || e.key === '=') setZoom(zoomK + .08); else if (e.key === '-') setZoom(zoomK - .08);
});

// Data behind the numbers. Each part arrives on its own and the page works with whatever is there:
//   sky      JPL Horizons table (core/sky.js); until it has loaded, and outside 2027-2066, the analytic model
//   globe    global height grid; gives every point a coarse horizon
//   terrain  blocks around single points: files for the listed sites, the local server for any point
// siteData (ui/site-data.js) knows the best ground for each marked point; dataVersion goes up whenever sky or
// ground changed, so cards and plot redo their numbers.
let skyVersion = 0;
const siteData = createSiteData({ source: null });
const dataVersion = () => siteData.version + skyVersion;
onSkyChange(() => { skyVersion++; setTime(simMs); });
loadHorizons().catch(err => console.warn('Horizons table not loaded, analytic sky model in use:', err.message));
new TerrainSource().init().then(src => siteData.setSource(src));
const globeReady = GlobeGrid.load().then(g => { siteData.setGlobe(g); return g; });
globeReady.catch(err => console.warn('Global height grid not loaded:', err.message));
// The span the numbers cover: Start to Stop of the sidebar, or two lunar days from the simulated time (paged on by
// one with the clock). One window for the cards and the plot.
// The two limits are judged over their own window (limitWindow): Start to Stop as well, but with no span set the
// 24 hours from the simulated time (to the hour). Info cards and the area on the Moon (landing-area.js) share it.
let spanAnchor = null, spanWindow = null, limitWindow = null;
function updateWindow() {
  const fixed = stopMs < Infinity;
  spanWindow = windowFor(fixed ? [loopMs, stopMs] : null, simMs, spanAnchor); spanAnchor = spanWindow.anchor; spanWindow.free = !fixed;
  const a = fixed ? loopMs : Math.floor(simMs / 3600000) * 3600000, b = fixed ? stopMs : a + 24 * 3600000;
  if (!limitWindow || limitWindow.a !== a || limitWindow.b !== b) limitWindow = { a, b, free: !fixed };
}
updateWindow();
// A slider at its right end (one step past LIMIT_MAX_H) is off: no limit. Both start there.
const limitInputs = { dark: document.getElementById('p-dark'), dte: document.getElementById('p-dte') };
const limitOf = input => +input.value > LIMIT_MAX_H ? null : +input.value;
const limits = () => ({ dark: limitOf(limitInputs.dark), dte: limitOf(limitInputs.dte) });
const area = createArea({ window: () => limitWindow, limits, skyVersion: () => skyVersion, note: document.getElementById('p-area-note'),
  apply: (mask, w, h) => globe?.setArea(mask, w, h) });

// Landing-site pins (landing-pins.js): an HTML layer over the canvas, switched by "historical" in the sidebar.
const pins = createPins({ root: document.getElementById('pins'), hero, moon, pivot, camera, R });
// Info cards (landing-cards.js): a click on a marker opens a card with Sun and Earth at that site for the simulated time.
// Time series (landing-series.js): solar elevation of the marked points over the time span. Shown only through
// "Solar Elevation" in the header (off at the start); opening a point's details does not bring it up.
const series = createSeries({ hero, marked: () => pins.marked(), now: () => simMs, window: () => spanWindow,
  setTime: ms => setTime(ms), onClose: () => showSeries(false),
  ground: s => siteData.get(s), groundVersion: dataVersion });
// Where the Sun and the Earth are while they are outside the picture: a small label at the edge of the scene, on the
// line from the middle of the scene towards the body, with an arrow in that direction. System view and terrain view.
// The label is a button: a click turns the view until that body is in the picture (lookAtBody).
const ARROW_SVG = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 7h10M8 3l4 4-4 4"/></svg>';
const pointers = [[sun, 'Sun'], [earth, 'Earth']].map(([obj, name]) => {
  const el = document.createElement('button'); el.type = 'button'; el.className = 'offscreen'; el.hidden = true;
  el.setAttribute('aria-label', 'Turn the view to the ' + name); el.title = 'Turn the view to the ' + name;
  el.innerHTML = ARROW_SVG + '<span>' + name + '</span>'; hero.append(el);
  el.addEventListener('click', () => lookAtBody(obj));
  return { obj, el, arrow: el.firstChild, w: 0, h: 0 };
});
const ptWorld = new THREE.Vector3(), ptCam = new THREE.Vector3();
// Turn the view to a body. System view: the space turns until the body stands beside the Moon as seen from the
// camera (behind it and a little to the side, on the side that is the shorter way), tilted so that it is level
// with the Moon. Terrain view: the camera goes round the point until it looks towards the body, and down towards
// the ground so that a body near the horizon comes into the picture; a body high in the sky stays above it.
const lookV = new THREE.Vector3(), lookS = new THREE.Spherical();
let terrainTurn = null;
const shortWay = a => Math.atan2(Math.sin(a), Math.cos(a));
function lookAtBody(obj) {
  if (busy || zoom) return;
  if (scope === 'terrain') {
    const cam = terrain.camera, c = terrain.controls;
    obj.getWorldPosition(lookV).sub(c.target);
    const el = Math.asin(THREE.MathUtils.clamp(lookV.y / (lookV.length() || 1), -1, 1)), th1 = Math.atan2(-lookV.x, -lookV.z);
    lookS.setFromVector3(lookV.copy(cam.position).sub(c.target));
    const dep = Math.max(.01, cam.fov * Math.PI / 360 * .6 - el);                 // how far below level the camera may look
    const ph1 = Math.min(Math.max(lookS.phi, Math.PI / 2 - dep), c.maxPolarAngle);
    terrainTurn = { t0: performance.now(), ms: reduce.matches ? 0 : 700, th0: lookS.theta, dth: shortWay(th1 - lookS.theta), ph0: lookS.phi, dph: ph1 - lookS.phi, r: lookS.radius };
    return;
  }
  if (scope !== 'system') return;
  vy = vx = 0;
  pivot.worldToLocal(obj.getWorldPosition(lookV));
  const a = Math.atan2(lookV.x, lookV.z), lat = Math.atan2(lookV.y, Math.hypot(lookV.x, lookV.z));
  const hHalf = Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect), moonAng = Math.asin(Math.min(1, R / camera.position.z));
  const tight = zoomK > 0 && moonAng * 1.3 > hHalf * .8;                        // so close that the Moon would cover the body: back to the whole system
  if (tight) animateZoom(0, 700);
  const off = Math.min(Math.max((tight ? Math.asin(Math.min(1, R / systemDistance)) : moonAng) * 1.5, hHalf * .45), hHalf * .8);   // beside the Moon, inside the picture
  const y = pivot.rotation.y, d1 = shortWay(Math.PI + off - a - y), d2 = shortWay(Math.PI - off - a - y);
  pins.turnTo(-lat, y + (Math.abs(d1) <= Math.abs(d2) ? d1 : d2));
}
hero.addEventListener('pointerdown', () => { terrainTurn = null; }, true);          // dragging takes over from a running turn
function pointToBodies() {
  const show = (expanded || scope === 'terrain') && !zoom && !busy, cam = scope === 'terrain' ? terrain.camera : camera;
  const L = sideNow, Rt = bufW, cx = (L + Rt) / 2, cy = bufH / 2;
  for (const p of pointers) {
    let off = false, dx = 0, dy = -1;
    if (show) {
      p.obj.getWorldPosition(ptWorld); ptCam.copy(ptWorld).applyMatrix4(cam.matrixWorldInverse); ptWorld.project(cam);
      const x = (ptWorld.x + 1) / 2 * bufW, y = (1 - ptWorld.y) / 2 * bufH, front = ptCam.z < 0;
      off = !front || x < L || x > Rt || y < 0 || y > bufH;
      if (front) { dx = x - cx; dy = y - cy; } else if (ptCam.x || ptCam.y) { dx = ptCam.x; dy = -ptCam.y; }   // behind the camera: the side it is on
    }
    if (p.el.hidden === off) { p.el.hidden = !off; if (off) { p.w = p.el.offsetWidth; p.h = p.el.offsetHeight; } }
    if (!off) continue;
    const n = Math.hypot(dx, dy) || 1; dx /= n; dy /= n;
    // the label's centre stays inside this box: clear of the sidebar and its tab, the header and the time bar
    const x0 = L + 80 + p.w / 2, x1 = Rt - 16 - p.w / 2, y0 = 93 + p.h / 2, y1 = bufH - 200 - p.h / 2;
    const my = (y0 + y1) / 2;
    const t = Math.min(dx > 0 ? (x1 - cx) / dx : dx < 0 ? (x0 - cx) / dx : Infinity, dy > 0 ? (y1 - my) / dy : dy < 0 ? (y0 - my) / dy : Infinity);
    p.el.style.transform = 'translate(' + Math.round(cx + dx * t - p.w / 2) + 'px,' + Math.round(my + dy * t - p.h / 2) + 'px)';
    p.arrow.style.transform = 'rotate(' + (Math.atan2(dy, dx) * 180 / Math.PI).toFixed(0) + 'deg)';
  }
}
// Panels the info cards keep clear of, as rectangles in hero px (null while a panel is not shown)
const timebarEl = document.getElementById('timebar'), legendBox = document.getElementById('legend');
function panelRect(el) {
  if (!el || el.hidden || !el.offsetWidth) return null;
  const r = el.getBoundingClientRect(), h = hero.getBoundingClientRect();
  return { x: r.left - h.left, y: r.top - h.top, w: r.width, h: r.height };
}
let cardCount = 0, cardDiscR = 0;                 // for the zoom that makes room for the cards (render loop)
const seriesToggle = document.getElementById('series-toggle');
function showSeries(on) { series.show(on); seriesToggle.setAttribute('aria-pressed', on); }
seriesToggle.addEventListener('click', e => { e.preventDefault(); showSeries(seriesToggle.getAttribute('aria-pressed') !== 'true'); if (!expanded) expand(); });
seriesToggle.addEventListener('keydown', e => { if (e.key === ' ') { e.preventDefault(); seriesToggle.click(); } });
// Sky view (landing-sky.js): horizon, Sun and Earth of one marked point, through "Sky view" in the header.
const skyToggle = document.getElementById('sky-toggle');
function showSky(on) { skyView.show(on); skyToggle.setAttribute('aria-pressed', on); }
const skyView = createSky({ hero, marked: () => pins.marked(), picked: () => pins.picked, now: () => simMs, window: () => spanWindow, onClose: () => showSky(false),
  ground: s => siteData.get(s, true), groundVersion: dataVersion, other: () => series.rect(), closeOther: () => showSeries(false) });
skyToggle.addEventListener('click', e => { e.preventDefault(); showSky(skyToggle.getAttribute('aria-pressed') !== 'true'); if (!expanded) expand(); });
skyToggle.addEventListener('keydown', e => { if (e.key === ' ') { e.preventDefault(); skyToggle.click(); } });
const cards = createCards({ hero, pins, now: () => simMs, disc: () => moonDisc, avoid: () => [series.rect(), skyView.rect(), panelRect(timebarEl), panelRect(legendBox)],
  ground: s => siteData.get(s, true), groundVersion: dataVersion, window: () => limitWindow, limits, onTerrain: s => openTerrain(s) });

// --- Lunar surface: relief mesh, surface modes, layers, legend ---------------------------
// "Surface" of the sidebar chooses what the ground shows; the layers lie over it. The same choice holds in
// the terrain view, where the colour-coded global grids (sunlight, Earth) have no counterpart and relief is shown.
const surfaceSelect = document.getElementById('p-surface'), surfaceNote = document.getElementById('p-surface-note');
let detailNote = '';                                  // says so when the lighter mesh was asked for
let surfaceMode = 'relief', globeGrid = null;
const layerOn = { graticule: false, contours: true, squares: false };
const SURFACES = {                                    // the colour-coded surfaces and what their legend says
  elevation: { title: 'Elevation', unit: 'm above the 1737.4 km sphere', stops: VIRIDIS },
  sunlight: { title: 'Mean sunlight', unit: '% of the Sun’s disc in view', stops: SUNLIGHT },
  earth: { title: 'Earth in view', unit: '% of the Earth’s disc in view', stops: EARTHVIEW },
};
const valueLayers = {};                               // name -> { values, width, height, note } of data/exposure/
// Shadows on the Moon: the skyline map (tools/build_horizon.mjs). Until it has loaded, or without the file, the
// shadow map of the Sun's light is used as before.
let horizonMap = null;
fetch('data/globe/horizon_720x360x24.json').then(r => r.ok ? r.json() : Promise.reject()).then(async meta => {
  const buf = await fetch('data/globe/' + meta.file).then(r => r.ok ? r.arrayBuffer() : Promise.reject());
  if (buf.byteLength !== meta.width * meta.height * meta.azimuths) return;
  horizonMap = { bytes: new Uint8Array(buf), meta };
  area.setSkyline(horizonMap.bytes, meta);
  if (globe) { globe.setHorizon(horizonMap.bytes, meta); sunLight.castShadow = false; placeBodies(); }
}).catch(() => console.warn('Skyline map not loaded: the Moon keeps the shadow map.'));
function buildGlobe(detail) {
  if (globe) { globe.group.removeFromParent(); globe.dispose(); }
  globe = createMoonGlobe({ grid: globeGrid, radius: R, albedo, detail });
  for (const [name, L] of Object.entries(valueLayers)) globe.setValues(name, L.values, L.width, L.height, SURFACES[name].stops);
  moon.add(globe.group); material.visible = false;
  if (horizonMap) globe.setHorizon(horizonMap.bytes, horizonMap.meta);
  sunLight.castShadow = !globe.hasHorizon; placeBodies();
  area.refresh();
  const size = detail === 1 ? 4096 : 2048;
  if (sunLight.shadow.mapSize.x !== size) { sunLight.shadow.mapSize.set(size, size); sunLight.shadow.map?.dispose(); sunLight.shadow.map = null; }
  applySurface();
}
// ?detail=light in the address starts with the lighter mesh (weak graphics hardware, software rendering).
const startLight = new URLSearchParams(location.search).get('detail') === 'light';
globeReady.then(grid => { globeGrid = grid; buildGlobe(startLight ? 2 : 1); }, () => {}).finally(done);
// Colour-coded global grids (tools/build_exposure.py). Optional: without the files their two entries stay switched off.
fetch('data/exposure/index.json').then(r => r.ok ? r.json() : Promise.reject()).then(index => Promise.all(index.layers.map(async L => {
  const buf = await fetch('data/exposure/' + L.file).then(r => r.ok ? r.arrayBuffer() : Promise.reject());
  if (buf.byteLength !== L.width * L.height || !SURFACES[L.name]) return;
  const v = new Float32Array(L.width * L.height), u = new Uint8Array(buf);
  for (let i = 0; i < v.length; i++) v[i] = u[i] / 255;
  valueLayers[L.name] = { values: v, width: L.width, height: L.height, note: L.note || '' };
  globe?.setValues(L.name, v, L.width, L.height, SURFACES[L.name].stops);
  const opt = surfaceSelect.querySelector('option[value="' + L.name + '"]'); if (opt) opt.disabled = false;
}))).catch(() => {});

// Mean sunlight and Earth in view in the terrain view (landing-exposure.js): per point of the open ground, over the
// span of the time bar. Asked for while one of the two is chosen there; redone when the span or the ground changes.
const isMean = m => m === 'sunlight' || m === 'earth';
const exposure = createExposure({ window: () => spanWindow, skyVersion: () => skyVersion });
let exposureShown = null, exposureNote = '';
function terrainExposure() {
  if (scope !== 'terrain' || !isMean(surfaceMode) || !terrain.block) return;
  const g = exposure.update(terrain.block);
  if (g && (g !== exposureShown || !terrain.hasLayer('sunlight'))) {      // new numbers, or the same ground opened again
    exposureShown = g;
    terrain.setValues('sunlight', g.sun, g.n, SURFACES.sunlight.stops); terrain.setValues('earth', g.earth, g.n, SURFACES.earth.stops);
    applySurface();
  } else if (!g || terrain.mode !== surfaceMode) {
    const t = exposure.progress().toFixed(2); if (t !== exposureNote) { exposureNote = t; applySurface(); }      // the line under "Surface" follows the calculation
  }
}
function applySurface() {
  const inTerrain = scope === 'terrain';
  const shown = globe ? globe.setMode(surfaceMode) : 'relief';
  if (globe) { globe.setGraticule(layerOn.graticule); globe.setSquares(layerOn.squares); globe.setContours(layerOn.contours); }
  const tShown = terrain.setMode(surfaceMode); terrain.setContours(layerOn.contours);
  renderer.shadowMap.needsUpdate = true;
  // In the terrain view the two mean surfaces are worked out for the ground that is open (terrainExposure below);
  // until they are there the ground shows relief and this line says how far the calculation is.
  surfaceNote.textContent = inTerrain && isMean(surfaceMode) ? (tShown === surfaceMode ? '' : 'Calculating ' + SURFACES[surfaceMode].title.toLowerCase() + ' for this ground' + (exposure.progress() > 0 ? ', ' + Math.round(exposure.progress() * 100) + ' %' : '') + ' …')
    : !globe && surfaceMode !== 'relief' ? 'Needs the global height grid, which has not loaded.'
    : shown !== surfaceMode ? 'Not available: the data for this surface has not loaded.' : detailNote;
  updateLegend();
}
const legendEl = document.getElementById('legend'), legendTitle = document.getElementById('legend-title'), legendBar = document.getElementById('legend-bar'),
  legendTicks = document.getElementById('legend-ticks'), legendNote = document.getElementById('legend-note');
const thousands = v => (v < 0 ? '−' : '') + Math.abs(Math.round(v)).toLocaleString('en-US').replace(/,/g, ' ');
function updateLegend() {
  const inTerrain = scope === 'terrain', mode = inTerrain ? terrain.mode : globe ? globe.mode : 'relief';
  const L = SURFACES[mode];
  legendEl.hidden = !L || !expanded;
  if (!L) return;
  legendBar.style.background = cssGradient(L.stops);
  let ticks;
  if (mode === 'elevation') {
    const { minM, maxM } = inTerrain ? terrain.range : globe.range, span = maxM - minM;
    const step = [50, 100, 200, 500, 1000, 2000, 5000].find(st => span / st <= 4) ?? 10000;
    ticks = [[0, thousands(minM)]];
    for (let v = Math.ceil(minM / step) * step; v <= maxM; v += step) { const f = (v - minM) / span; if (f > .2 && f < .8) ticks.push([f, thousands(v)]); }
    ticks.push([1, thousands(maxM)]);
    const ground = inTerrain ? (terrain.block.coarse ? 'global grid, 7.6 km cells' : 'LOLA LDEM64') + ', the drawn square' : 'LOLA LDEM64, 7.6 km cells';
    legendNote.textContent = ground + (layerOn.contours ? '; contour lines every ' + (inTerrain ? '250 m' : '1 km') : '') + '.';
  } else if (inTerrain) {
    // the scale runs between the lowest and the highest value on this ground, so differences inside the square show
    const { lo, hi } = terrain.valueRange(mode), g = exposureShown, digits = hi - lo < .1 ? 1 : 0, stamp = ms => new Date(ms).toISOString().slice(0, 10);
    ticks = [0, .25, .5, .75, 1].map(f => [f, ((lo + f * (hi - lo)) * 100).toFixed(digits)]);
    legendNote.textContent = 'Mean over ' + stamp(g.a) + ' to ' + stamp(g.b) + ' UTC' + (g.free ? ' (two lunar days)' : '')
      + '. Each point against its own skyline, ' + (terrain.block.coarse ? 'global grid, 7.6 km cells' : 'LOLA LDEM64') + ', points 1.6 km apart.';
  } else {
    ticks = [0, .25, .5, .75, 1].map(f => [f, String(Math.round(f * 100))]);
    legendNote.textContent = valueLayers[mode]?.note || '';
  }
  legendTitle.textContent = L.title + ', ' + L.unit;
  legendTicks.replaceChildren(...ticks.map(([f, text]) => { const e = document.createElement('span'); e.style.left = f * 100 + '%'; e.textContent = text; return e; }));
}

// The Moon is always drawn with the full mesh and the 4096 shadow map. The lighter mesh exists only on request
// (?detail=light in the address); the page never switches to it by itself.
if (startLight) detailNote = 'Moon drawn with the lighter mesh (?detail=light in the address).';

// --- Values under the pointer ------------------------------------------------------------
const readoutEl = document.getElementById('readout');
let hoverPoint = null, readoutKey = '';
const signed = (d, n = 1) => (d < 0 ? '−' : '+') + Math.abs(d).toFixed(n) + '°';
function showReadout(e, lines) {
  const html = lines.join('<br>');
  if (html !== readoutKey) { readoutKey = html; readoutEl.innerHTML = html; }
  readoutEl.hidden = false;
  const h = hero.getBoundingClientRect(), w = readoutEl.offsetWidth, ht = readoutEl.offsetHeight;
  const x = Math.min(e.clientX - h.left + 18, h.width - w - 8), y = Math.min(e.clientY - h.top + 18, h.height - ht - 8);
  readoutEl.style.transform = 'translate(' + Math.round(Math.max(8, x)) + 'px,' + Math.round(Math.max(8, y)) + 'px)';
}
function hideReadout() { readoutEl.hidden = true; hoverPoint = null; if (layerOn.squares) globe?.markSquare(-1); terrain?.hideCursor(); }
/** System view: coordinates and height of the point under the pointer, and what the current surface says there. */
function systemReadout(e) {
  hoverEvent = null;
  const c = moonPoint(e);
  hoverPoint = c;
  if (!c) return hideReadout();
  const [lat, lon] = c, lines = ['<b>' + coordLabel(lat, lon, 3) + '</b>'], mode = globe ? globe.mode : 'relief';
  if (globeGrid) {
    const z = globeGrid.elevation(lat, lon);
    lines.push('Elevation ' + thousands(z) + ' m <span>(7.6 km cells)</span>');
    if (mode === 'sunlight' || mode === 'earth') lines.push(SURFACES[mode].title + ' ' + (globe.valueAt(mode, lat, lon) * 100).toFixed(0) + ' %');
    else {
      const sun = siteState(simMs, makeSite(lat, lon, z), tState).sun, frac = discFraction(sun.el - skylineFromGlobe(globeGrid, lat, lon, sun.az), SUN_RADIUS_DEG);
      lines.push('Sun ' + signed(sun.el) + ', ' + Math.round(frac * 100) + ' % of its disc in view');
    }
    const lim = area.at(lat, lon);                      // the cell's numbers behind the marked area
    if (lim) { const h = v => v === Infinity ? 'over ' + LIMIT_MAX_H + ' h' : v.toFixed(1) + ' h';
      lines.push([lim.sun != null && 'Longest darkness ' + h(lim.sun), lim.earth != null && 'Longest DTE outage ' + h(lim.earth)].filter(Boolean).join(', ') + ' <span>(' + (lim.free ? 'next 24 h' : 'time span') + ', 0.5° cell)</span>'); }
    if (layerOn.squares) { const i = globe.squareAt(lat, lon); globe.markSquare(i); lines.push(i >= 0 ? 'Square ' + globe.squares[i].label : 'In no square'); }
  }
  showReadout(e, lines);
}

// --- Terrain view ------------------------------------------------------------------------
// "View terrain" on an info card: the ground around that point. The block is loaded (ui/site-data.js: full
// resolution where a source has it, otherwise from the global grid), the scene is built, then the view changes
// under a short dip to black. Clock, sidebar, plot and the point's card stay; "Back to the Moon" returns.
const tInput = document.getElementById('t-input'), tBar = document.getElementById('t-bar'), tName = document.getElementById('t-name'), tMeta = document.getElementById('t-meta');
const loadingEl = document.getElementById('loading'), loadingText = document.getElementById('loading-text'), loadingFill = document.getElementById('loading-fill');
terrain = createTerrainView({ renderer, input: tInput });
let terrainSite = null, terrainCalc = null, opening = false, creep = 0, zoomBefore = 0;
function progress(f, text) { loadingEl.hidden = false; if (text) loadingText.textContent = text; loadingFill.style.width = Math.round(f * 100) + '%'; }
const wait = ms => new Promise(r => setTimeout(r, ms));
async function openTerrain(site) {
  if (opening || scope !== 'system') return;
  opening = true; hideReadout();
  const how = siteData.availability(site);
  progress(.02, how === 'server' ? 'Cutting the ground out of LOLA LDEM64' : 'Loading terrain');
  // the server gives no progress while it reads the raster: the bar creeps towards a third meanwhile
  const t0 = performance.now(); clearInterval(creep);
  creep = setInterval(() => progress(.02 + .3 * (1 - Math.exp(-(performance.now() - t0) / 2500))), 100);
  pins.face(site); zoomBefore = zoomK; animateZoom(Math.max(zoomK, .85), 1200);     // the site turns to the camera and comes closer meanwhile
  try {
    const block = await siteData.loadBlock(site, (stage, f) => { if (stage === 'download') { clearInterval(creep); progress(.34 + .16 * f, 'Receiving terrain'); } });
    clearInterval(creep);
    await terrain.load(block, (f, text) => progress(.5 + .5 * f, text));
    world.classList.add('veil'); await wait(reduce.matches ? 0 : 320);
    enterTerrain(site, block);
    world.classList.remove('veil');
  } catch (err) {
    clearInterval(creep);
    console.warn('Terrain view not opened:', err.message);
    progress(0, 'Terrain could not be loaded: ' + err.message); await wait(2600);
    setZoom(zoomBefore);
  }
  loadingEl.hidden = true; opening = false;
}
// Paths across the site's sky, for the terrain view: the Sun over one lunar day and the Earth over one sidereal
// month, both centred on the simulated time. Redone when the clock has moved a day away from that centre.
const LUNAR_DAY_MS = 29.530589 * DAY_MS;
let pathsAt = NaN;
function terrainPaths() {
  if (Math.abs(simMs - pathsAt) < DAY_MS) return;
  pathsAt = simMs;
  const st = { sun: {}, earth: {} }, sunP = [], earthP = [];
  for (let i = 0; i <= 360; i++) {
    sunP.push(enu(siteState(simMs + (i / 360 - .5) * LUNAR_DAY_MS, terrainCalc, st).sun));
    earthP.push(enu(siteState(simMs + (i / 360 - .5) * SIDEREAL_DAYS * DAY_MS, terrainCalc, st).earth));
  }
  terrain.setPaths(sunP, earthP);
}
function enterTerrain(site, block) {
  scope = 'terrain'; terrainSite = site; terrainCalc = siteData.get(site).site;
  document.body.classList.add('terrain');
  drag = null; hero.classList.remove('dragging'); vx = vy = 0;
  // the site's axes in the space of the system view, to carry the turning Earth over (see placeBodies)
  const b = basisAt(block.lat, block.lon), q = moon.quaternion, ax = v => new THREE.Vector3(...bodyToThree(v)).applyQuaternion(q);
  const E = ax(b.east), U = ax(b.up), N = ax(b.north);
  tmpMatrix.set(E.x, E.y, E.z, 0, U.x, U.y, U.z, 0, -N.x, -N.y, -N.z, 0, 0, 0, 0, 1);
  earthTurn.setFromRotationMatrix(tmpMatrix);
  // Sun and Earth go with the view, at the angular sizes they have in the system view
  terrain.adopt(sun, earth, terrain.skyDistance / SUN_DIST, terrain.skyDistance / (earthDistKm * KM));
  placeBodies(); pathsAt = NaN;
  terrain.controls.enabled = true; tInput.hidden = false; tBar.hidden = false;
  tName.textContent = site.name;
  const g = siteData.get(site);
  tMeta.textContent = block.visibleKm + ' \u00d7 ' + block.visibleKm + ' km around ' + coordLabel(site.lat, site.lon, 3) + ', true height scale. '
    + (block.coarse ? 'Coarse ground from the global grid, 7.6 km cells' + (g.error ? ' (' + g.error + ')' : siteData.availability(site) ? '' : '; full resolution needs the local server, start.bat') + '.'
      : 'Ground: ' + basisLabel('block', block.sourceCellM) + '.');
  if (!cards.has(site.id)) pins.onOpen?.(site);
  cards.dock(site.id, tBar.offsetTop + tBar.offsetHeight + 12);
  applySurface(); layout();
}
function closeTerrain() {
  if (scope !== 'terrain') return;
  scope = 'system'; terrainSite = null;
  document.body.classList.remove('terrain');
  terrain.controls.enabled = false; tInput.hidden = true; tBar.hidden = true; hideReadout();
  terrain.release(pivot);
  cards.dock(null);
  setZoom(zoomBefore); placeBodies(); applySurface();
  renderer.shadowMap.needsUpdate = true;
}
document.getElementById('t-back').addEventListener('click', closeTerrain);
// values of the ground point under the pointer
let tHover = null, tDown = false;
// Pointer over the ground: the ring on the terrain marks the point and the mouse pointer is hidden. Pressed: the
// ring goes and the grabbing hand shows while the view is turned.
tInput.addEventListener('pointerdown', () => { tDown = true; tInput.classList.remove('on-ground'); hideReadout(); });
addEventListener('pointerup', () => { tDown = false; });
tInput.addEventListener('pointerleave', () => { tHover = null; tInput.classList.remove('on-ground'); hideReadout(); });
tInput.addEventListener('pointermove', e => {
  if (tDown) return;
  if (!tHover) requestAnimationFrame(() => {
    const ev = tHover; tHover = null;
    if (!ev || scope !== 'terrain') return;
    const p = terrain.pick(pointerNdc(ev).x, ndc.y);
    tInput.classList.toggle('on-ground', !!p && !tDown);
    if (!p) return hideReadout();
    showReadout(ev, ['<b>' + coordLabel(p.lat, p.lon) + '</b>',
      'Elevation ' + thousands(p.elevM) + ' m, slope ' + p.slopeDeg.toFixed(1) + '°',
      'Sun ' + signed(p.sunElevDeg) + ', horizon below it ' + signed(p.horizonDeg) + ', ' + Math.round(p.discFrac * 100) + ' % of its disc in view',
      ...(isMean(terrain.mode) ? [SURFACES[terrain.mode].title + ' ' + (terrain.valueAt(terrain.mode, p.xKm, p.yKm) * 100).toFixed(1) + ' % <span>(mean over the time span)</span>'] : []),
      'On this slope ' + Math.round(p.fluxWm2) + ' W/m² <span>(incidence ' + p.incidenceDeg.toFixed(0) + '°, 1361 W/m² at 1 au)</span>']);
  });
  tHover = e;
});
// Backspace = undo: removes the marker set last (and its card). Not while typing in a field.
addEventListener('keydown', e => {
  if (e.key !== 'Backspace' || scope !== 'system' || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
  if (pins.undo()) e.preventDefault();
});

// --- Loop -------------------------------------------------------------------
let last = performance.now();
const tState = { sun: {}, earth: {} };
const enu = b => { const a = b.az * RAD, e = b.el * RAD, c = Math.cos(e); return [c * Math.sin(a), c * Math.cos(a), Math.sin(e)]; };
function frame(now) {
  requestAnimationFrame(frame);
  const real = (now - last) / 1000, dt = Math.min(real, .05); last = now;
  if (scrollY > innerHeight) return;                      // hero is off screen
  if (!drag) {
    pivot.rotation.y += vy; pivot.rotation.x = THREE.MathUtils.clamp(pivot.rotation.x + vx, -TILT, TILT);
    vy *= .94; vx *= .94;
  }
  if (playing && !zoom?.to && !scrubbing) {
    simMs += dt * 1000 * TIME_SCALE * speed;              // the one clock for every motion
    if (simMs >= stopMs) setTime(loopMs); else { placeBodies(); onClock?.(); }
  }
  sunUniforms.uTime.value += dt;
  const side = sideEl.getBoundingClientRect().width;      // follows the sidebar's slide and drag frame by frame
  if (Math.abs(side - sideNow) > .25) { sideNow = side; layout(); }
  if (zoom) {
    const p = Math.min((now - zoom.t0) / zoom.ms, 1);
    const e = p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    if (zoom.to) { simMs = zoom.from + (zoom.to - zoom.from) * e; onClock?.(); if (p === 1) setTime(zoom.to); }
    applyMix(e);
    if (drag) zoom.dy = 0; else if (zoom.dy) pivot.rotation.y = zoom.y0 + zoom.dy * e;
    if (p === 1) { zoom = null; layout(); updateLegend(); if (exploreAfterOpening) { exploreAfterOpening = false; animateZoom(.7); } }
  }
  if (zoomAnim) {
    const p = Math.min((now - zoomAnim.t0) / zoomAnim.ms, 1), e = p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2, a = zoomAnim;
    zoomK = a.from + (a.to - a.from) * e; if (p === 1) zoomAnim = null;
    layout();
  }
  updateWindow();
  area.update(); terrainExposure();
  pins.update(bufW, bufH);
  pointToBodies();
  cards.update();
  // Info cards and zoom: a card more than before and they no longer stand free of each other -> zoom out as far as
  // needed (never in). While the Moon changes size on screen the cards that were not moved by hand follow it.
  if (scope === 'system' && expanded && !zoom) {
    const n = cards.count();
    if (n <= cardCount) cardCount = n;
    else if (!zoomAnim) { cardCount = n; const r = cards.fit(discRadius(systemDistance * FAR_FACTOR)); if (r) animateZoom(Math.min(zoomK, zoomForRadius(r)), 900); }
    if (Math.abs(moonDisc.r - cardDiscR) > .5) { cardDiscR = moonDisc.r; cards.relayout(); }
  }
  series.update();
  skyView.update();
  if (scope === 'terrain') {
    // Sun and Earth as the site sees them; light and shadows of the ground follow
    const st = siteState(simMs, terrainCalc, tState);
    terrain.setSky(enu(st.sun), enu(st.earth)); terrainPaths();
    if (terrainTurn) {
      const t = terrainTurn, p = t.ms ? Math.min((now - t.t0) / t.ms, 1) : 1, e = 1 - Math.pow(1 - p, 3);
      lookV.setFromSpherical(lookS.set(t.r, t.ph0 + t.dph * e, t.th0 + t.dth * e));
      terrain.camera.position.copy(terrain.controls.target).add(lookV);
      if (p === 1) terrainTurn = null;
    }
    terrain.render();
  } else {
    if (hoverEvent) systemReadout(hoverEvent);
    renderer.render(scene, camera);
  }
}
requestAnimationFrame(frame);

// Parameter drawer (left edge): the tab folds the panel in and out, each row switches one layer.
{ const box = document.getElementById('params'), tab = document.getElementById('params-tab');
  const layers = {
    sunPath: on => { orbits.children[0].visible = on; },
    earthOrbit: on => { orbits.children[1].visible = on; },
    stars: on => { sky.visible = on; },
    historical: on => pins.show(on),
    orbits: on => { orbits.visible = on; terrain.showPaths(on); },              // both paths: the Sun's yearly path and the Earth's orbit
    graticule: on => { layerOn.graticule = on; applySurface(); },
    contours: on => { layerOn.contours = on; applySurface(); },
    squares: on => { layerOn.squares = on; if (!on) globe?.markSquare(-1); applySurface(); },
  };
  surfaceSelect.addEventListener('change', () => { surfaceMode = surfaceSelect.value; applySurface(); });
  // Opening the sidebar narrows the 3D view to the remaining width; the render loop follows its width.
  tab.addEventListener('click', () => { const open = box.classList.toggle('open'); document.body.classList.toggle('side-open', open); tab.setAttribute('aria-expanded', open); });
  // Drag the sidebar edge (or use the arrow keys on it) to set its width.
  const grip = document.getElementById('params-grip');
  const setWidth = w => document.body.style.setProperty('--side-w', Math.round(Math.max(300, Math.min(w, 560, innerWidth * .6))) + 'px');
  grip.addEventListener('pointerdown', e => { e.preventDefault(); grip.setPointerCapture(e.pointerId); document.body.classList.add('side-drag'); });
  grip.addEventListener('pointermove', e => { if (document.body.classList.contains('side-drag')) setWidth(e.clientX); });
  const endDrag = () => document.body.classList.remove('side-drag');
  grip.addEventListener('pointerup', endDrag); grip.addEventListener('pointercancel', endDrag);
  grip.addEventListener('keydown', e => { const d = { ArrowLeft: -16, ArrowRight: 16 }[e.key]; if (d) { e.preventDefault(); setWidth(box.offsetWidth + d); } });
  // Landing site: one field that takes any pasted pair and writes it back as "lat, lon" (lon 0-360 E).
  const coord = document.getElementById('p-coord'), help = document.getElementById('p-coord-help'), copy = document.getElementById('p-copy');
  const helpText = help.textContent;
  function readCoord(t) {
    const m = [...t.replace(/\u2212/g, '-').matchAll(/(-?\d+(?:\.\d+)?)\s*\u00b0?\s*([NSEW])?/gi)];
    if (m.length !== 2) return null;
    let [lat, lon] = m.map(x => parseFloat(x[1]) * (/[SW]/i.test(x[2] || '') ? -1 : 1));
    if (!(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 360)) return null;
    return [lat, ((lon % 360) + 360) % 360];
  }
  function commitCoord(turnTo) {
    const c = readCoord(coord.value), ok = !!c;
    if (scope === 'terrain' && turnTo === true) closeTerrain();   // typed coordinates lead back to the Moon
    pins.custom(c, turnTo === true);                        // typed coordinates become the selected site (own pin)
    coord.setAttribute('aria-invalid', !ok);
    help.toggleAttribute('data-error', !ok);
    help.textContent = ok ? helpText : 'Use lat, lon in degrees, e.g. -89.45, 222.8';
    if (ok) coord.value = c[0].toFixed(4) + ', ' + c[1].toFixed(4);
  }
  pins.onPick = s => { if (scope === 'terrain' && s !== terrainSite) closeTerrain(); coord.value = s.lat + ', ' + s.lon; commitCoord(); };
  dropPin = (lat, lon) => { coord.value = lat + ', ' + lon; commitCoord(); };   // click on the Moon: marker stays where clicked, no turn
  // Header search: a listed site by name, or coordinates. Both end in the Site field and turn the Moon to the site.
  createSearch({ input: document.getElementById('search-input'), list: document.getElementById('search-list'), sites: () => pins.sites, parse: readCoord,
    choose: it => { if (scope === 'terrain') closeTerrain(); if (!expanded) expand(); if (it.site) { pins.pick(it.site); pins.face(it.site); } else { coord.value = it.coord.join(', '); commitCoord(true); } } });
  coord.addEventListener('change', () => commitCoord(true));
  coord.addEventListener('paste', () => setTimeout(commitCoord));
  coord.addEventListener('keydown', e => { if (e.key === 'Enter') commitCoord(); });
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(coord.value); } catch { coord.select(); document.execCommand('copy'); }
    copy.classList.add('done'); copy.textContent = 'Copied';
    setTimeout(() => { copy.classList.remove('done'); copy.textContent = 'Copy'; }, 1400);
  });
  // Time span: Start and Stop (date and time, UTC) bound the clock and it repeats that span; Play/Pause runs it.
  // Changing Start jumps there. Clear empties the span: the clock then runs on freely.
  // All of it is in the time bar under the scene (#timebar), with the speeds, the clock and a slider over the span.
  const plays = [...document.querySelectorAll('.pplay')], clocks = [...document.querySelectorAll('.pnow')], toDate = document.getElementById('p-to'), toTime = document.getElementById('p-to-time');
  let shown = '', shownSource = '';
  const sourceEl = document.getElementById('p-source');
  onClock = () => {
    const t = new Date(simMs).toISOString().slice(0, 16).replace('T', ' ');   // UTC, as the heading of the block says
    if (t !== shown) { shown = t; clocks.forEach(c => { c.textContent = t; }); }
    const src = skySource(simMs);                             // where Sun and Earth come from at this moment
    if (src !== shownSource) { shownSource = src; sourceEl.textContent = 'Sun and Earth: ' + SOURCE_LABEL[src] + (src === 'analytic' ? ' (Horizons covers 2027 to 2066)' : ''); }
    plays.forEach(play => { if ((play.getAttribute('aria-pressed') === 'true') !== playing) { play.setAttribute('aria-pressed', playing); play.setAttribute('aria-label', playing ? 'Pause' : 'Play'); } });
    showScrub();
  };
  // Slider of the time bar: the span the numbers cover (Start to Stop, or the two lunar days around the clock).
  const scrub = document.getElementById('tb-scrub'), tbFrom = document.getElementById('tb-from'), tbTo = document.getElementById('tb-to');
  const dayText = ms => new Date(ms).toISOString().slice(0, 10);
  let scrubA = NaN, scrubB = NaN;
  function showScrub() {
    if (!spanWindow) return;
    const { a, b } = spanWindow;
    if (a !== scrubA || b !== scrubB) { scrubA = a; scrubB = b; tbFrom.textContent = dayText(a); tbTo.textContent = dayText(b); }
    const f = Math.min(1, Math.max(0, (simMs - a) / (b - a)));
    if (!scrubbing) scrub.value = Math.round(f * 10000);
    scrub.style.setProperty('--p', f * 100 + '%');
    scrub.setAttribute('aria-valuetext', shown + ' UTC');
  }
  scrub.addEventListener('input', () => { scrubbing = true; setTime(scrubA + scrub.value / 10000 * (scrubB - scrubA)); });
  const endScrub = () => { scrubbing = false; };
  scrub.addEventListener('change', endScrub); scrub.addEventListener('pointerup', endScrub); scrub.addEventListener('blur', endScrub);
  // One hour back or on: the step at which shadows are worth comparing. Stays inside a set span.
  document.querySelectorAll('.tb-step[data-step]').forEach(b => b.addEventListener('click', () => {      // not "Clear", which shares the class for its look
    const t = simMs + b.dataset.step * 3600000;
    setTime(stopMs < Infinity ? Math.min(Math.max(t, loopMs), stopMs - 1) : t);
  }));
  function readSpan(jump) {
    const a = readUtc('p-from', 'p-from-time'), b = readUtc('p-to', 'p-to-time'), ok = !(b <= a);
    toDate.setAttribute('aria-invalid', !ok); toTime.setAttribute('aria-invalid', !ok);     // Stop must be after Start
    const loop = a && b && ok;                             // both set and in order: repeat this span
    stopMs = loop ? b : Infinity; loopMs = a || simMs;
    if (a && (jump || (loop && (simMs < a || simMs >= b)))) setTime(a);
  }
  document.getElementById('p-clear').addEventListener('click', () => {
    ['p-from', 'p-from-time', 'p-to', 'p-to-time'].forEach(id => { document.getElementById(id).value = ''; });
    readSpan(false);
  });
  ['p-from', 'p-from-time'].forEach(id => document.getElementById(id).addEventListener('change', () => readSpan(true)));
  [toDate, toTime].forEach(el => el.addEventListener('change', () => readSpan(false)));
  plays.forEach(play => play.addEventListener('click', () => setPlaying(!playing)));
  // Speed buttons beside Play/Pause: factors on the standard pace (TIME_SCALE = 5000 x real time, 1.4 h per second).
  // 2 x; 12 x = one week in 10 s; 250 x = one year (the Sun's whole path) in 25 s. One at a time; pressing the
  // active one again goes back to the standard pace. Choosing a speed also starts the clock.
  const speeds = [...document.querySelectorAll('.pspeed')];
  speeds.forEach(b => b.addEventListener('click', () => {
    const on = b.getAttribute('aria-pressed') !== 'true';
    speeds.forEach(x => x.setAttribute('aria-pressed', x.dataset.speed === b.dataset.speed && on));
    speed = on ? +b.dataset.speed : 1;
    if (on && !playing) setPlaying(true);
  }));
  readSpan(false); onClock();
  box.querySelectorAll('.param').forEach(b => b.addEventListener('click', () => {
    const on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', on); layers[b.dataset.param]?.(on);
  }));
  // The two limits: the longest time a site may go without the Sun and without the Earth. They show their value next to
  // the label ("Off" at the right end: no limit). The area of the Moon within the limits that are set is marked on the
  // globe (landing-area.js), and the info cards compare the longest darkness and the longest outage with them.
  box.querySelectorAll('.prange').forEach(l => { const r = l.querySelector('input'), o = l.querySelector('output');
    const show = () => { const off = +r.value > LIMIT_MAX_H; o.textContent = off ? 'Off' : r.value + ' h'; r.setAttribute('aria-valuetext', off ? 'Off, no limit' : r.value + ' hours'); r.style.setProperty('--p', (r.value - r.min) / (r.max - r.min) * 100 + '%'); }; r.addEventListener('input', show); show(); });
  addEventListener('keydown', e => { if (e.key !== 'Escape') return; if (box.classList.contains('open')) tab.click(); else if (scope === 'terrain') closeTerrain(); });
}
