import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { skyDirections } from './celestial.js';

const $ = (id) => document.getElementById(id);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020305);
const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.02, 1400);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
$('surface').appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 2;
controls.maxDistance = 320;
controls.maxPolarAngle = Math.PI * 0.49;
controls.target.set(0, 0, 0);

const hemi = new THREE.HemisphereLight(0xaecde0, 0x101214, 1.1);
scene.add(hemi);
const ambient = new THREE.AmbientLight(0x6d7b8b, 0.45);
scene.add(ambient);
const sunLight = new THREE.DirectionalLight(0xfff4dd, 2.1);
scene.add(sunLight);
const earthLight = new THREE.DirectionalLight(0x7db3de, 0.35);
scene.add(earthLight);

const terrainGroup = new THREE.Group();
scene.add(terrainGroup);
const skyGroup = new THREE.Group();
scene.add(skyGroup);
const picker = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
picker.visible = false;
scene.add(picker);

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

let manifest = null;
let currentSite = null;
let geometry = null;
let terrain = null;
let wire = null;
let contextTerrain = null;
let contextGrid = null;
let rows = 0, cols = 0;
let cellData = null;
let baseColors = null;
let normals = null;
let slopeEnabled = true;
let shadowEnabled = true;
let wireEnabled = false;
let sunBody = null;
let earthBody = null;
let sunPath = null;
let earthPath = null;
let lastHoverIndex = null;
let horizonData = null;
let horizonPending = false;
let horizonTimer = null;
let horizonSerial = 0;
const SUN_ANGULAR_RADIUS = 0.2666;
const SKY_SUN_RADIUS = 128;
const SKY_EARTH_RADIUS = 118;
const SKY_LIGHT_RADIUS = 96;
const horizonCache = new Map();
const STATIC_HORIZON_STEP=30;
const STATIC_SITE_IDS=new Set(['dm2','site01','site04','site20']);

function horizonValue(index, field){
  if(!horizonData || !cellData)return null;
  const grid=horizonData[field];
  const r=Math.floor(index/cols),c=index%cols;
  const xx=(c+0.5)/cols*horizonData.cols-.5;
  const yy=(r+0.5)/rows*horizonData.rows-.5;
  const x0=clamp(Math.floor(xx),0,horizonData.cols-1),x1=Math.min(horizonData.cols-1,x0+1);
  const y0=clamp(Math.floor(yy),0,horizonData.rows-1),y1=Math.min(horizonData.rows-1,y0+1);
  const fx=clamp(xx-x0,0,1),fy=clamp(yy-y0,0,1);
  const i00=y0*horizonData.cols+x0,i10=y0*horizonData.cols+x1;
  const i01=y1*horizonData.cols+x0,i11=y1*horizonData.cols+x1;
  return (grid[i00]*(1-fx)+grid[i10]*fx)*(1-fy)+(grid[i01]*(1-fx)+grid[i11]*fx)*fy;
}
function solarFraction(index){
  const hor=horizonValue(index,'horizon_deg');
  if(hor===null)return null;
  const offset=horizonValue(index,'local_sun_el_offset_deg')||0;
  return clamp((params.sunElevation+offset-hor+SUN_ANGULAR_RADIUS)/(2*SUN_ANGULAR_RADIUS),0,1);
}
function requestHorizon(){
  if(!currentSite)return;
  if(horizonTimer)clearTimeout(horizonTimer);
  const az=Math.round(params.sunAzimuth)%360;
  const key=currentSite.id+':'+az;
  const seq=++horizonSerial;
  if(horizonCache.has(key)){
    horizonData=horizonCache.get(key);
    horizonPending=false;
    updateTerrainColors();
    $('skyStatus').textContent='Static precomputed horizon: nearest 30° azimuth. 250 × 250 km context shown; local Python required for exact angles.';
    return;
  }
  horizonData=null;
  horizonPending=true;
  $('skyStatus').textContent='Loading static precomputed terrain horizon · angular resolution 30°…';
  updateTerrainColors();
  horizonTimer=setTimeout(async()=>{
    try{
      const sampleAz=Math.round(az/STATIC_HORIZON_STEP)*STATIC_HORIZON_STEP%360;
      const url=`./static-data/horizon/${encodeURIComponent(currentSite.id)}/${sampleAz}.json`;
      const resp=await fetch(url);
      if(!resp.ok)throw Error('HTTP '+resp.status);
      const data=await resp.json();
      if(seq!==horizonSerial)return;
      if(data.site!==currentSite.id||data.azimuth_deg!==sampleAz||!Array.isArray(data.horizon_deg))throw Error('Horizon response mismatch');
      horizonCache.set(key,data);
      horizonData=data;
      horizonPending=false;
      $('skyStatus').textContent=`Static precomputed terrain horizon at ${sampleAz}° (nearest 30° sample) · 250 × 250 km context visualized · rays out to ${data.far_sample_limit_km} km. Use local Python for exact slider azimuth.`;
      updateTerrainColors();
    }catch(err){
      if(seq!==horizonSerial)return;
      horizonData=null;horizonPending=false;
      $('skyStatus').textContent='Full terrain horizon unavailable: showing local-slope shading only. '+err.message;
      updateTerrainColors();
    }
  },300);
}


const params = {
  sunAzimuth: 120,
  sunElevation: 8,
  skyDate: '2026-11-14',
};

function degToRad(v){ return v * Math.PI / 180; }
function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
function kmText(site){ return `${site.width_km.toFixed ? site.width_km.toFixed(0) : site.width_km} × ${site.height_km.toFixed ? site.height_km.toFixed(0) : site.height_km} KM`; }

function localSkyDirection(azimuthDeg, elevationDeg){
  const az = degToRad(azimuthDeg);
  const el = degToRad(elevationDeg);
  const cosEl = Math.cos(el);
  // x east, y up, z south; north = -z
  return new THREE.Vector3(Math.sin(az) * cosEl, Math.sin(el), -Math.cos(az) * cosEl).normalize();
}

function sunSceneDirection(azimuthDeg,elevationDeg){
  // South-polar stereographic x east/projected, z south/projected.
  // Rotate the true local geographic azimuth by the longitude at the site center.
  return localSkyDirection(azimuthDeg+(currentSite?.center?.longitude_east||0),elevationDeg);
}
function moonSurfaceVector(latDeg, lonDeg){
  const lat = degToRad(latDeg), lon = degToRad(lonDeg);
  return new THREE.Vector3(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon));
}
function localBasis(latDeg, lonDeg){
  const lat = degToRad(latDeg), lon = degToRad(lonDeg);
  const up = moonSurfaceVector(latDeg, lonDeg).normalize();
  const east = new THREE.Vector3(Math.cos(lon), 0, -Math.sin(lon)).normalize();
  const north = new THREE.Vector3(-Math.sin(lat) * Math.sin(lon), Math.cos(lat), -Math.sin(lat) * Math.cos(lon)).normalize();
  return { east, north, up };
}
function directionToLocalAzEl(direction, latDeg, lonDeg){
  const { east, north, up } = localBasis(latDeg, lonDeg);
  const e = direction.dot(east);
  const n = direction.dot(north);
  const u = direction.dot(up);
  const az = (Math.atan2(e, n) * 180 / Math.PI + 360) % 360;
  const el = Math.asin(clamp(u, -1, 1)) * 180 / Math.PI;
  return { azimuth: az, elevation: el };
}

function makeLabelSprite(text, color='#ffffff'){
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = 256;
  canvas.height = 80;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = '28px DM Sans';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(6.5, 2.05, 1);
  return sprite;
}

function addSkyReferenceObjects(){
  if(sunBody){ skyGroup.remove(sunBody); skyGroup.remove(earthBody); skyGroup.remove(sunPath); skyGroup.remove(earthPath); }
  sunBody = new THREE.Mesh(new THREE.SphereGeometry(0.34, 28, 18), new THREE.MeshBasicMaterial({ color: 0xffec95 }));
  earthBody = new THREE.Mesh(new THREE.SphereGeometry(0.22, 24, 16), new THREE.MeshBasicMaterial({ color: 0x77aee3 }));
  sunBody.add(makeLabelSprite('Sun', '#ffe89d'));
  earthBody.add(makeLabelSprite('Earth', '#c7e1ff'));
  sunBody.children[0].position.set(0, 1.2, 0);
  earthBody.children[0].position.set(0, 0.95, 0);
  skyGroup.add(sunBody, earthBody);
  sunPath = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xc9a85f, transparent: true, opacity: 0.35 }));
  earthPath = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x6ea7d9, transparent: true, opacity: 0.25 }));
  skyGroup.add(sunPath, earthPath);
}
addSkyReferenceObjects();

function pathForElevation(radius, elevationDeg){
  const pts = [];
  for(let a=0; a<360; a+=4){
    const d = localSkyDirection(a, elevationDeg).multiplyScalar(radius);
    pts.push(d);
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
}

function setSkyContext(){
  $('sunAzimuthValue').textContent = `${Number(params.sunAzimuth).toFixed(0)}°`;
  $('sunElevationValue').textContent = `${Number(params.sunElevation).toFixed(1)}°`;
  const sunDir = sunSceneDirection(params.sunAzimuth, params.sunElevation);
  sunLight.position.copy(sunDir.clone().multiplyScalar(SKY_LIGHT_RADIUS));
  if(sunBody) sunBody.position.copy(sunDir.clone().multiplyScalar(SKY_SUN_RADIUS));
  if(sunPath) { sunPath.geometry.dispose(); sunPath.geometry = pathForElevation(SKY_SUN_RADIUS, params.sunElevation); }

  if(currentSite){
    const model = skyDirections(params.skyDate);
    const earthGlobal = new THREE.Vector3(...model.earth).normalize();
    const site = currentSite.center;
    const earthAzEl = directionToLocalAzEl(earthGlobal, site.latitude, site.longitude_east);
    const earthDir = localSkyDirection(earthAzEl.azimuth + site.longitude_east, Math.max(-5, Math.min(30, earthAzEl.elevation)));
    earthLight.position.copy(earthDir.clone().multiplyScalar(SKY_LIGHT_RADIUS * 0.9));
    if(earthBody) earthBody.position.copy(earthDir.clone().multiplyScalar(SKY_EARTH_RADIUS));
    if(earthPath) { earthPath.geometry.dispose(); earthPath.geometry = pathForElevation(SKY_EARTH_RADIUS, Math.max(-2, Math.min(18, earthAzEl.elevation))); }
    // Horizon-status text is managed by requestHorizon() instead.
  }
  updateTerrainColors();
}

function buildNormalsAndBaseColors(){
  const zs = cellData.elevation_m;
  const widthM = cellData.width_m, heightM = cellData.height_m;
  const cellW = widthM / cols, cellH = heightM / rows;
  const low = cellData.min_elevation_m, high = cellData.max_elevation_m;
  const range = Math.max(1, high - low);
  baseColors = new Float32Array(rows * cols * 3);
  normals = new Float32Array(rows * cols * 3);
  for(let y=0; y<rows; y++){
    for(let x=0; x<cols; x++){
      const i = y * cols + x;
      const h = zs[i];
      const left = zs[y * cols + Math.max(0, x - 1)];
      const right = zs[y * cols + Math.min(cols - 1, x + 1)];
      const down = zs[Math.max(0, y - 1) * cols + x];
      const up = zs[Math.min(rows - 1, y + 1) * cols + x];
      const gx = (right - left) / (2 * cellW);
      const gz = (up - down) / (2 * cellH);
      const n = new THREE.Vector3(-gx, 1, -gz).normalize();
      normals[i*3] = n.x; normals[i*3+1] = n.y; normals[i*3+2] = n.z;
      const t = 0.22 + 0.68 * (h - low) / range;
      baseColors[i*3] = t * 0.83;
      baseColors[i*3+1] = t * 0.90;
      baseColors[i*3+2] = t;
    }
  }
}

function updateTerrainColors(){
  if(!geometry || !cellData || !baseColors || !normals) return;
  const colors = geometry.getAttribute('color');
  const fracs = cellData.slope_gt10_fraction;
  const sunDir = sunSceneDirection(params.sunAzimuth, params.sunElevation);
  const earthPos = earthBody ? earthBody.position.clone().normalize() : localSkyDirection(120, 10);

  let litCount = 0, earthCount = 0;
  for(let i=0; i<rows*cols; i++){
    const n = new THREE.Vector3(normals[i*3], normals[i*3+1], normals[i*3+2]);
    const incidence = Math.max(0, n.dot(sunDir));
    const earthLOS = n.dot(earthPos) > 0;
    const visible=solarFraction(i);
    if((visible===null?incidence>0.08:visible>0.5)&&incidence>0) litCount++;
    if(earthLOS) earthCount++;
    let r = baseColors[i*3], g = baseColors[i*3+1], b = baseColors[i*3+2];
    if(shadowEnabled){
      const occlusion = visible === null ? 1 : visible;
      const shade = 0.08 + 0.92 * incidence * occlusion;
      r *= shade; g *= shade; b *= shade;
      if(incidence < 0.04 || (visible!==null&&visible<0.1)){
        r *= 0.55; g *= 0.6; b = Math.min(1, b * 0.85 + 0.08);
      }
    }
    if(slopeEnabled && fracs[i] >= 0.05){
      const slopeTint = shadowEnabled ? (0.10 + 0.90 * incidence * (visible===null?1:visible)) : 1;
      r = Math.min(1, 0.68 + 0.24 * fracs[i]) * slopeTint;
      g = 0.11 * slopeTint;
      b = 0.11 * slopeTint;
    }
    if(!earthLOS && !slopeEnabled){
      b = Math.min(1, b + 0.06);
    }
    colors.setXYZ(i, r, g, b);
  }
  colors.needsUpdate = true;
  const litPct = 100 * litCount / (rows * cols);
  const earthPct = 100 * earthCount / (rows * cols);
  $('analysis').textContent = `${horizonData?'Multi-scale terrain-horizon':'Local-slope-only'} Sun exposure: ${litPct.toFixed(0)}% · Earth signal ${earthPct.toFixed(0)}% (local-slope approximation).`;
}

function disposeTerrain(){
  if(terrain){ terrainGroup.remove(terrain); terrain.geometry.dispose(); terrain.material.dispose(); terrain = null; }
  if(wire){ terrainGroup.remove(wire); wire.geometry.dispose(); wire.material.dispose(); wire = null; }
  if(geometry){ geometry.dispose(); geometry = null; }
}


function disposeContextTerrain(){
  if(contextTerrain){ terrainGroup.remove(contextTerrain); contextTerrain.geometry.dispose(); contextTerrain.material.dispose(); contextTerrain=null; }
  if(contextGrid){
    terrainGroup.remove(contextGrid);
    contextGrid.traverse(obj=>{ if(obj.geometry) obj.geometry.dispose(); if(obj.material) obj.material.dispose(); });
    contextGrid=null;
  }
}

function buildDashedGrid(dimX, dimZ, segmentsX=10, segmentsZ=10){
  const group = new THREE.Group();
  const material = new THREE.LineDashedMaterial({ color: 0xb9c9d4, dashSize: Math.max(dimX,dimZ)/60, gapSize: Math.max(dimX,dimZ)/75, transparent:true, opacity:0.33 });
  for(let i=0;i<=segmentsX;i++){
    const x = -dimX/2 + dimX*(i/segmentsX);
    const pts = [new THREE.Vector3(x,0.015,-dimZ/2), new THREE.Vector3(x,0.015,dimZ/2)];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geo, material.clone());
    line.computeLineDistances();
    group.add(line);
  }
  for(let j=0;j<=segmentsZ;j++){
    const z = -dimZ/2 + dimZ*(j/segmentsZ);
    const pts = [new THREE.Vector3(-dimX/2,0.015,z), new THREE.Vector3(dimX/2,0.015,z)];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geo, material.clone());
    line.computeLineDistances();
    group.add(line);
  }
  return group;
}

function createContextMesh(ctx){
  disposeContextTerrain();
  const rows=ctx.rows, cols=ctx.cols;
  const dimX = ctx.width_m / 1000;
  const dimZ = ctx.height_m / 1000;
  const altitudeScale = 0.005;
  const zs = ctx.elevation_m;
  const min = Math.min(...zs), max = Math.max(...zs);
  const verts=[]; const colors=[]; const idx=[];
  for(let y=0;y<rows;y++){
    for(let x=0;x<cols;x++){
      const id=y*cols+x;
      const h=zs[id];
      verts.push(((x+0.5)/cols-0.5)*dimX, (h - (min+max)/2)*altitudeScale - 0.03, ((y+0.5)/rows-0.5)*dimZ);
      colors.push(0.52,0.60,0.66);
    }
  }
  for(let y=0;y<rows-1;y++){
    for(let x=0;x<cols-1;x++){
      const i=y*cols+x;
      idx.push(i,i+cols,i+1, i+1,i+cols,i+cols+1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts,3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors,3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  contextTerrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors:true, transparent:true, opacity:0.22, roughness:1, metalness:0, side:THREE.DoubleSide, depthWrite:false }));
  terrainGroup.add(contextTerrain);
  contextGrid = buildDashedGrid(dimX, dimZ, 10, 10);
  terrainGroup.add(contextGrid);
}

async function loadContextForSite(siteId){
  try{
    const resp = await fetch(`./static-data/context/${encodeURIComponent(siteId)}.json`);
    if(!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const ctx = await resp.json();
    if(currentSite?.id !== siteId) return;
    createContextMesh(ctx);
    $('skyStatus').textContent='250 × 250 km context terrain visible as semi-transparent dashed outer field; Sun and Earth tracks are pushed outward so you can inspect whether outer relief blocks light into the 20 × 20 km core.';
  }catch(err){
    console.error(err);
    $('skyStatus').textContent='Context terrain preview unavailable; shadow analysis still uses hidden regional context when possible.';
  }
}

function createTerrainMesh(){
  disposeTerrain();
  rows = cellData.rows;
  cols = cellData.cols;
  const dimX = cellData.width_m / 1000;
  const dimZ = cellData.height_m / 1000;
  const altitudeScale = 0.005;
  const verts = [];
  const colors = [];
  const idx = [];
  const zs = cellData.elevation_m;
  const min = Math.min(...zs), max = Math.max(...zs);
  for(let y=0; y<rows; y++){
    for(let x=0; x<cols; x++){
      const id = y * cols + x;
      const h = zs[id];
      verts.push(((x + 0.5) / cols - 0.5) * dimX, (h - (min + max) / 2) * altitudeScale, ((y + 0.5) / rows - 0.5) * dimZ);
      colors.push(0.5, 0.5, 0.5);
    }
  }
  for(let y=0; y<rows-1; y++){
    for(let x=0; x<cols-1; x++){
      const i = y * cols + x;
      idx.push(i, i + cols, i + 1, i + 1, i + cols, i + cols + 1);
    }
  }
  geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(idx);
  geometry.computeVertexNormals();
  terrain = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 1, flatShading: false }));
  terrainGroup.add(terrain);
  wire = new THREE.Mesh(geometry.clone(), new THREE.MeshBasicMaterial({ color: 0x8ea8b8, wireframe: true, transparent: true, opacity: 0.18 }));
  wire.visible = wireEnabled;
  terrainGroup.add(wire);
  buildNormalsAndBaseColors();
  updateTerrainColors();
  const fit = Math.max(dimX, dimZ);
  camera.position.set(0, fit * 1.0, fit * 1.45);
  controls.target.set(0, 0, 0);
  controls.update();
}

async function loadSite(siteId){
  const site = manifest.sites.find(s => s.id === siteId) || manifest.sites[0];
  currentSite = site.center ? site : manifest.sites[0];
  const resp = await fetch(site.file);
  if(!resp.ok) throw new Error(`HTTP ${resp.status}`);
  cellData = await resp.json();
  currentSite = { ...site, center: cellData.center };
  createTerrainMesh();
  $('terrainTitle').textContent = site.name.toUpperCase();
  $('status').textContent = `${site.description} Native ${cellData.native_resolution_m.toFixed(0)} m DEM, displayed at ${cellData.view_resolution_m.toFixed(0)} m cells with local slope and illumination analysis.`;
  $('location').textContent = `${Math.abs(cellData.center.latitude).toFixed(3)}° S · ${cellData.center.longitude_east.toFixed(3)}° E`;
  $('footSize').textContent = `${(cellData.width_m/1000).toFixed(0)} × ${(cellData.height_m/1000).toFixed(0)} KM · ORIGINAL ${cellData.native_resolution_m.toFixed(0)} M/PIXEL`;
  $('data-status').textContent = `${cellData.display_name || site.name} · NUMERIC LOCAL TOPOGRAPHY`;
  $('height').textContent = 'Move over the terrain';
  lastHoverIndex = null;
  horizonData=null;
  loadContextForSite(site.id);
  requestHorizon();
  const url = new URL(location.href);
  url.searchParams.set('site', site.id);
  history.replaceState({}, '', url);
  setSkyContext();
}

async function loadManifest(){
  const resp = await fetch('terrain-sites.json');
  if(!resp.ok) throw new Error(`HTTP ${resp.status}`);
  manifest = await resp.json();
  const select = $('siteSelect');
  manifest.sites.forEach(site => {
    const opt = document.createElement('option');
    opt.value = site.id;
    opt.textContent = `${site.name} · ${site.width_km}×${site.height_km} km`;
    select.appendChild(opt);
  });
  const initial = new URLSearchParams(location.search).get('site') || manifest.defaultSite;
  select.value = manifest.sites.some(s => s.id === initial) ? initial : manifest.defaultSite;
  await loadSite(select.value);
}

$('siteSelect').addEventListener('change', e => loadSite(e.target.value));
$('slope').onclick = () => { slopeEnabled = !slopeEnabled; $('slope').classList.toggle('selected', slopeEnabled); $('slope').setAttribute('aria-pressed', String(slopeEnabled)); updateTerrainColors(); };
$('shadow').onclick = () => { shadowEnabled = !shadowEnabled; $('shadow').classList.toggle('selected', shadowEnabled); $('shadow').setAttribute('aria-pressed', String(shadowEnabled)); updateTerrainColors(); };
$('wire').onclick = () => { wireEnabled = !wireEnabled; $('wire').classList.toggle('selected', wireEnabled); $('wire').setAttribute('aria-pressed', String(wireEnabled)); if(wire) wire.visible = wireEnabled; };
$('reset').onclick = () => {
  const fit = cellData ? Math.max(cellData.width_m/1000, cellData.height_m/1000) : 20;
  camera.position.set(0, fit * 1.0, fit * 1.45);
  controls.target.set(0, 0, 0);
  controls.update();
};
$('sunAzimuth').addEventListener('input', e => { params.sunAzimuth = Number(e.target.value); setSkyContext(); requestHorizon(); });
$('sunElevation').addEventListener('input', e => { params.sunElevation = Number(e.target.value); setSkyContext(); });
$('skyDate').addEventListener('change', e => { params.skyDate = e.target.value; setSkyContext(); });

renderer.domElement.addEventListener('pointermove', (e) => {
  if(!terrain || e.buttons) return;
  const r = renderer.domElement.getBoundingClientRect();
  mouse.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
  raycaster.setFromCamera(mouse, camera);
  const hit = raycaster.intersectObject(terrain, false)[0];
  if(!hit){ picker.visible = false; return; }
  picker.visible = true;
  picker.position.copy(hit.point);
  const dimX = cellData.width_m / 1000;
  const dimZ = cellData.height_m / 1000;
  const x = clamp(Math.round((hit.point.x / dimX + 0.5) * cols - 0.5), 0, cols - 1);
  const y = clamp(Math.round((hit.point.z / dimZ + 0.5) * rows - 0.5), 0, rows - 1);
  const i = y * cols + x;
  lastHoverIndex = i;
  const steep = Math.round(cellData.slope_gt10_fraction[i] * 100);
  const n = new THREE.Vector3(normals[i*3], normals[i*3+1], normals[i*3+2]);
  const sunDir = sunSceneDirection(params.sunAzimuth, params.sunElevation);
  const earthDir = earthBody.position.clone().normalize();
  const illum = Math.max(0, n.dot(sunDir));
  const visible=solarFraction(i);
  const earthLOS = n.dot(earthDir) > 0;
  $('height').textContent = `Elevation ${cellData.elevation_m[i].toFixed(1)} m · steep pixels ${steep}%`;
  $('analysis').textContent = `Sun visibility: ${visible===null?'local-only estimate':(visible>0.98?'visible':visible<0.02?'blocked by terrain':'partial solar disc')} · local incidence ${(illum*100).toFixed(0)}% · Earth ${earthLOS?'possible':'terrain-limited'} (approx.)`;
});

function animate(){ requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); }
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

loadManifest().then(animate).catch(err => { $('status').textContent = 'Could not load terrain data: ' + err.message; console.error(err); });
