import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { gridDefinition, regionAt, GRID_CELL_COUNT } from './lunar-grid.js';
import { readExplorerState, saveExplorerState } from './explorer-state.js';
import { skyDirections, SYNODIC_DAYS } from './celestial.js';

const $ = id => document.getElementById(id), shell = $('canvas-shell');
const preference = readExplorerState(localStorage);
const remember = () => saveExplorerState(localStorage, { grid: grid.visible, markers: markers.visible, selected: selected ? { lat: selected.lat, lon: selected.lon } : null });
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  shell.appendChild(renderer.domElement);
} catch (e) {
  $('unsupported').hidden = false;
  throw e;
}
const scene = new THREE.Scene();
scene.background = new THREE.Color('#010207');
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, .1, 500);
camera.position.set(0, 1.3, 7.9);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = .065;
controls.enablePan = false;
controls.minDistance = 2.6;
controls.maxDistance = 15;
controls.rotateSpeed = .65;

const sphere = new THREE.Mesh(new THREE.SphereGeometry(2.14, 128, 96), new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 }));
scene.add(sphere);
scene.add(new THREE.AmbientLight(0x8e9db0, .58));
const sunlight = new THREE.DirectionalLight(0xfff4dd, 2.2); sunlight.position.set(-5, 3.5, 7); scene.add(sunlight);
const rim = new THREE.DirectionalLight(0x6389ac, .53); rim.position.set(6, -2, -4); scene.add(rim);

let globalDEM = null, globalExaggeration = 6;
function elevationAt(lat, lon) {
  if (!globalDEM) return 0;
  const { values, width, height } = globalDEM;
  const px = ((lon % 360 + 360) % 360) / 360 * width - .5;
  const py = (90 - Math.max(-90, Math.min(90, lat))) / 180 * height - .5;
  const x0 = Math.floor(px), fx = px - x0, y0 = Math.max(0, Math.min(height - 1, Math.floor(py))), fy = Math.max(0, Math.min(1, py - y0));
  const a = (x0 % width + width) % width, b = (a + 1) % width, y1 = Math.min(height - 1, y0 + 1);
  const h0 = values[y0 * width + a] * (1 - fx) + values[y0 * width + b] * fx;
  const h1 = values[y1 * width + a] * (1 - fx) + values[y1 * width + b] * fx;
  return h0 * (1 - fy) + h1 * fy;
}
function updateGlobalRelief() {
  if (!globalDEM) return;
  const positions = sphere.geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const r = Math.hypot(x, y, z), lat = Math.asin(y / r) * 180 / Math.PI, lon = Math.atan2(x, z) * 180 / Math.PI;
    const h = elevationAt(lat, lon);
    const R = 2.14 + (h / 1737400) * 2.14 * globalExaggeration;
    positions.setXYZ(i, x / r * R, y / r * R, z / r * R);
  }
  positions.needsUpdate = true;
  sphere.geometry.computeVertexNormals();
  sphere.geometry.computeBoundingSphere();
}
async function loadGlobalDEM() {
  try {
    const [metaResp, demResp] = await Promise.all([fetch('./lola-global-meta.json'), fetch('./lola-global-i16.bin')]);
    if (!metaResp.ok || !demResp.ok) throw Error('LOLA files unavailable');
    const meta = await metaResp.json(), buffer = await demResp.arrayBuffer();
    if (meta.width * meta.height * 2 !== buffer.byteLength) throw Error('LOLA data length mismatch');
    globalDEM = { width: meta.width, height: meta.height, values: new Int16Array(buffer) };
    sphere.geometry.dispose();
    sphere.geometry = new THREE.SphereGeometry(2.14, 256, 128);
    updateGlobalRelief();
    $('relief').textContent = 'LOLA relief · 6×';
    $('relief').title = 'LOLA global preview: displacement exaggerated 6 times; native DEM resampled to 2048×1024.';
    $('dataLabel').textContent = 'Global LOLA elevation available · 6× vertical relief visualization · local hazards require finer DEM. Click local DEM sites to open the 16–20 km terrain windows.';
  } catch (err) {
    $('relief').textContent = 'LOLA relief unavailable';
    $('relief').disabled = true;
    console.warn(err);
  }
}
$('relief').addEventListener('click', () => {
  if (!globalDEM) return;
  globalExaggeration = globalExaggeration === 6 ? 1 : 6;
  $('relief').textContent = `LOLA relief · ${globalExaggeration}×`;
  $('relief').classList.toggle('active', globalExaggeration === 6);
  $('relief').setAttribute('aria-pressed', String(globalExaggeration === 6));
  updateGlobalRelief();
});
loadGlobalDEM();

function previewTexture() {
  let c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const ctx = c.getContext('2d'), base = ctx.createImageData(c.width, c.height);
  let seed = 341; function random(){ seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; }
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { let i = (y * c.width + x) * 4, n = 70 + random() * 32; let band = 10 * Math.sin(x / 91) * Math.cos(y / 49); let v = n + band; base.data[i] = v; base.data[i + 1] = v; base.data[i + 2] = v + 2; base.data[i + 3] = 255; }
  ctx.putImageData(base, 0, 0);
  for (let i = 0; i < 2500; i++) { const x = random() * c.width, y = random() * c.height, r = 1 + Math.pow(random(), 4) * 32; ctx.strokeStyle = 'rgba(214,218,220,.16)'; ctx.lineWidth = Math.max(.4, r * .16); ctx.beginPath(); ctx.ellipse(x, y, r, r * .7, 0, 0, 2 * Math.PI); ctx.stroke(); ctx.fillStyle = 'rgba(12,14,18,.10)'; ctx.beginPath(); ctx.ellipse(x + 1, y + 1, r * .76, r * .55, 0, 0, 2 * Math.PI); ctx.fill(); }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}
sphere.material.map = previewTexture(); sphere.material.needsUpdate = true;

async function loadNASA() {
 const state=$('textureState');
 new THREE.TextureLoader().load('./assets/lola-hillshade.jpg', texture=>{
  texture.colorSpace=THREE.SRGBColorSpace;
  sphere.material.map=texture;
  sphere.material.needsUpdate=true;
  state.textContent='Global LOLA-derived grayscale relief · static preview (not NASA WAC imagery)';
  $('modeLabel').textContent='LOLA STATIC PREVIEW';
 },undefined,()=>{state.textContent='LOLA preview texture unavailable; synthetic fallback is shown';});
}
loadNASA();

const GRID_RADIUS = 2.153;
const DEG = Math.PI / 180;
function pointOnMoon(lat, lon, radius = GRID_RADIUS) {
  let p = lat * DEG, l = lon * DEG;
  return new THREE.Vector3(radius * Math.cos(p) * Math.sin(l), radius * Math.sin(p), radius * Math.cos(p) * Math.cos(l));
}
const grid = new THREE.Group(); scene.add(grid);
const gridPoints = [];
function addGridSegment(a, b) { gridPoints.push(a.x, a.y, a.z, b.x, b.y, b.z); }
const bands = gridDefinition();
for (const band of bands) {
  if (band.index > 0) { const latitude = band.south; for (let lon = 0; lon < 360; lon += 3) addGridSegment(pointOnMoon(latitude, lon), pointOnMoon(latitude, lon + 3)); }
  const n = band.sectors;
  for (let column = 0; column < n; column++) {
    const longitude = column * 360 / n;
    for (let t = 0; t < 4; t++) {
      let lat0 = band.south + (band.north - band.south) * t / 4;
      let lat1 = band.south + (band.north - band.south) * (t + 1) / 4;
      addGridSegment(pointOnMoon(lat0, longitude), pointOnMoon(lat1, longitude));
    }
  }
}
const gridGeometry = new THREE.BufferGeometry(); gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(gridPoints, 3));
const gridLines = new THREE.LineSegments(gridGeometry, new THREE.LineBasicMaterial({ color: 0xa3cfe5, transparent: true, opacity: .43, depthWrite: false }));
grid.add(gridLines); grid.visible = false;

const highlightedRegion = new THREE.Group(); scene.add(highlightedRegion); highlightedRegion.visible = false;
function showRegion(region){
  while(highlightedRegion.children.length){ const o = highlightedRegion.children[0]; highlightedRegion.remove(o); o.geometry?.dispose(); o.material?.dispose(); }
  const pts=[];
  for(let step=0; step<=20; step++){ const t=step/20; pts.push(pointOnMoon(region.south, region.west + (region.east-region.west)*t, 2.165)); }
  for(let step=1; step<=10; step++){ const t=step/10; pts.push(pointOnMoon(region.south + (region.north-region.south)*t, region.east, 2.165)); }
  for(let step=1; step<=20; step++){ const t=step/20; pts.push(pointOnMoon(region.north, region.east - (region.east-region.west)*t, 2.165)); }
  for(let step=1; step<=10; step++){ const t=step/10; pts.push(pointOnMoon(region.north - (region.north-region.south)*t, region.west, 2.165)); }
  pts.push(pts[0].clone());
  highlightedRegion.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: .92, depthTest: true })));
  highlightedRegion.visible = grid.visible;
}

// --- celestial paths and labeled stars ---
const skyGroup = new THREE.Group(); scene.add(skyGroup);
const starsGeometry = new THREE.BufferGeometry(), starCoords = [];
let starSeed = 80813; const starRandom = () => ((starSeed = (Math.imul(starSeed, 1664525) + 1013904223) >>> 0) / 4294967296);
for(let i=0;i<1300;i++){
  const u = starRandom() * 2 - 1; const t = starRandom() * Math.PI * 2; const r = 70 + starRandom() * 45; const s = Math.sqrt(1-u*u);
  starCoords.push(Math.cos(t)*s*r, u*r, Math.sin(t)*s*r);
}
starsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starCoords, 3));
const starCloud = new THREE.Points(starsGeometry, new THREE.PointsMaterial({ color: 0xf6f7ff, size: 0.35, transparent: true, opacity: 0.85 }));
skyGroup.add(starCloud);
function makeLabelSprite(text, color='#f4d67a'){
  const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d'); canvas.width = 256; canvas.height = 70;
  ctx.font = '26px DM Sans'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = color; ctx.fillText(text, 128, 35);
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(1.9, .52, 1); return sprite;
}
function equatorialDir(raHours, decDeg){
  const ra = raHours / 24 * Math.PI * 2, dec = decDeg * Math.PI / 180, r = 73;
  return new THREE.Vector3(r * Math.cos(dec) * Math.cos(ra), r * Math.sin(dec), r * Math.cos(dec) * Math.sin(ra));
}
const labeledStars = [
  { name:'Sirius', ra:6.752, dec:-16.72 },
  { name:'Canopus', ra:6.399, dec:-52.70 },
  { name:'Betelgeuse', ra:5.919, dec:7.41 },
  { name:'Rigel', ra:5.243, dec:-8.20 },
  { name:'Vega', ra:18.615, dec:38.78 },
  { name:'Polaris', ra:2.530, dec:89.26 },
];
for(const s of labeledStars){
  const star = new THREE.Mesh(new THREE.SphereGeometry(.18, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd27b }));
  star.position.copy(equatorialDir(s.ra, s.dec));
  const label = makeLabelSprite(s.name, '#ffd27b'); label.position.set(0, .55, 0); star.add(label); skyGroup.add(star);
}
const sunSphere = new THREE.Mesh(new THREE.SphereGeometry(0.26, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffef9a }));
const earthSphere = new THREE.Mesh(new THREE.SphereGeometry(0.18, 22, 14), new THREE.MeshBasicMaterial({ color: 0x7fb7eb }));
sunSphere.add(makeLabelSprite('Sun', '#ffe89d')); sunSphere.children[0].position.set(0,.42,0);
earthSphere.add(makeLabelSprite('Earth', '#c2dfff')); earthSphere.children[0].position.set(0,.34,0);
skyGroup.add(sunSphere, earthSphere);
let sunPath=null, earthPath=null;
function circlePath(samples, fn, color, opacity){
  const pts = [];
  for(let i=0;i<=samples;i++) pts.push(fn(i/samples));
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent:true, opacity }));
}
let skyMillis = Date.parse('2026-11-14T00:00:00Z'), dayMs = 86400000, skyLast = performance.now(), skyPlaying = false;
const dateField = $('skyDate');
function updateSky(){
  const iso = new Date(skyMillis).toISOString().slice(0,10); $('skyStatus').textContent = `Apparent Sun and Earth directions for ${iso}. Earth motion stays close to one side of the Moon, while the Sun completes a synodic cycle every ${SYNODIC_DAYS.toFixed(2)} days.`;
  const model = skyDirections(skyMillis);
  const sun = new THREE.Vector3(...model.sun).multiplyScalar(6.5);
  const earth = new THREE.Vector3(...model.earth).multiplyScalar(5.4);
  sunlight.position.copy(sun);
  sunSphere.position.copy(sun.clone().multiplyScalar(10.5));
  earthSphere.position.copy(earth.clone().multiplyScalar(10.5));
  if(sunPath) { skyGroup.remove(sunPath); sunPath.geometry.dispose(); sunPath.material.dispose(); }
  if(earthPath) { skyGroup.remove(earthPath); earthPath.geometry.dispose(); earthPath.material.dispose(); }
  sunPath = circlePath(160, t => { const ms = skyMillis + (t-0.5) * SYNODIC_DAYS * dayMs; const d = new THREE.Vector3(...skyDirections(ms).sun).multiplyScalar(10.5); return d; }, 0xcfa96a, .25);
  earthPath = circlePath(120, t => { const ms = skyMillis + (t-0.5) * 27.321661 * dayMs; const d = new THREE.Vector3(...skyDirections(ms).earth).multiplyScalar(10.5); return d; }, 0x79a8d1, .22);
  skyGroup.add(sunPath, earthPath);
}
function setSkyDate(value){ const ms = Date.parse(`${value}T00:00:00Z`); if(Number.isFinite(ms)){ skyMillis = ms; updateSky(); } }
dateField.addEventListener('change',()=>setSkyDate(dateField.value));
$('skyPlay').addEventListener('click',()=>{ skyPlaying=!skyPlaying; $('skyPlay').textContent=skyPlaying?'Pause motion Ⅱ':'Play motion ↗'; $('skyPlay').setAttribute('aria-pressed', String(skyPlaying)); });
$('paths').addEventListener('click',()=>{ skyGroup.visible=!skyGroup.visible; $('paths').classList.toggle('active', skyGroup.visible); $('paths').setAttribute('aria-pressed', String(skyGroup.visible)); });
updateSky();

const markers = new THREE.Group(); scene.add(markers);
const categories = {
  feature: { color: 0xe9d39c },
  mission: { color: 0x7ad5e7 },
  site: { color: 0xffffff },
};
const features = [
  { name:'Oceanus Procellarum', lat:18.4, lon:-57.4, category:'feature', info:'Major lunar mare on the nearside.' },
  { name:'Mare Imbrium', lat:32.8, lon:-15.6, category:'feature', info:'Impact basin filled with basaltic lavas.' },
  { name:'Mare Tranquillitatis', lat:8.5, lon:31.4, category:'feature', info:'Mare where Apollo 11 landed.' },
  { name:'South Pole-Aitken Basin', lat:-53.0, lon:-169.0, category:'feature', info:'One of the largest known impact basins in the Solar System.' },
  { name:'Shackleton Crater', lat:-89.9, lon:0.0, category:'feature', info:'South-polar crater of high exploration interest.' },
  { name:'Tycho Crater', lat:-43.3, lon:-11.2, category:'feature', info:'Young prominent impact crater.' },
  { name:'Copernicus Crater', lat:9.6, lon:-20.1, category:'feature', info:'Prominent young crater on the near side.' },
  { name:'Mons Huygens', lat:20.0, lon:-2.8, category:'feature', info:'One of the tallest lunar mountains.' },
  { name:'Apollo 11', lat:0.674, lon:23.473, category:'mission', info:'First crewed lunar landing.' },
  { name:'Apollo 12', lat:-3.012, lon:-23.421, category:'mission', info:'Crewed landing in Oceanus Procellarum.' },
  { name:'Apollo 14', lat:-3.645, lon:-17.471, category:'mission', info:'Crewed landing at Fra Mauro.' },
  { name:'Apollo 15', lat:26.132, lon:3.634, category:'mission', info:'Crewed landing in Hadley–Apennine.' },
  { name:'Apollo 16', lat:-8.973, lon:15.501, category:'mission', info:'Crewed landing in the Descartes Highlands.' },
  { name:'Apollo 17', lat:20.191, lon:30.771, category:'mission', info:'Last crewed lunar landing to date.' },
  { name:'Surveyor 1', lat:-2.474, lon:-43.339, category:'mission', info:'Early soft-landing robotic mission.' },
  { name:'Luna 9', lat:7.13, lon:-64.37, category:'mission', info:'First successful soft landing on the Moon.' },
  { name:'Chang’e 4', lat:-45.457, lon:177.589, category:'mission', info:'First soft landing on the far side.' },
  { name:'Chandrayaan-3', lat:-69.37, lon:32.35, category:'mission', info:'South-polar soft landing.' },
  { name:'DM2 local DEM', lat:-83.954017, lon:58.822055, category:'site', info:'Uploaded 20 × 20 km local detail DEM.', terrain:'dm2' },
  { name:'Site 01 local DEM', lat:-89.463163, lon:-137.489553, category:'site', info:'Uploaded local detail DEM from hackathon bundle.', terrain:'site01' },
  { name:'Site 04 local DEM', lat:-89.766811, lon:-171.869898, category:'site', info:'Uploaded local detail DEM from hackathon bundle.', terrain:'site04' },
  { name:'Site 20 local DEM', lat:-85.426577, lon:31.742761, category:'site', info:'Uploaded local detail DEM from hackathon bundle.', terrain:'site20' },
];
function position(lat, lon, radius=2.17){ const p = lat * Math.PI / 180, l = lon * Math.PI / 180; return new THREE.Vector3(radius * Math.cos(p) * Math.sin(l), radius * Math.sin(p), radius * Math.cos(p) * Math.cos(l)); }
for(const f of features){
  const marker = new THREE.Mesh(new THREE.SphereGeometry(f.category==='site'?.032:.024, 12, 8), new THREE.MeshBasicMaterial({ color: categories[f.category].color }));
  marker.position.copy(position(f.lat, f.lon, 2.17));
  marker.userData = f;
  markers.add(marker);
}
markers.visible = preference.markers ?? true;

const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
let selected = null;
const selection = new THREE.Mesh(new THREE.SphereGeometry(.033,16,12),new THREE.MeshBasicMaterial({color:0xffffff}));scene.add(selection);selection.visible=false;
function nearestFeature(lat, lon){
  let best = null, bestDist = Infinity;
  for(const f of features){
    const d = Math.hypot((f.lat-lat), (((f.lon-lon+540)%360)-180) * Math.cos(lat*Math.PI/180));
    const threshold = f.category === 'site' ? 3.5 : 4.0;
    if(d < threshold && d < bestDist){ best = f; bestDist = d; }
  }
  return best;
}
function describeSelection(lat, lon){
  const named = nearestFeature(lat, lon);
  $('siteName').textContent = named?.name || 'Lunar location';
  $('coordinates').textContent = `${lat.toFixed(3)}° / ${lon.toFixed(3)}°`;
  if(named){
    $('dataLabel').textContent = named.info + (named.terrain ? ' Open the terrain view to inspect the local DEM.' : '');
    $('inspectLink').href = named.terrain ? `terrain.html?site=${named.terrain}` : `explore.html?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
    $('inspectLink').textContent = named.terrain ? 'Open terrain ↗' : 'Explore tiles ↗';
  } else {
    $('dataLabel').textContent = 'Reference-sphere grid · cell dimensions are approximate, especially near poles. Landmarks and mission markers remain simplified to keep the 3D scene readable.';
    $('inspectLink').href = `explore.html?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
    $('inspectLink').textContent = 'Explore tiles ↗';
  }
}
let press=null; renderer.domElement.addEventListener('pointerdown',e=>{ press={x:e.clientX,y:e.clientY}; });
renderer.domElement.addEventListener('pointerup',e=>{
  if(!press || Math.hypot(e.clientX-press.x,e.clientY-press.y)>6) return;
  const box=renderer.domElement.getBoundingClientRect();
  mouse.set((e.clientX-box.left)/box.width*2-1,-((e.clientY-box.top)/box.height*2-1));
  ray.setFromCamera(mouse,camera);
  const hit=ray.intersectObject(sphere)[0];
  if(!hit) return;
  let p=hit.point.clone().normalize(),lat=Math.asin(p.y)*180/Math.PI,lon=((Math.atan2(p.x,p.z)*180/Math.PI+540)%360)-180;
  selected={lat,lon,region:regionAt(lat,lon)};
  showRegion(selected.region);
  $('gridRegion').hidden=!grid.visible;
  const c=selected.region;
  $('regionId').textContent=c.id;
  $('regionSize').textContent=`${c.heightKm.toFixed(1)} × ${c.widthKm.toFixed(1)} km at sector center · ${c.areaKm2.toFixed(0)} km²`;
  selection.visible=true; selection.position.copy(hit.point.clone().multiplyScalar(1.012));
  describeSelection(lat,lon);
  remember();
});
$('grid').onclick=()=>{ grid.visible=!grid.visible; highlightedRegion.visible=grid.visible&&Boolean(selected); $('gridRegion').hidden=!grid.visible||!selected; $('grid').classList.toggle('active',grid.visible); $('grid').setAttribute('aria-pressed',String(grid.visible)); $('grid').title=`${GRID_CELL_COUNT.toLocaleString()} nominal 120 km sectors, latitude-adaptive`; remember(); };
$('markers').onclick=()=>{ markers.visible=!markers.visible; $('markers').classList.toggle('active',markers.visible); $('markers').setAttribute('aria-pressed',String(markers.visible)); remember(); };
$('reset').onclick=()=>{ camera.position.set(0,1.3,7.9); controls.target.set(0,0,0); controls.update(); };
$('markers').classList.toggle('active', markers.visible); $('markers').setAttribute('aria-pressed', String(markers.visible));
grid.visible = preference.grid; $('grid').classList.toggle('active',grid.visible); $('grid').setAttribute('aria-pressed',String(grid.visible));
if(preference.selected){
  const lat=preference.selected.lat,lon=preference.selected.lon;
  selected={lat,lon,region:regionAt(lat,lon)}; showRegion(selected.region); selection.position.copy(position(lat,lon)); selection.visible=true; describeSelection(lat,lon);
  $('gridRegion').hidden=!grid.visible; $('regionId').textContent=selected.region.id; $('regionSize').textContent=`${selected.region.heightKm.toFixed(1)} × ${selected.region.widthKm.toFixed(1)} km · ${selected.region.areaKm2.toFixed(0)} km²`;
}
$('copyCoordinates').onclick=async()=>{ if(!selected)return; try{ await navigator.clipboard.writeText(`${selected.lat.toFixed(5)}, ${selected.lon.toFixed(5)}`); $('copyCoordinates').textContent='Copied ✓'; setTimeout(()=>$('copyCoordinates').textContent='Copy coordinates ↗',1600); }catch(e){ $('coordinates').textContent+=' (copy unavailable)'; } };
$('fullScreen').onclick=()=>{ if(document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.(); };
function resize(){ camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth,innerHeight); }
addEventListener('resize',resize);
function loop(){ const now=performance.now(),delta=Math.min(.15,(now-skyLast)/1000); skyLast=now; if(skyPlaying){ skyMillis += delta*dayMs*.45; const v = new Date(skyMillis).toISOString().slice(0,10); if(dateField.value!==v) dateField.value=v; updateSky(); } controls.update(); renderer.render(scene,camera); requestAnimationFrame(loop); }
loop();
