// Guided demo of the landing page: a short story told with the page's own scene and data, no stand-in pictures.
// "Demo" on the title page (and in the header) starts it. A lander is to touch down on Connecting ridge near the
// lunar south pole; the launch slips by 90 days; the same spot is then dark. The demo shows why (the Earth hangs
// still in the lunar sky, the Sun circles low once per lunar day, the ground at the poles is rough) and ends at the
// question the tool answers. "Tutorial" walks through the controls instead; the user's hands stay free there
// (landing-tour.js; this file only runs the page's opening move for it and hands over).
//
// The demo is a director. It owns no model: each shot states what the page should show (clock, turn and zoom of
// the space, camera, surface, limits, time span, layers, terrain view) and may then play a move (a time-lapse, a
// flight). Because every shot states everything, any shot can be reached from any other (Back, Skip). While the
// demo runs the page's own controls are covered; its state from before is put back at the end.
//
// The landing spot of the story is a free point, not a listed site: 88.9481 S, 75.048 E, a plain 32 km from the
// south pole, 790 m below the reference sphere. It was found on 15 Nov 2026 by a search with core/ in Node over the
// LDEM64 ground near the pole for a place that is fully lit and in view of the Earth on a landing day and for the
// ten days after it, dark 90 days later, and then dark for as long as possible. Its numbers rest on the terrain
// block around it (data/terrain/demo.bin; LOLA LDEM64, 474 m), the same ground the terrain view draws, so the
// shadows seen and the hours counted agree.
// Dates: planned landing 7 Nov 2027 12:00 UTC, landing after the slip 5 Feb 2028 12:00 UTC (90 days later).
//
// Numbers in the texts: the hours until light returns, the length of the dark stretch, the distance to Shackleton
// rim and the shares of the Moon within the limits are read from the page's own calculation while the demo runs
// (core/visibility.js through landing.js, the line under the two limit sliders). The values that calculation gave
// on 15 Nov 2026: light returns after 4273 h (1 Aug 2028 12:32 UTC), dark since 13 Jan 2028, Shackleton rim 36 km
// away and in sunlight on 5 Feb 2028. Fixed in the text, from the same calculation: on a smooth sphere the spot
// would be in sunlight on 5 Feb 2028 (Sun 0.68 deg above the horizontal; the skyline there stands at 2.04 deg).

import { createTour } from './landing-tour.js';
import { dp } from './ui/scale.js';

const HOUR = 3600000, DAY = 24 * HOUR;
const PLAN = Date.UTC(2027, 10, 7, 12), SLIP = Date.UTC(2028, 1, 5, 12);
const MOON_DAY = 29.530589 * DAY, MONTH = 27.321661 * DAY;
const BATTERY_H = 6, LIMITS = { dark: 6, dte: 12 }, OFF = 97;           // OFF: the sliders' right end, "no limit"
const SITE = 'spot', OTHER = 'sh';                                       // the story's landing spot, the listed site it is compared with
const SPOT = { id: 'demo-spot', name: 'Demo landing site', lat: -88.9481, lon: 75.048 };
const NAMES = { spot: 'Our landing site', sh: 'Shackleton Rim' };
// Terrain view: where its camera stands, km east, up, south of the site. T_WIDE is the view it opens with.
const T_WIDE = [250, 170, 325], T_MID = [120, 84, 158], T_NEAR = [46, 34, 62];
const MOON_RADIUS_KM = 1737.4;
const CHAPTERS = ['The plan', 'The slip', 'The system', 'The terrain', 'Your turn'];
const rad = d => d * Math.PI / 180, shortWay = a => Math.atan2(Math.sin(a), Math.cos(a));
const inOut = p => p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2, soft = p => .5 - .5 * Math.cos(Math.PI * p), linear = p => p;
const longDay = ms => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const num = n => Math.round(n).toLocaleString('en-US');
const dayText = ms => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const stamp = ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const word = n => WORDS[n] ?? String(n);
const share = p => p >= 1 ? Math.round(p) + '\u00a0%' : p > 0 ? 'less than 1\u00a0%' : 'nothing';

export function createDemo(api) {
  const { THREE, hero, pivot, moon, reduce } = api;
  const $ = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

  // --- Elements -------------------------------------------------------------------------------------
  // Title page: the two ways in on the left of the Moon, what the tool is for on the right. Free type in the
  // face of the title, no boxes; an arrow before each word marks it as a way in.
  const start = $('div', 'demo-start', [['demo', 'DEMO'], ['tour', 'TUTORIAL']].map(([run, word]) => '<button type="button" class="demo-word" data-run="' + run + '"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 7h11M8 2.5 12.5 7 8 11.5"/></svg>' + word + '<span>.</span></button>').join(''));
  const intro = $('div', 'demo-intro', '<h2>The whole Moon, built from NASA laser altimetry.</h2><p>Every crater here is LOLA elevation data. We <span style="white-space:nowrap">ray-trace</span> the Sun and the Earth against that relief to show the true conditions at any landing site, on any date.</p><p class="demo-hint"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 7h11M8 2.5 12.5 7 8 11.5"/></svg>Hover for the elevation model, click to explore</p>');
  intro.tabIndex = 0; intro.setAttribute('role', 'button');     // pointer on it: elevation model; click: into the system view (landing.js)
  // While it runs: a shield over the page, the date, the battery with its counter, and the text with Back and Next.
  const root = $('div', 'demo-root'); root.hidden = true;
  root.innerHTML = '<div class="demo-shield"></div>'
    + '<div class="demo-tag" data-body="moon" hidden>Moon</div><div class="demo-tag" data-body="earth" hidden>Earth</div>'
    + ['Sun', 'Earth'].map(n => '<div class="demo-tag demo-way" data-way="' + n.toLowerCase() + '" hidden><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 7h10M8 3l4 4-4 4"/></svg><span>' + n + '</span></div>').join('')
    + '<div class="demo-tag" data-sky="sun" hidden>Sun</div><div class="demo-tag" data-sky="earth" hidden>Earth</div><div class="demo-tag bad" data-sky="block" hidden>This ridge blocks the Sun</div><div class="demo-tag" data-sky="lander" hidden>Lander</div>'
    + '<div class="demo-pulse"></div>'
    + '<div class="demo-date"><span class="demo-date-label"></span><strong class="demo-date-day"></strong></div>'
    + '<div class="demo-meter" hidden><div class="demo-batt"><i></i></div><span class="demo-batt-label">Battery, ' + BATTERY_H + ' h</span><strong class="demo-hours"></strong><span>without sunlight</span></div>'
    + '<section class="demo-panel" aria-label="Guided demo"><div class="demo-lead"><p class="demo-chapter"></p><h2 class="demo-head"></h2></div><div class="demo-body"><div class="demo-text" aria-live="polite"></div><dl class="demo-status"></dl><p class="demo-wait" hidden></p>'
    + '<div class="demo-nav"><button type="button" class="demo-back">Back</button><span class="demo-count"></span><button type="button" class="demo-next">Next</button></div>'
    + '<div class="demo-end" hidden><button type="button" class="demo-next" data-end="tour">Start the tutorial</button><button type="button" class="demo-back" data-end="free">Explore freely</button></div>'
    + '</div><button type="button" class="demo-skip"></button></section>';
  hero.append(start, intro, root);
  const el = Object.fromEntries(['shield', 'date', 'date-label', 'date-day', 'meter', 'hours', 'panel', 'chapter', 'head', 'text', 'status', 'wait', 'nav', 'count', 'end', 'skip']
    .map(k => [k.replace(/-(.)/g, (m, c) => c.toUpperCase()), root.querySelector('.demo-' + k)]));
  const pulseEl = root.querySelector('.demo-pulse'), battFill = root.querySelector('.demo-batt i'), backBtn = el.nav.querySelector('.demo-back'), nextBtn = el.nav.querySelector('.demo-next');
  // Nothing of the demo's own passes through to the scene below (drag, marker, zoom, values under the pointer).
  for (const box of [start, root]) for (const type of ['pointerdown', 'pointermove', 'click', 'wheel']) box.addEventListener(type, e => e.stopPropagation());

  // --- State ----------------------------------------------------------------------------------------
  let mode = null, list = null, index = -1, token = 0, saved = null, auto = false, terrainId = null, statusIds = [], statusAt = 0;
  let prep = Promise.resolve(), warm = false, warmAt = 0;       // what is got ready ahead of the coming shots (prepareAhead)
  const home = { tilt: pivot.rotation.x, yaw: pivot.rotation.y, t: api.now() };   // the title page as it stood when the page loaded
  const tweens = new Set();
  // Room for the text. The text takes ZONE of the hero's width at one side (the right, or the left when a shot says
  // at: 'left'), or lies across the bottom (at: 'bottom': the shots of the ground that have to show the Sun and the
  // Earth together, which stand far apart in the sky and need the whole width). The page centres its picture in what
  // is left (api.setInset), so what a shot is about stands free beside or above the text. The room opens, closes and changes sides gradually. In a narrow or upright window the text
  // lies across the bottom and the picture keeps the whole width.
  const ZONE = .44, narrow = matchMedia('(max-width:585px),(max-aspect-ratio:11/10)');
  const inset = { l: 0, r: 0, b: 0 }; let place = 'right', insetAt = 0, zoneW = '';
  function insetFrame(now) {
    const dt = Math.min(now - insetAt, 100); insetAt = now;
    const on = mode === 'demo' && !narrow.matches, z = on ? Math.round(hero.clientWidth * ZONE) : 0;
    const tl = place === 'left' ? z : 0, tr = place === 'right' ? z : 0, tb = on && place === 'bottom' ? el.panel.offsetHeight + 40 : 0;
    if (mode === 'demo') { const w = (!on ? hero.clientWidth : place === 'bottom' ? Math.round(hero.clientWidth * .5) : z) + 'px'; if (w !== zoneW) { zoneW = w; root.style.setProperty('--zone-w', w); } }
    if (inset.l === tl && inset.r === tr && inset.b === tb) return;
    const k = reduce.matches ? 1 : 1 - Math.exp(-dt / 260);
    inset.l += (tl - inset.l) * k; inset.r += (tr - inset.r) * k; inset.b += (tb - inset.b) * k;
    if (Math.abs(tl - inset.l) < .5) inset.l = tl;
    if (Math.abs(tr - inset.r) < .5) inset.r = tr;
    if (Math.abs(tb - inset.b) < .5) inset.b = tb;
    api.setInset(inset.l, inset.r, inset.b);
  }
  // what the texts say in numbers; the values here stand until the page's own calculation has given them (measure)
  const facts = { lightMs: SLIP + 4272.5 * HOUR, darkMs: Date.UTC(2028, 0, 13, 21), hours: 4273, days: 178, darkDays: 201, km: 36, sSun: null, sEarth: null, s24: null, s10: null, s30: null, step: 0 };
  { const la = SPOT.lat * Math.PI / 180, lo = SPOT.lon * Math.PI / 180;        // as a listed site carries it: sphere-local axes of the Moon mesh (landing-pins.js place)
    SPOT.local = new THREE.Vector3(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo)).multiplyScalar(api.R); }
  const site = id => id === SITE ? SPOT : api.pins.sites.find(s => s.id === id);

  /** fn(eased 0..1) every frame for ms; resolves true when done, false when another shot took over. */
  function tween(ms, fn, ease = inOut, always = false) {
    const my = token;
    return new Promise(done => {
      if (ms <= 0 || (reduce.matches && !always)) { fn(1); return done(true); }
      const t0 = performance.now();
      const step = now => {
        if (my !== token) { tweens.delete(step); return done(false); }
        const p = Math.min(Math.max((now - t0) / ms, 0), 1); fn(ease(p));
        if (p === 1) { tweens.delete(step); done(true); }
      };
      tweens.add(step);
    });
  }
  const wait = ms => tween(ms, () => {}, linear, true);
  /** Resolves true as soon as test() holds, false after the time is up or when another shot took over. */
  function until(test, ms = 20000) {
    const my = token, t0 = performance.now();
    return new Promise(done => {
      const step = now => { const ok = test(); if (ok || my !== token || now - t0 > ms) { tweens.delete(step); done(!!ok && my === token); } };
      tweens.add(step);
    });
  }

  // --- The page's own switches, set from here ----------------------------------------------------------
  const field = id => document.getElementById(id);
  function setSurface(mode) { const s = field('p-surface'); if (s.value !== mode) { s.value = mode; s.dispatchEvent(new Event('change')); } }
  function setLimits(lim) {
    for (const [id, v] of [['p-dark', lim ? lim.dark : OFF], ['p-dte', lim ? lim.dte : OFF]]) { const r = field(id); if (+r.value !== v) { r.value = v; r.dispatchEvent(new Event('input')); } }
  }
  function setSpan(span) { const cur = api.span(); if ((cur?.[0] ?? null) !== (span?.[0] ?? null) || (cur?.[1] ?? null) !== (span?.[1] ?? null)) api.setSpan(span?.[0] ?? null, span?.[1] ?? null); }
  const sideOpen = () => field('params').classList.contains('open');
  function setSide(on) { if (sideOpen() !== on) field('params-tab').click(); }
  const layerButton = name => document.querySelector('.param[data-param="' + name + '"]');
  const layerOn = name => layerButton(name)?.getAttribute('aria-pressed') === 'true';
  function setLayer(name, on) { if (layerButton(name) && layerOn(name) !== on) layerButton(name).click(); }
  function leaveTerrain() {
    if (api.scope() === 'terrain') api.closeTerrain();
    if (terrainId) { api.cards.close(terrainId); terrainId = null; }
  }
  const world = document.getElementById('world');
  /** Dip to black (as when the terrain view opens), do what changes the picture at once, come back. */
  async function cut(change) {
    world.classList.add('veil'); const ok = await wait(reduce.matches ? 0 : 320);
    if (ok) await change();
    world.classList.remove('veil');
    return ok;
  }
  /**
   * The share (per cent) the line under the limit sliders gives, or null while it is not there yet: for the window
   * that ends at endMs (null: the 24 h from the clock) and for the limits lim (both set, or one).
   */
  function areaShare(endMs, lim = LIMITS) {
    const t = field('p-area-note').textContent, m = /^(Under 0\.1|[\d.]+) % of the Moon stays within (both limits|the limit)/.exec(t);
    if (!m || (m[2] === 'both limits') !== (lim.dark !== OFF && lim.dte !== OFF)) return null;
    if (endMs ? !t.includes('to ' + stamp(endMs)) : !t.includes('in the 24 h from ' + stamp(Math.floor(api.now() / HOUR) * HOUR))) return null;
    return m[1] === 'Under 0.1' ? .05 : +m[1];
  }

  // --- Camera: turn, tilt and zoom of the space around the Moon ---------------------------------------
  /** Tilt and turn that bring a listed site to the middle of the picture (as pins.face does). */
  function facing(s) {
    const d = s.local.clone().applyQuaternion(moon.quaternion).normalize();
    return { yaw: -Math.atan2(d.x, d.z), tilt: THREE.MathUtils.clamp(Math.atan2(d.y, Math.hypot(d.x, d.z)), -Math.PI / 2, Math.PI / 2) };
  }
  /**
   * A camera of a shot as tilt, turn and zoom at the time t. The turn is given by what should stand where:
   * site: that site in the middle; earth / sun: the body at that many degrees round from "towards the camera"
   * (90 = to the right, 180 = straight behind the Moon); mid: the same for the direction half-way between Sun and
   * Earth; none of them: the turn stays as it is.
   */
  function resolve(c, t) {
    const az = api.azimuths(t);
    let tilt = c.tilt ?? 0, yaw = pivot.rotation.y;
    if (c.site) { const f = facing(site(c.site)); yaw = f.yaw; tilt = c.tilt ?? f.tilt; }
    else if (c.earth != null) yaw = rad(c.earth) - az.earth;
    else if (c.sun != null) yaw = rad(c.sun) - az.sun;
    else if (c.mid != null) yaw = rad(c.mid) - (az.sun + shortWay(az.earth - az.sun) / 2);
    else if (c.yaw != null) yaw = c.yaw;
    return { tilt, yaw, zoom: c.zoom ?? 0 };
  }
  function moveCam(c, t, ms = 1600, ease = inOut) {
    const r = pivot.rotation, to = resolve(c, t), x0 = r.x, y0 = r.y, dy = shortWay(to.yaw - y0), k0 = api.zoom();
    api.halt();
    if (Math.abs(to.tilt - x0) + Math.abs(dy) + Math.abs(to.zoom - k0) < 1e-4) return Promise.resolve(true);
    return tween(ms, e => { r.x = x0 + (to.tilt - x0) * e; r.y = y0 + dy * e; api.setZoom(k0 + (to.zoom - k0) * e); }, ease);
  }
  /**
   * Terrain view: where the camera has to stand so that the Sun and the Earth are both in the picture beside the
   * text, as close to the site as that allows. It looks along the direction half-way between the two.
   */
  function skyCam() {
    const t = api.terrain, { sun, earth } = t.bodies, tg = t.controls.target;
    if (!sun || !earth) return T_NEAR;
    const a = new V3(sun.x - tg.x, 0, sun.z - tg.z).normalize(), b = new V3(earth.x - tg.x, 0, earth.z - tg.z).normalize(), mid = a.clone().add(b);
    if (mid.lengthSq() < 1e-3) mid.set(-a.z, 0, a.x);
    mid.normalize();
    const cam = t.camera.clone(), w = world.clientWidth, h = world.clientHeight, left = hero.getBoundingClientRect().left - world.getBoundingClientRect().left;
    const x0 = left + inset.l + 150, x1 = left + hero.clientWidth - inset.r - 120, y0 = 160, y1 = (h - inset.b) * .72;
    let p = T_NEAR;
    for (let d = 56; d < 560; d *= 1.08) {
      p = [-mid.x * d, d * .44, -mid.z * d];
      cam.position.set(tg.x + p[0], tg.y + p[1], tg.z + p[2]); cam.lookAt(tg); cam.updateMatrixWorld(); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
      if ([sun, earth].every(o => { C.copy(o).project(cam); const sx = (C.x + 1) / 2 * w, sy = (1 - C.y) / 2 * h; return C.z < 1 && sx > x0 && sx < x1 && sy > y0 && sy < y1; })) break;
    }
    return p;
  }
  /** moveTcam, or for 'sky' to where skyCam says. The sky of the open ground and the room for the text are set a few frames after a shot begins: wait for them. */
  async function toTcam(p, ms) { api.terrain.setSkyFit(p === 'sky'); if (p === 'sky') { if (!await wait(450)) return false; p = skyCam(); } return moveTcam(p, ms); }
  /** Terrain view: the camera goes to p (km east, up, south of the site), around the site and towards or away from it. */
  function moveTcam(p, ms = 2400, ease = inOut) {
    const c = api.terrain.camera, tg = api.terrain.controls.target, v = new THREE.Vector3();
    const a = new THREE.Spherical().setFromVector3(v.copy(c.position).sub(tg)), b = new THREE.Spherical().setFromVector3(v.set(...p));
    const dth = shortWay(b.theta - a.theta);
    if (Math.abs(dth) + Math.abs(b.phi - a.phi) + Math.abs(b.radius / a.radius - 1) < 1e-3) return Promise.resolve(true);
    return tween(ms, e => { c.position.copy(tg).add(v.setFromSphericalCoords(a.radius * Math.pow(b.radius / a.radius, e), a.phi + (b.phi - a.phi) * e, a.theta + dth * e)); }, ease);
  }

  // --- Camera away from the Moon ------------------------------------------------------------------------
  // The page's camera always looks at the Moon from one axis. For the shots at the Earth and of the whole system
  // the demo takes the camera over (rig): a pose is a point looked at and the camera's offset from it, stated
  // relative to the bodies as they stand, so it follows them through a time-lapse. Between two poses the
  // looked-at point moves straight, the offset turns and its length changes by equal factors (so a flight from
  // the Earth to the Moon slows down as the Moon comes close). The pose "null" is the page's own: on the axis, at the Moon.
  // Pose on the Earth-Moon line:
  //   around / look: the point the camera stands off from / looks at, 0 = Earth ... 1 = Moon
  //   dist: scene units (Moon radius = R); az: degrees round from "behind the Earth as seen from the Moon";
  //   el: degrees above the Earth-Moon line; side: which of +az and -az, decided once when the move starts:
  //   'lit' = where the Sun shines on what is seen, 'dark' = the other (the Sun is then ahead, in the picture or
  //   near it), 'left' = the one that puts the Earth left in the picture
  // Pose behind the Earth on its way round the Sun (chase): the camera trails the Earth, chase degrees round
  //   towards the Sun from "straight behind", el degrees to the north. The frame is the Sun's: the Sun keeps its
  //   place, the stars pass by a quarter turn in three months, the Moon goes round the Earth.
  // shift (both): the view is turned right by this share of the distance. Not used at present: the page centres the
  //   picture in the room beside the text (insetFrame).
  const V3 = THREE.Vector3, E = new V3(), S = new V3(), f = new V3(), u = new V3(), r = new V3(), fw = new V3(), q = new THREE.Quaternion(), q2 = new THREE.Quaternion();
  let rig = null;                                                 // { from(), to(), e } while the demo holds the camera
  const ownPose = () => ({ target: new V3(), offset: new V3(0, 0, api.restDistance()) });
  function poseOf(p) {
    api.earth.getWorldPosition(E); api.sun.getWorldPosition(S).normalize();
    let target, stand;
    if (p.chase != null) {
      // lunar north is within 1.6 degrees of the normal of the plane the Sun moves in; the Earth's way round the Sun is north x (Sun -> Earth)
      u.set(0, 1, 0).applyQuaternion(moon.getWorldQuaternion(q2)).normalize(); f.crossVectors(S, u).normalize();      // f: against the Earth's way
      const a = rad(p.chase), el = rad(p.el ?? 0);
      stand = new V3().copy(f).multiplyScalar(Math.cos(a)).addScaledVector(S, Math.sin(a)).multiplyScalar(Math.cos(el)).addScaledVector(u, Math.sin(el)).multiplyScalar(p.dist).add(E);
      target = new V3().copy(E);
    } else {
      f.copy(E).negate().normalize(); u.set(0, 1, 0).addScaledVector(f, -f.y).normalize(); r.crossVectors(f, u);
      const az = rad(p.az), el = rad(p.el ?? 0);
      const at = new V3().copy(f).multiplyScalar(-Math.cos(az)).addScaledVector(r, Math.sin(az)).multiplyScalar(Math.cos(el)).addScaledVector(u, Math.sin(el));
      target = new V3().copy(E).multiplyScalar(1 - (p.look ?? 0));
      stand = new V3().copy(E).multiplyScalar(1 - (p.around ?? 0)).addScaledVector(at, p.dist);
    }
    if (p.shift) { fw.copy(target).sub(stand); const d = fw.length(); target.addScaledVector(fw.normalize().cross(u).normalize(), p.shift * d); }
    return { target, offset: stand.sub(target) };
  }
  /** The pose with its side decided for the bodies as they stand now (so it does not change sides during a time-lapse). */
  function settle(p) {
    if (!p || !p.side) return p;
    const plus = { ...p, side: null, shift: 0 }, minus = { ...plus, az: -p.az }, a = poseOf(plus), b = poseOf(minus);
    api.earth.getWorldPosition(E); api.sun.getWorldPosition(S).normalize();
    const sunward = o => fw.copy(o.offset).normalize().dot(S);                          // how far the camera stands towards the Sun
    const earthRight = o => { const cam = new V3().copy(o.target).add(o.offset); return fw.copy(o.target).sub(cam).cross(new V3(0, 1, 0)).dot(new V3().copy(E).sub(cam)); };
    const useMinus = p.side === 'lit' ? sunward(b) > sunward(a) : p.side === 'dark' ? sunward(b) < sunward(a) : earthRight(b) < earthRight(a);
    return { ...p, side: null, az: useMinus ? -p.az : p.az };
  }
  function blend(a, b, e) {
    const la = a.offset.length(), lb = b.offset.length(), da = fw.copy(a.offset).divideScalar(la), db = new V3().copy(b.offset).divideScalar(lb);
    q.setFromUnitVectors(da, db); q.slerp(new THREE.Quaternion(), 1 - e);                   // part of the turn from a to b
    return { target: new V3().lerpVectors(a.target, b.target, e), offset: new V3().copy(da).applyQuaternion(q).multiplyScalar(la * Math.pow(lb / la, e)) };
  }
  const rigPose = () => rig.path ? rig.path(rig.e) : rig.e >= 1 ? rig.to() : rig.e <= 0 ? rig.from() : blend(rig.from(), rig.to(), rig.e);
  /** Take the camera to a pose (null: back onto the page's axis) in ms. */
  function rigTo(p, ms = 2400, ease = inOut) {
    if (!rig && !p) return Promise.resolve(true);
    if (rig && p && rig.spec === p && rig.e >= 1) return Promise.resolve(true);       // it stands there already
    let from = ownPose;
    if (rig) { if (rig.e >= 1 && !rig.path) from = rig.to; else { const now = rigPose(); from = () => now; } }
    const to = settle(p);
    rig = { from, to: to ? () => poseOf(to) : ownPose, e: 0, spec: p };
    document.body.classList.add('demo-far');
    return tween(ms, e => { rig.e = e; }, ease).then(ok => { if (ok && !p) dropRig(); return ok; });
  }
  /** Take the camera along a way: fn(0..1) gives the pose. The first fifth leads over from where the camera stands. */
  function rigPath(fn, ms, ease = inOut, onStep = null) {
    const start = rig ? rigPose() : ownPose(), lead = .2;
    rig = { from: () => start, to: () => fn(1), e: 0, spec: null, path: e => e < lead ? blend(start, fn(e), soft(e / lead)) : fn(e) };
    document.body.classList.add('demo-far');
    return tween(ms, e => { rig.e = e; onStep?.(e); }, ease).then(ok => { if (ok) rig.path = null; return ok; });
  }
  function dropRig() { if (!rig) return; rig = null; document.body.classList.remove('demo-far'); api.releaseCamera(); }
  function rigFrame() {
    const { camera } = api, p = rigPose();
    camera.position.copy(p.target).add(p.offset); camera.up.set(0, 1, 0); camera.lookAt(p.target); camera.updateMatrixWorld();
  }

  // --- The way from the Earth to the south pole ---------------------------------------------------------
  // One line, drawn behind the camera as it flies from the Earth to the Moon's south pole (the second shot). It is a
  // sketch of the trip, not a calculated trajectory: a smooth curve from the side of the Earth that faces the Moon
  // to the pole, arriving from the south. It hangs in the turning space like the bodies.
  let trail = null;
  function buildTrail() {
    if (trail) return trail;
    const e = api.earth.position.clone(), d = e.length(), toMoon = e.clone().negate().normalize();
    const north = new V3(0, 1, 0).applyQuaternion(moon.quaternion), south = north.clone().negate(), side = new V3().crossVectors(toMoon, north).normalize();
    const pole = south.clone().multiplyScalar(api.R * 1.01);
    const p0 = e.clone().addScaledVector(toMoon, api.EARTH_R * 1.02);
    const p1 = e.clone().addScaledVector(toMoon, d * .36).addScaledVector(north, d * .1).addScaledVector(side, d * .06);
    const p2 = pole.clone().addScaledVector(south, d * .16).addScaledVector(toMoon, -d * .1);
    const curve = new THREE.CubicBezierCurve3(p0, p1, p2, pole), n = 240;
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(n)), new THREE.LineBasicMaterial({ color: 0xeceef1, transparent: true, opacity: .9 }));
    line.frustumCulled = false; line.visible = false; pivot.add(line);
    return trail = { line, curve, n, north };
  }
  // The lander at the head of the line while it is drawn: a plain model (body, four legs, engine, dish), not a
  // particular spacecraft and far larger than true, so that it can be seen at all: it keeps about the same size in
  // the picture all the way. It flies engine first for the last part, as for a landing.
  let lander = null;
  function buildLander() {
    if (lander) return lander;
    const g = new THREE.Group(), mat = (color, emissive) => new THREE.MeshStandardMaterial({ color, emissive, roughness: .6, metalness: .3 });
    const foil = mat(0xd2b46a, 0x4a3c18), grey = mat(0xd9dde3, 0x3a3d42), dark = mat(0x6d727a, 0x1c1e22);
    const add = (geo, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); g.add(o); return o; };
    add(new THREE.CylinderGeometry(.62, .62, .5, 8), foil);                                   // descent stage
    add(new THREE.CylinderGeometry(.34, .46, .46, 8), grey, 0, .48);                          // upper stage
    add(new THREE.CylinderGeometry(.16, .34, .34, 16, 1, true), dark, 0, -.42).material.side = THREE.DoubleSide;   // engine bell
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + i * Math.PI / 2, cx = Math.cos(a), cz = Math.sin(a);
      const leg = add(new THREE.CylinderGeometry(.035, .035, .95, 6), grey, cx * .78, -.42, cz * .78); leg.rotation.set(cz * .62, 0, -cx * .62);
      add(new THREE.CylinderGeometry(.15, .15, .04, 12), grey, cx * 1.05, -.82, cz * 1.05);    // foot pad
    }
    const dish = add(new THREE.SphereGeometry(.26, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.6), grey, .34, .86, 0); dish.rotation.z = Math.PI + .5; dish.material = grey.clone(); dish.material.side = THREE.DoubleSide;
    add(new THREE.CylinderGeometry(.02, .02, .3, 6), grey, .3, .74, 0);
    g.visible = false; pivot.add(g);
    return lander = g;
  }
  const UP = new V3(0, 1, 0), aim = new V3();
  /** The lander at the share u of the way (null: away). */
  function showLander(u) {
    if (u == null) { if (lander) lander.visible = false; return; }
    buildTrail(); buildLander();
    const T = trail.curve.getTangent(u).normalize(), k = Math.pow(1 - u, 1.5), turn = THREE.MathUtils.smoothstep(u, .72, .9);
    lander.position.copy(trail.curve.getPoint(u));
    lander.quaternion.setFromUnitVectors(UP, aim.copy(T).multiplyScalar(1 - 2 * turn).addScaledVector(trail.north, turn > 0 && turn < 1 ? .02 + Math.sin(turn * Math.PI) : 0).normalize());
    lander.scale.setScalar(Math.hypot(70 * k + 5, 24 * k + .6) * .05 * (1 - .45 * u * u));
    lander.visible = true;
  }
  const showTrail = part => { if (!trail && part == null) return; buildTrail(); trail.line.visible = part != null; if (part != null) trail.line.geometry.setDrawRange(0, Math.max(2, Math.ceil(part * trail.n) + 1)); };
  /** The camera behind the head of the line at the share u of the way: far behind and above at the Earth, close at the pole. */
  function trailPose(u) {
    const head = trail.curve.getPoint(u), T = trail.curve.getTangent(u).normalize(), N = trail.north.clone().addScaledVector(T, -trail.north.dot(T)).normalize();
    const k = Math.pow(1 - u, 1.5), cam = head.clone().addScaledVector(T, -(70 * k + 5)).addScaledVector(N, 24 * k + .6), target = head.clone().addScaledVector(T, 30 * k + 1.5);
    pivot.updateMatrixWorld(); cam.applyMatrix4(pivot.matrixWorld); target.applyMatrix4(pivot.matrixWorld);
    return { target, offset: cam.sub(target) };
  }

  // --- Names in the picture -----------------------------------------------------------------------------
  // "Moon" and "Earth" under the bodies while they are small; for the Sun and the Earth an arrow at the edge of the
  // free part of the picture (the text stands on the right) while they are outside it, so the geometry of a shot
  // can be read: where the light comes from, where the Earth is. Not in the terrain view, which shows both itself.
  const tags = [...root.querySelectorAll('.demo-tag[data-body]')].map(el => ({ el, body: el.dataset.body === 'moon' ? moon : api.earth, radius: el.dataset.body === 'moon' ? api.R : api.EARTH_R }));
  const ways = [...root.querySelectorAll('.demo-way')].map(el => ({ el, arrow: el.firstChild, body: el.dataset.way === 'sun' ? api.sun : api.earth, named: el.dataset.way === 'sun' }));
  const C = new V3(), legendEl = document.querySelector('.legend');      // the colour scale of a surface stands bottom left: the arrows keep above it
  function hideNames() { tags.forEach(t => { t.el.hidden = true; }); ways.forEach(w => { w.el.hidden = true; }); landerTag.hidden = true; }
  // Terrain view: "Sun" and "Earth" at the two bodies, and the name of what is marked in red.
  const skyTags = Object.fromEntries([...root.querySelectorAll('.demo-tag[data-sky]')].map(e => [e.dataset.sky, e])), landerTag = skyTags.lander;
  let blocked = null;                                            // what keeps the Sun from the site, while it is marked (terrain.setAlarm)
  function hideSky() { skyTags.sun.hidden = skyTags.earth.hidden = skyTags.block.hidden = true; }
  function put(el, v, cam, dy, above = false) {
    C.copy(v).project(cam);
    const W = world.clientWidth, left = hero.getBoundingClientRect().left - world.getBoundingClientRect().left, on = C.z < 1 && Math.abs(C.x) < 1 && Math.abs(C.y) < 1;
    el.hidden = !on;
    if (on) el.style.transform = 'translate(' + Math.round((C.x + 1) / 2 * W - left) + 'px,' + Math.round((1 - C.y) / 2 * hero.clientHeight + dy) + 'px) translate(-50%,' + (above ? '-100%' : '0') + ')';
  }
  function skyFrame() {
    const t = api.terrain, cam = t.camera, { sun, earth } = t.bodies;
    if (!sun || !earth || !t.block) return hideSky();
    cam.updateMatrixWorld(); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    const k = hero.clientHeight / (2 * Math.tan(rad(cam.fov / 2)));           // px per unit at distance 1
    put(skyTags.sun, sun, cam, 12 / cam.position.distanceTo(sun) * k + 8); put(skyTags.earth, earth, cam, 13 / cam.position.distanceTo(earth) * k + 8);
    if (blocked) put(skyTags.block, blocked.point, cam, -24, true); else skyTags.block.hidden = true;
  }
  function nameFrame() {
    const { camera } = api, h = hero.clientHeight, w = hero.clientWidth, k = h / (2 * Math.tan(rad(camera.fov / 2)));
    // the picture covers the whole window, the hero only the part beside the sidebar: positions are taken in the window and counted from the hero's left edge
    const W = world.clientWidth, left = hero.getBoundingClientRect().left - world.getBoundingClientRect().left;
    camera.updateMatrixWorld(); camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    for (const t of tags) {
      t.body.getWorldPosition(E); const d = E.distanceTo(camera.position), px = t.radius / d * k;
      E.project(camera);
      const on = px < 90 * dp() && E.z < 1 && Math.abs(E.x) < 1 && Math.abs(E.y) < 1;
      t.el.hidden = !on;
      if (on) t.el.style.transform = 'translate(' + Math.round((E.x + 1) / 2 * W - left) + 'px,' + Math.round((1 - E.y) / 2 * h + px + 10 * dp()) + 'px) translateX(-50%)';
    }
    if (lander?.visible) { lander.getWorldPosition(E); put(landerTag, E, camera, lander.scale.x * 1.1 / E.distanceTo(camera.position) * k + 10 * dp()); } else landerTag.hidden = true;
    const q = dp(), x0 = 80 * q + inset.l, x1 = w - inset.r - 40 * q, y0 = 104 * q, y1 = h - inset.b - 40 * q - (narrow.matches ? el.panel.offsetHeight + 16 * q : legendEl && !legendEl.hidden ? legendEl.offsetHeight + 24 * q : 0), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    for (const wy of ways) {
      wy.body.getWorldPosition(E); C.copy(E).applyMatrix4(camera.matrixWorldInverse); E.project(camera);
      const sx = (E.x + 1) / 2 * W - left, sy = (1 - E.y) / 2 * h, inside = C.z < 0 && sx > x0 && sx < x1 && sy > y0 && sy < y1;
      wy.el.hidden = inside && !wy.named; wy.el.classList.toggle('there', inside);
      if (inside) { if (wy.named) wy.el.style.transform = 'translate(' + Math.round(sx) + 'px,' + Math.round(sy + 26 * dp()) + 'px) translateX(-50%)'; continue; }
      let dx = C.z < 0 ? sx - cx : C.x, dy = C.z < 0 ? sy - cy : -C.y; const n = Math.hypot(dx, dy) || 1; dx /= n; dy /= n;
      const t = Math.min(dx > 0 ? (x1 - cx) / dx : dx < 0 ? (x0 - cx) / dx : Infinity, dy > 0 ? (y1 - cy) / dy : dy < 0 ? (y0 - cy) / dy : Infinity);
      wy.el.style.transform = 'translate(' + Math.round(cx + dx * t) + 'px,' + Math.round(cy + dy * t) + 'px) translate(-50%,-50%)';
      wy.arrow.style.transform = 'rotate(' + Math.round(Math.atan2(dy, dx) * 180 / Math.PI) + 'deg)';
    }
  }

  /** Time-lapse: the clock runs to toMs in ms. */
  async function lapse(toMs, ms, ease = soft) {
    const from = api.now();
    const ok = await tween(ms, e => api.scrubTime(from + (toMs - from) * e), ease);
    if (ok) api.setTime(toMs);
    return ok;
  }

  // --- Shots ------------------------------------------------------------------------------------------
  // A shot: ch chapter, text (string or facts => string), label over the date, t clock at its start, and what the
  // page shows: cam (turn, tilt, zoom of the space), rig (camera away from the Moon), surface, limits, span, side
  // (sidebar open), sites (pins), status (sites whose Sun and Earth are told under the text), meter (battery and
  // counter), terrain (site whose ground is open) with tcam.
  // Everything not named is off. play(h): the move of the shot, after the page stands as stated.
  const ER = api.EARTH_R;
  const AT_EARTH = { around: 0, look: 0, dist: 5.4 * ER, az: 24, el: 10, side: 'lit' };       // the Earth close, left of the middle
  const SYSTEM = { around: .5, look: .5, dist: 50 * ER, az: 90, el: 35, side: 'lit' };      // Earth and Moon side by side, from their day side
  const SYSTEM_SUN = { around: .5, look: .5, dist: 46 * ER, az: 90, el: 20, side: 'dark' }; // the same from the night side: the Sun passes through the picture
  const AIM = { around: 0, look: 1, dist: 6 * ER, az: 22, el: 7, side: 'left' };                          // past the Earth, towards the Moon
  const CHASE = { chase: 35, dist: 6 * ER, el: 12 };                                           // behind the Earth on its way round the Sun
  const EARTH_SIDE = { earth: 205, tilt: .12 };                    // the Earth in the distance, left of the Moon
  const POLE = { site: SITE, zoom: .3 };                           // the landing spot in the middle, the whole Moon in the picture
  const NEAR_SIDE = { earth: 10, tilt: .1, zoom: .1 };             // the side of the Moon that faces the Earth
  // The south pole from above, the direction half-way between Sun and Earth to the left: the half of the Moon each of
  // them sees is half of the disc, their overlap a wedge between the two arrows that point to them.
  const BOTH = { mid: -90, tilt: -Math.PI / 2 };
  const flyToSite = h => Promise.all([h.cam(POLE, 5200), h.rig(null, 5200)]).then(r => r.every(Boolean));
  /** One limit or both on, wait until the Moon is marked for it; the share in per cent, or null when another shot took over. */
  async function mark(h, lim, endMs = null) {
    setLimits(lim); h.waiting('Calculating the area …');
    if (!await until(() => areaShare(endMs, lim) != null)) return null;
    h.waiting(''); return areaShare(endMs, lim);
  }
  const DEMO = [
    { ch: 0, label: 'Planned landing', t: PLAN, cam: { ...EARTH_SIDE, zoom: 0 }, rig: AT_EARTH, rigMs: 4200,
      head: 'A <i>lander</i> for the lunar south pole.', text: 'The mission starts on <i>Earth</i>. The <i>Moon</i> is on average 384,400 km away.' },
    { ch: 0, label: 'Planned landing', t: PLAN, cam: { ...EARTH_SIDE, zoom: 0 }, rig: AT_EARTH, trail: 'draw',
      head: 'The <i>lander</i> flies to the Moon’s south pole.', text: 'Goal: water ice. To operate there, the <i>lander</i> needs two things: <i>sunlight</i> for power and a line of sight to <i>Earth</i> for direct-to-Earth (DTE) communication.',
      async play(h) {                                              // the trip, with a line drawn behind the camera; then back out to see all of it
        showTrail(0);
        if (await rigPath(trailPose, 7000, inOut, u => { showTrail(u); showLander(u); }) && await h.wait(1600)) { showLander(null); await h.rig(SYSTEM, 4200); }
      } },
    { ch: 0, label: 'Planned landing', t: PLAN, cam: { ...EARTH_SIDE, zoom: 0 }, rig: SYSTEM, rigMs: 3200, sites: [SITE], trail: true,
      head: 'Landing: ' + longDay(PLAN) + '.', text: 'The <i>landing site</i> is a plain 32 km from the south pole, at 88.95° S, 75.05° E.',
      play: flyToSite },
    { ch: 0, label: 'Planned landing', t: PLAN, cam: POLE, sites: [SITE], status: [SITE], terrain: SITE, tcam: 'sky',
      head: 'On that day, both conditions hold.', text: 'The <i>Sun</i> is above the terrain horizon and <i>Earth</i> is in view. The dashed lines run from the site to both.' },

    { ch: 1, label: 'Planned landing', t: PLAN, cam: { ...EARTH_SIDE, zoom: 0 }, rig: CHASE, rigMs: 3000,
      head: 'The launch slips by 90 days.', text: 'In that time <i>Earth</i> covers a quarter of its orbit around the Sun, and the <i>Moon</i> circles Earth about three times.',
      async play(h) { if (!await h.wait(900)) return; h.label('Launch delayed'); if (await lapse(SLIP, 6500, inOut)) h.label('New landing day, 90 days later'); } },
    { ch: 1, label: 'New landing day, 90 days later', t: SLIP, cam: { ...EARTH_SIDE, zoom: 0 }, rig: CHASE, rigMs: 2600, sites: [SITE], status: [SITE],
      key: 'The core problem',                                    // the shot the whole tool is about: marked as a warning, larger, with the two landing days side by side
      head: '90 days later, the same site is <em>dark.</em>', text: '<b>This is the problem the tool addresses.</b> After the slip the <i>Sun</i> stands behind the <em>ridge marked in red</em>. No sunlight, no power.',
      opens: SITE, alarm: true, async play(h) { if (await flyToSite(h) && await h.terrain(SITE, 'sky')) h.alarm(); } },
    { ch: 1, label: 'Waiting for sunlight', t: SLIP, cam: POLE, sites: [SITE], status: [SITE], meter: true, terrain: SITE, tcam: T_WIDE,
      head: f => num(f.hours) + ' hours without sunlight.', text: f => 'Sunlight returns after <b>' + f.days + ' days</b>' + (f.days > 60 ? ', about ' + word(Math.round(f.days / 30.44)) + ' months' : '') + '. The battery covers ' + BATTERY_H + ' hours.',
      async play(h) { if (await h.wait(700) && await lapse(SLIP + BATTERY_H * HOUR, 1800, linear)) await lapse(facts.lightMs, 6000, soft); } },

    { ch: 2, label: 'Time-lapse, one lunar day', t: SLIP, cam: { ...EARTH_SIDE, zoom: 0 }, rig: SYSTEM_SUN, rigMs: 3200,
      head: 'Why? Earth stays, the Sun moves.', text: 'The Moon is tidally locked: seen from its surface, <i>Earth</i> stays almost fixed in the sky. The <i>Sun</i> completes one circuit every 29.5 days.',
      play: () => lapse(SLIP + MOON_DAY, 9000) },
    { ch: 2, label: 'New landing day', t: SLIP, cam: { ...EARTH_SIDE, zoom: 0 }, rig: AIM, rigMs: 2600, surface: 'earth',
      head: 'Only the near side sees Earth.', text: 'The <i>Moon</i> always turns the same face to <i>Earth</i>. Direct-to-Earth (DTE) communication is possible only from this hemisphere.',
      play: h => Promise.all([h.cam(NEAR_SIDE, 5200), h.rig(null, 5200)]) },                                      // along the radio link to the side that faces the Earth
    { ch: 2, label: 'New landing day', t: SLIP, cam: NEAR_SIDE, surface: 'earth',
      head: 'At the limb and the poles, Earth sits on the horizon.', text: 'The far side never has a DTE link. Near the limb, a single hill can block it.',
      play: h => h.cam({ earth: -90, tilt: .1, zoom: .1 }, 3600) },                                               // round to the edge of that side
    { ch: 2, label: 'Time-lapse, four days', t: SLIP, cam: { sun: 222, tilt: -.2, zoom: -.65 },
      head: 'At the poles, the Sun stays low.', text: 'The Moon’s spin axis is tilted only 1.5° from the ecliptic normal. Seen from the poles, the <i>Sun</i> skims the horizon all year.',
      play: () => lapse(SLIP + 4 * DAY, 5000, linear) },                                                          // ends as the Sun comes out from behind the Moon, clear of the text
    { ch: 2, label: 'Time-lapse, one lunar day', t: SLIP, cam: { tilt: -Math.PI / 2, zoom: 0 },
      head: 'Day and night rotate around the pole.', text: 'The south pole from above, over one lunar day. The pole always lies close to the terminator, the line between day and night.',
      play: () => lapse(SLIP + MOON_DAY, 8000, linear) },

    // The two limits, one change per shot: first the control is outlined, then it moves, then a ring round the Moon
    // says that the green area has changed, then the number is in the text.
    { ch: 2, label: 'New landing day', t: SLIP, cam: { ...BOTH, zoom: -.2 }, side: true, spot: ['p-dark', 'p-dte'],
      head: 'Two mission limits.', text: 'At most 6 hours without sunlight, at most 12 hours without a DTE link. The two sliders on the left set them. The arrows point to the Sun and to Earth.' },
    { ch: 2, label: 'The 24 hours from', t: SLIP, cam: { ...BOTH, zoom: -.2 }, side: true,
      head: 'Limit 1: darkness.', text: f => f.sSun == null ? 'Watch the slider “Max. eclipse”, then the Moon.' : 'Green: never dark for more than 6 hours in these 24 hours. That is <b>' + share(f.sSun) + '</b> of the Moon, the hemisphere facing the Sun.',
      async play(h) {
        facts.sSun = null; h.text();
        if (await h.slide('p-dark', LIMITS.dark)) { const v = await mark(h, { dark: LIMITS.dark, dte: OFF }); if (v != null) { facts.sSun = v; h.pulse(); h.text(); } }
      } },
    { ch: 2, label: 'The 24 hours from', t: SLIP, cam: { ...BOTH, zoom: -.2 }, side: true, limits: { dark: LIMITS.dark, dte: OFF },
      head: 'Limit 2: DTE outage.', text: f => f.sEarth == null ? 'The first slider returns to “Off”. Watch “Max. DTE outage”, then the Moon.' : 'Green: no DTE outage longer than 12 hours. That is <b>' + share(f.sEarth) + '</b>, the hemisphere facing Earth.',
      async play(h) {
        facts.sEarth = null; h.text();
        if (await h.slide('p-dark', OFF, 900) && await h.slide('p-dte', LIMITS.dte)) { const v = await mark(h, { dark: OFF, dte: LIMITS.dte }); if (v != null) { facts.sEarth = v; h.pulse(); h.text(); } }
      } },
    { ch: 2, label: 'The 24 hours from', t: SLIP, cam: { ...BOTH, zoom: -.2 }, side: true, limits: { dark: OFF, dte: LIMITS.dte },
      head: 'The lander needs both.', text: f => f.s24 == null ? 'Watch the first slider return.' : 'Only the overlap qualifies: <b>' + share(f.s24) + '</b> of the Moon in these 24 hours.',
      async play(h) {
        facts.s24 = null; h.text();
        if (await h.slide('p-dark', LIMITS.dark)) { const v = await mark(h, LIMITS); if (v != null) { facts.s24 = v; h.pulse(); h.text(); } }
      } },
    { ch: 2, label: 'The 24 hours from', t: SLIP, cam: { ...BOTH, zoom: -.2 }, side: true, limits: LIMITS, spanRow: true,
      head: 'A mission lasts longer than a day.', text: f => f.s10 == null ? 'Watch “Start” and “Stop” below, then the Moon.' : 'Over 10 days, <b>' + share(f.s10) + '</b> of the Moon remains.',
      async play(h) {
        facts.s10 = null; h.text(); h.spot('.tb-span');
        if (!await h.wait(1500)) return;
        setSpan([SLIP, SLIP + 10 * DAY]); h.label('Mission of 10 days from');
        const v = await mark(h, LIMITS, SLIP + 10 * DAY); if (v != null) { facts.s10 = v; h.pulse(); h.text(); }
      } },
    { ch: 2, label: 'Mission of 10 days from', t: SLIP, cam: { ...BOTH, zoom: -.2 }, side: true, limits: LIMITS, spanRow: true, span: [SLIP, SLIP + 10 * DAY],
      head: 'And over 30 days?', text: f => f.s30 == null ? 'Watch “Stop” again.' : f.s30 > 0 ? '<b>' + share(f.s30) + '</b> of the Moon remains.' : '<b>Nothing remains.</b> On this 7.6 km grid, no location stays within both limits for 30 days.',
      async play(h) {
        facts.s30 = null; h.text(); h.spot('.tb-span');
        if (!await h.wait(1500)) return;
        setSpan([SLIP, SLIP + 30 * DAY]); h.label('Mission of 30 days from');
        const v = await mark(h, LIMITS, SLIP + 30 * DAY); if (v != null) { facts.s30 = v; h.pulse(); h.text(); }
      } },

    { ch: 3, label: 'New landing day', t: SLIP, cam: { site: SITE, zoom: .45 }, surface: 'elevation', sites: [SITE],
      head: 'Polar terrain is rugged.', text: 'That map was coarse: 7.6 km per cell. At the south pole, craters several kilometers deep lie next to sharp ridges.' },
    { ch: 3, label: 'Time-lapse, four days in January', t: f => f.darkMs - 3.5 * DAY, cam: POLE, terrain: SITE, tcam: 'sky', span: [SLIP, SLIP + 10 * DAY], status: [SITE],
      head: 'Shadows many kilometers long.', text: 'Elevation from NASA’s LOLA laser altimeter. With the Sun barely above the horizon, every ridge casts a long shadow. In January 2028 the shadows reach the landing site (white mast).',
      async play(h) { if (await h.wait(1200)) await lapse(facts.darkMs + .75 * DAY, 10000, linear); } },
    { ch: 3, label: 'Ten days from the landing', t: SLIP, cam: POLE, terrain: SITE, tcam: T_MID, span: [SLIP, SLIP + 10 * DAY], surface: 'sunlight',
      head: 'Mean illumination over 10 days.', text: 'Yellow: lit almost all the time. Purple: almost never. Both lie within a few kilometers of each other.',
      async play(h) { if (api.terrain.mode === 'sunlight') return; h.waiting('Calculating illumination for this terrain …'); if (await until(() => api.terrain.mode === 'sunlight', 40000)) h.waiting(''); } },
    { ch: 3, label: 'Ten days from the landing', t: SLIP, cam: POLE, terrain: SITE, tcam: T_MID, span: [SLIP, SLIP + 10 * DAY], surface: 'earth',
      head: 'DTE availability over 10 days.', text: 'The ridges that block the Sun can also block Earth. Bright: DTE line of sight. Dark: none.',
      async play(h) { if (api.terrain.mode === 'earth') return; h.waiting('Calculating DTE availability for this terrain …'); if (await until(() => api.terrain.mode === 'earth', 40000)) h.waiting(''); } },
    { ch: 3, label: 'New landing day', t: SLIP, cam: POLE, terrain: SITE, tcam: 'sky', span: [SLIP, SLIP + 10 * DAY], status: [SITE, OTHER],
      head: 'The cause is terrain, not season.', text: f => 'On a smooth Moon the site would be lit today. The surrounding terrain shades it for <b>' + f.darkDays + ' days</b>. On <i>Shackleton Rim</i>, ' + f.km + ' km away, the Sun is up on the same day.' },

    { ch: 4, label: 'New landing day', t: SLIP, cam: { site: SITE, tilt: -1.05, zoom: .1 }, sites: [SITE, OTHER], status: [SITE, OTHER], last: true,
      head: 'Where and when both matter.', text: 'Compare sites and dates before the launch slips. That is what this tool is for.' },
  ];
  // --- Showing a shot ---------------------------------------------------------------------------------
  const helpers = { wait, cam: (c, ms, ease) => moveCam(c, api.now(), ms, ease), rig: rigTo, label: t => { el.dateLabel.textContent = t; },
    /** Outline a control, then move its slider to a value so that the move can be watched. */
    async slide(id, to, ms = 1500) {
      const r = field(id), from = +r.value; spot(r.closest('.prange'));
      if (from === to) return true;
      if (!await wait(900)) return false;
      const ok = await tween(ms, e => { const v = Math.round(from + (to - from) * e); if (+r.value !== v) { r.value = v; r.dispatchEvent(new Event('input')); } }, soft, true);
      return ok && wait(500);
    },
    /** A ring round the Moon: the area on it has just changed. */
    pulse() {
      const h = hero.clientHeight, px = api.R / api.restDistance() * h / (2 * Math.tan(rad(api.camera.fov / 2)));
      Object.assign(pulseEl.style, { left: inset.l + (hero.clientWidth - inset.l - inset.r) / 2 + 'px', top: h / 2 + 'px', width: 2 * px + 'px', height: 2 * px + 'px' });
      pulseEl.classList.remove('on'); void pulseEl.offsetWidth; pulseEl.classList.add('on');
    },
    spot: sel => spot(sel),
    /** Open the ground of a site from within a shot and bring the terrain camera to p. */
    async terrain(id, p) { const my = token; await prep; if (my !== token) return false; await api.openTerrain(site(id)); terrainId = id; return my === token && toTcam(p); },
    /** In the terrain view: mark in red what keeps the Sun from the site. */
    alarm() { blocked = api.terrain.setAlarm(true); },
    waiting: t => { el.wait.textContent = t; el.wait.hidden = !t; }, text: () => showText(list[index]) };
  function showText(s) {
    const say = v => typeof v === 'function' ? v(facts) : v, head = say(s.head), text = '<p>' + say(s.text) + '</p>';
    if (el.head.dataset.key !== head) { el.head.dataset.key = head; el.head.innerHTML = head; }
    if (el.text.innerHTML !== text) el.text.innerHTML = text;
  }
  function showStatus(force) {
    const now = performance.now(); if (!force && now - statusAt < 120) return; statusAt = now;
    // the key shot tells the landing spot on the planned day and on the day after the slip; every other shot the sites as they are now
    const whens = list[index]?.key ? [['Planned, ' + dayText(PLAN), PLAN], ['After the slip, ' + dayText(SLIP), SLIP]] : null;
    const rows = (whens ?? statusIds).map(row => {
      const id = whens ? SITE : row, s = site(id), k = s && api.siteNow(s, whens ? row[1] : undefined), sun = k && k.sun.frac >= .5, earth = k && k.earth.frac >= .5;
      return '<dt>' + (whens ? row[0] : NAMES[id]) + '</dt><dd><span class="' + (sun ? 'good' : 'bad') + '">' + (sun ? 'Illuminated' : 'In darkness') + '</span><span class="' + (earth ? 'good' : 'bad') + '">DTE ' + (earth ? 'available' : 'outage') + '</span></dd>';
    }).join('');
    if (rows !== el.status.dataset.key) { el.status.dataset.key = rows; el.status.innerHTML = rows; }
    el.status.hidden = !statusIds.length;
  }
  /** Outline what a hint or a change is about: an element, a selector, or the ids of sidebar sliders. Null takes the outline away. */
  let spots = [];
  function spot(what) {
    spots.forEach(e => e.classList.remove('demo-spot'));
    spots = !what ? [] : Array.isArray(what) ? what.map(id => field(id).closest('.prange')) : [typeof what === 'string' ? document.querySelector(what) : what].filter(Boolean);
    spots.forEach(e => e.classList.add('demo-spot'));
  }
  function render(s) {
    place = s.at ?? 'right'; for (const side of ['left', 'bottom']) { const on = place === side && !narrow.matches; el.panel.classList.toggle(side, on); root.classList.toggle(side, on); }
    el.chapter.textContent = mode === 'demo' ? (s.ch + 1) + ' · ' + CHAPTERS[s.ch] + (s.key ? ' · ' + s.key : '') : 'Tutorial';
    el.panel.classList.toggle('key', !!s.key);
    el.count.textContent = (index + 1) + ' / ' + list.length;
    backBtn.disabled = index === 0;
    el.nav.hidden = !!s.last && mode === 'demo'; el.end.hidden = !el.nav.hidden;
    nextBtn.textContent = s.last ? 'Done' : 'Next';
    el.skip.textContent = mode === 'demo' ? 'Skip demo' : 'Close tutorial'; el.skip.hidden = !!s.last;
    helpers.waiting(''); showText(s);
    statusIds = mode === 'demo' ? s.status ?? [] : []; showStatus(true);
    if (mode === 'demo') spot(s.spot ?? null);
    document.body.classList.toggle('demo-span', !!s.spanRow);
    el.meter.hidden = !s.meter; el.date.hidden = mode !== 'demo';
    if (mode === 'demo') el.dateLabel.textContent = s.label;
  }
  /** Bring the page to what the shot states. Resolves false when another shot took over meanwhile. */
  async function apply(s, my) {
    api.setPlaying(false); api.halt();
    await until(() => !api.terrainOpening() && !api.opening(), 60000);
    if (my !== token) return false;
    const at = typeof s.t === 'function' ? s.t(facts) : s.t;
    const layers = () => {
      setSurface(s.surface ?? 'relief'); setLimits(s.limits ?? null); setSpan(s.span ?? null); setSide(!!s.side);
      setLayer('historical', false); setLayer('orbits', true);
      // pins: the landing spot as the page's own marker for typed coordinates, listed sites as their pins
      api.pins.cards.clear(); api.pins.picked = null;
      (s.sites ?? []).forEach(id => { if (id === SITE) api.pins.custom([SPOT.lat, SPOT.lon], false); else api.pins.cards.add(id); });
      if (Math.abs(api.now() - at) > 1000) api.setTime(at);
      showTrail(s.trail === true ? 1 : null); showLander(null);
      blocked = null; api.terrain.setAlarm(false);
    };
    if (api.scope() === 'terrain' && s.terrain !== terrainId) {
      // out of the ground: a cut. Behind the black the page is set as the shot states, cameras included.
      if (!await cut(() => { leaveTerrain(); layers(); return Promise.all([moveCam(s.cam, at, 0), rigTo(s.rig ?? null, 0)]); })) return false;
    } else layers();
    if (api.scope() !== 'terrain') {
      const moves = await Promise.all([moveCam(s.cam, at, s.camMs ?? 1700), rigTo(s.rig ?? null, s.rigMs ?? 1700)]);
      if (!moves.every(Boolean)) return false;
      if (s.terrain) { await prep; if (my !== token) return false; await api.openTerrain(site(s.terrain)); terrainId = s.terrain; if (my !== token) return false; }
    }
    return !s.terrain || toTcam(s.tcam ?? T_WIDE, s.tcamMs ?? 2600);
  }
  async function go(i) {
    const my = ++token; index = i; const s = list[i];
    render(s);
    (s.last && mode === 'demo' ? el.end.firstChild : nextBtn).focus({ preventScroll: true });
    if (!await apply(s, my)) return;
    prepareAhead(false);
    if (s.play) { await s.play(helpers); if (my !== token) return; }
    showText(s); prepareAhead(true);
    if (auto && !s.last && await wait(1400 + (el.head.textContent.length + el.text.textContent.length) * 45)) go(index + 1);
  }
  /**
   * While a shot is being read, what the coming shots need is got ready, so that they start without waiting:
   * the ground of the next terrain shot is loaded and built (idle: only once the shot's own move is over, because
   * building takes the page's attention for a moment), and in the terrain view the sunlight and Earth maps of the
   * next shots are worked out in the background.
   */
  function prepareAhead(idle) {
    const ahead = list.slice(index + 1);
    if (api.scope() === 'terrain') {
      const m = ahead.slice(0, 2).find(s => s.terrain && (s.surface === 'sunlight' || s.surface === 'earth'));
      warm = !!m && String(m.span) === String(list[index].span);
    } else if (idle) {
      const t = ahead.find(s => s.terrain || s.opens);
      if (t) prep = api.prepareTerrain(site(t.terrain ?? t.opens)).catch(() => {});
    }
  }
  const next = () => { if (index < list.length - 1) go(index + 1); else stop(); };
  const back = () => { if (index > 0) go(index - 1); };

  // The tutorial (landing-tour.js): its own hint and stops; closing it ends the mode here.
  const tour = createTour({ api, hero, onClose: () => stop() });

  // --- Start and end -----------------------------------------------------------------------------------
  /** From the page's calculation: hours until the Sun is back at the landing spot after the slip, how long that dark stretch is in all, how far Shackleton rim is. */
  function measure() {
    const s = site(SITE), o = site(OTHER);
    if (o) { const a = SPOT.local, b = o.local; facts.km = Math.round(Math.acos(THREE.MathUtils.clamp(a.dot(b) / (a.length() * b.length()), -1, 1)) * MOON_RADIUS_KM); }
    if (api.siteNow(s).basis !== 'block' || api.siteNow(s, SLIP).sun.frac >= .5) return;       // without its terrain block the numbers of 15 Nov 2026 stand
    const lit = api.nextChange(s, 'sun', SLIP, SLIP + 400 * DAY); if (!lit) return;
    let t = SLIP; while (t > SLIP - 120 * DAY && api.siteNow(s, t - HOUR).sun.frac < .5) t -= HOUR;
    facts.lightMs = lit; facts.darkMs = t; facts.hours = Math.round((lit - SLIP) / HOUR); facts.days = Math.round((lit - SLIP) / DAY); facts.darkDays = Math.round((lit - t) / DAY);
  }
  async function run(what, opts = {}) {
    if (mode) return;
    mode = what; list = DEMO; auto = !!opts.auto; index = 0;
    scrollTo({ top: 0 });
    saved = { t: api.now(), playing: api.playing(), x: pivot.rotation.x, y: pivot.rotation.y, zoom: api.zoom(), surface: field('p-surface').value,
      dark: +field('p-dark').value, dte: +field('p-dte').value, span: api.span(), side: sideOpen(), historical: layerOn('historical'), orbits: layerOn('orbits'),
      picked: api.pins.picked, cards: api.pins.marked().filter(s => api.cards.has(s.id)), series: field('series-toggle').getAttribute('aria-pressed') === 'true' };
    document.body.classList.add(what); root.hidden = what !== 'demo';
    const my = ++token;
    if (what === 'demo') {
      api.setPlaying(false); api.enter();
      api.showSeries(false); leaveTerrain(); saved.cards.forEach(s => api.cards.close(s.id));
      render(list[0]);                                                // the first text is there while the data arrives
      // the ground under the landing spot, on which its numbers rest, and the listed site it is compared with
      helpers.waiting('Loading terrain of the landing site …');
      await Promise.all([api.loadGround(SPOT).catch(() => null), until(() => site(OTHER), 8000)]);
      if (my !== token) return;
      measure(); go(0);
    } else {
      // From the title the tutorial begins with the page's own opening move, as a click on the title would.
      if (!api.expanded()) { api.reopen(); await until(() => !api.opening(), 10000); }
      if (my !== token) return;
      tour.start();
    }
  }
  /**
   * End. After the demo the page's layers, markers and cards are put back as they were; then the view goes to where
   * the title page stood and the page's own opening move runs (the same as after the first click on the title), so
   * "Explore freely", "Start the tutorial" and "Skip demo" all arrive at the same view of the system.
   */
  async function stop(then) {
    if (!mode || mode === 'outro') return;
    const was = mode; token++; spot(null); warm = false;
    document.body.classList.remove('demo', 'tour', 'demo-span'); el.panel.hidden = true; el.date.hidden = true; el.meter.hidden = true; hideNames(); hideSky(); blocked = null; api.terrain.setAlarm(false); api.terrain.setSkyFit(false);
    if (was !== 'demo') { tour.close(); mode = null; root.hidden = true; el.panel.hidden = false; saved = null; return; }
    mode = 'outro';                                              // the shield stays until the opening move is over
    const my = token, change = () => {
      leaveTerrain(); showTrail(null); showLander(null);
      setSurface(saved.surface); for (const [id, v] of [['p-dark', saved.dark], ['p-dte', saved.dte]]) { const r = field(id); r.value = v; r.dispatchEvent(new Event('input')); }
      setSpan(saved.span); setSide(saved.side); setLayer('historical', saved.historical); setLayer('orbits', saved.orbits);
      const typed = field('p-coord').value.split(',').map(Number);                 // the marker for typed coordinates back where the field says
      if (typed.length === 2 && typed.every(Number.isFinite)) api.pins.custom(typed, false);
      api.pins.cards.clear(); api.pins.picked = saved.picked; saved.cards.forEach(s => api.cards.open(s));
      api.showSeries(saved.series); api.halt(); api.setTime(home.t);
    };
    if (api.scope() === 'terrain') await cut(async () => { change(); await Promise.all([moveCam({ tilt: home.tilt, yaw: home.yaw, zoom: api.closeZoom() }, home.t, 0), rigTo(null, 0)]); });
    else { change(); await Promise.all([moveCam({ tilt: home.tilt, yaw: home.yaw, zoom: api.closeZoom() }, home.t, 1500), rigTo(null, 1500)]); }
    world.classList.remove('veil');
    if (my === token) {
      dropRig(); api.setPlaying(!reduce.matches); api.reopen();
      await until(() => !api.opening(), 10000);
    }
    mode = null; root.hidden = true; el.panel.hidden = false; saved = null;
    if (then === 'tour' && my === token) run('tour');
  }

  start.addEventListener('click', e => { const b = e.target.closest('[data-run]'); if (b) run(b.dataset.run); });
  nextBtn.addEventListener('click', next); backBtn.addEventListener('click', back); el.skip.addEventListener('click', () => stop());
  el.end.addEventListener('click', e => { const b = e.target.closest('[data-end]'); if (b) stop(b.dataset.end); });
  // Keys while it runs: arrows step, Escape ends. Taken before the page's own keys (zoom, undo, closing panels).
  addEventListener('keydown', e => {
    if (!mode) return;
    const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
    if (mode === 'outro') return;
    // the tutorial: Escape closes the reference sheet, then the tutorial; the arrow keys step from within the hint
    if (mode === 'tour') { if (!(typing && e.key === 'Escape') && tour.key(e)) { e.stopPropagation(); if (e.key.startsWith('Arrow')) e.preventDefault(); } return; }
    if (e.key === 'Escape' && !typing) { e.stopPropagation(); stop(); }
    else if (mode === 'demo') {
      if (e.key === 'ArrowRight') next(); else if (e.key === 'ArrowLeft') back();
      if (e.key !== 'Tab' && e.key !== 'Enter' && e.key !== ' ') e.stopPropagation();
      if (e.key.startsWith('Arrow') || e.key === 'Backspace') e.preventDefault();
    }
  }, true);
  // "Demo" in the header: the way back in once the title is gone.
  document.getElementById('demo-link')?.addEventListener('click', e => { e.preventDefault(); run('demo'); });
  document.getElementById('tour-link')?.addEventListener('click', e => { e.preventDefault(); run('tour'); });
  // ?demo=auto in the address: the demo starts by itself and steps on after a reading time (for recording).
  const wanted = new URLSearchParams(location.search).get('demo');
  if (wanted != null) until(() => document.getElementById('world').classList.contains('ready') && site(OTHER), 30000).then(() => wait(800)).then(() => run('demo', { auto: wanted === 'auto' }));

  function frame(now) {
    for (const t of [...tweens]) t(now);
    insetFrame(now);
    if (rig) rigFrame();
    if (mode === 'tour') tour.frame(now);
    if (mode !== 'demo') return;
    if (warm && now - warmAt > 300) { warmAt = now; if (api.warmExposure()) warm = false; }
    if (api.scope() === 'system') { nameFrame(); hideSky(); } else { hideNames(); skyFrame(); }
    const t = api.now();
    const day = dayText(t); if (day !== el.dateDay.textContent) el.dateDay.textContent = day;
    if (!el.meter.hidden) {
      const h = Math.max(0, (t - SLIP) / HOUR), left = Math.max(0, 1 - h / BATTERY_H), text = num(h) + ' h';
      battFill.style.width = left * 100 + '%'; el.meter.classList.toggle('empty', left === 0);
      if (text !== el.hours.textContent) el.hours.textContent = text;
    }
    if (statusIds.length) showStatus(false);
  }
  return { frame, run, stop, get active() { return !!mode; }, get rig() { return !!rig; } };
}
