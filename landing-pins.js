// Landing sites on the landing-page Moon: map-style pins.
// Sites and coordinates come from expiry-date/data/sites.json, the list the comparison uses (sources per
// site are in that file). A pin is an HTML element at the projected position of its site, tip on the
// spot; it disappears behind the limb. Sites closer than CLUSTER px on screen share one pin with a count.
// Filled pin = landed mission, outlined pin = candidate site with LOLA terrain. Hover, focus or tap
// shows the name above the pin, nothing else. The selected site keeps its name and a larger pin.
// The listed sites follow show(on); the selected site, listed or typed coordinates, is always drawn.
import * as THREE from 'three';

const PIN_SVG = '<svg viewBox="0 0 24 32" aria-hidden="true"><path d="M12 31.2S2.8 19.9 2.8 11.6a9.2 9.2 0 0 1 18.4 0C21.2 19.9 12 31.2 12 31.2Z"/><circle cx="12" cy="11.6" r="3.2"/><text x="12" y="15.6" text-anchor="middle"></text></svg>';
const CLUSTER = 30, TURN_MS = 700, TILT_MAX = 1.1;       // TILT_MAX: same limit as dragging in landing.js
const rad = THREE.MathUtils.degToRad;
export const coordText = s => Math.abs(s.lat).toFixed(4) + '° ' + (s.lat < 0 ? 'S' : 'N') + ', ' + s.lon.toFixed(4) + '° E';

/** root: overlay element inside the hero; moon: the Moon mesh (centre = scene origin); R: its radius. */
export function createPins({ root, hero, moon, pivot, camera, R }) {
  const pos = new THREE.Vector3(), view = new THREE.Vector3();
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  let turn = null;
  // sites: the listed sites (for the search). picked: id of the selected site, 'custom' for typed coordinates.
  const api = { sites: [], on: false, picked: null, onPick: null, show, pick, custom, face, update };

  function make(def) {
    const el = document.createElement('div'); el.className = 'pin'; el.hidden = true;
    el.innerHTML = '<div class="pin-names"></div><button type="button" class="pin-head">' + PIN_SVG + '</button>';
    const s = { id: def.id, name: def.name, candidate: !!def.horizon, local: new THREE.Vector3(),
      el, head: el.lastChild, names: el.firstChild, count: el.querySelector('text'), key: '', members: null, x: 0, y: 0 };
    place(s, def.lat, def.lon);
    // One site: the pin selects it. Several sites under one pin: the pin keeps the names open, a name selects.
    s.head.addEventListener('click', () => { if (s.members && s.members.length === 1) pick(s); else el.classList.toggle('open'); });
    root.append(el);
    return s;
  }
  function place(s, latDeg, lonDeg) {
    const lat = rad(latDeg), lon = rad(lonDeg);
    s.lat = latDeg; s.lon = ((lonDeg % 360) + 360) % 360;
    // sphere-local axes of the Moon mesh: x = lon 0, y = north, z = lon 90 W (see orient in landing.js)
    s.local.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon)).multiplyScalar(R);
  }
  const own = make({ id: 'custom', name: '', lat: 0, lon: 0 });   // typed coordinates
  const all = [own];
  fetch('expiry-date/data/sites.json').then(r => r.json()).then(d => d.sites.forEach(def => { const s = make(def); api.sites.push(s); all.push(s); })).catch(() => {});
  addEventListener('click', e => { all.forEach(s => { if (!s.el.contains(e.target)) s.el.classList.remove('open'); }); });
  hero.addEventListener('pointerdown', () => { turn = null; });   // dragging takes over from a running turn

  function show(on) { api.on = on; }
  /** Select a listed site (pin, name or search). */
  function pick(s) { api.onPick?.(s); api.picked = s.id; all.forEach(x => x.el.classList.remove('open')); }
  /** Typed coordinates [lat, lon] become the selected site; null clears the selection. */
  function custom(c, turnTo) {
    api.picked = c ? 'custom' : null;
    if (!c) return;
    place(own, c[0], c[1]); own.name = coordText(own); own.key = '';
    if (turnTo) face(own);
  }
  /** Turn the space so that the site faces the camera (tilt limited as for dragging). */
  function face(s) {
    const d = pos.copy(s.local).applyQuaternion(moon.quaternion).normalize(), r = pivot.rotation;
    const y = -Math.atan2(d.x, d.z), x = THREE.MathUtils.clamp(Math.atan2(d.y, Math.hypot(d.x, d.z)), -TILT_MAX, TILT_MAX);
    turn = { t0: performance.now(), ms: still.matches ? 0 : TURN_MS, x0: r.x, y0: r.y, dx: x - r.x, dy: Math.atan2(Math.sin(y - r.y), Math.cos(y - r.y)) };
  }

  function render(s) {
    const m = s.members, key = m.map(x => x.id).join() + '|' + api.picked;
    if (key === s.key) return; s.key = key;
    s.head.classList.toggle('multi', m.length > 1);
    s.head.classList.toggle('candidate', m.every(x => x.candidate));
    s.el.classList.toggle('picked', m.some(x => x.id === api.picked));
    s.head.setAttribute('aria-label', m.length > 1 ? m.length + ' landing sites: ' + m.map(x => x.name).join(', ') : s.name);
    s.count.textContent = m.length > 1 ? m.length : '';
    s.names.replaceChildren(...m.map(x => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'pin-name'; b.textContent = x.name;
      b.setAttribute('aria-pressed', x.id === api.picked);
      if (x !== own) b.addEventListener('click', () => pick(x));
      return b;
    }));
  }

  /** Call once per frame before rendering. w, h: size of the canvas in CSS px (it covers the whole window). */
  function update(w, h) {
    if (turn) {
      const p = turn.ms ? Math.min((performance.now() - turn.t0) / turn.ms, 1) : 1, e = 1 - Math.pow(1 - p, 3);
      pivot.rotation.x = turn.x0 + turn.dx * e; pivot.rotation.y = turn.y0 + turn.dy * e;
      if (p === 1) turn = null;
    }
    const left = hero.getBoundingClientRect().left;       // the hero is pushed right by the sidebar, the canvas is not
    pivot.updateMatrixWorld(); camera.updateMatrixWorld();
    const leaders = [];
    for (const s of all) {
      s.members = null;
      if (s.id !== api.picked && (!api.on || s === own)) continue;
      moon.localToWorld(pos.copy(s.local));
      if (view.copy(camera.position).sub(pos).normalize().dot(pos) / R < .05) continue;   // behind the limb
      pos.project(camera);
      s.x = (pos.x + 1) / 2 * w - left; s.y = (1 - pos.y) / 2 * h;
      const lead = leaders.find(l => Math.hypot(l.x - s.x, l.y - s.y) < CLUSTER);
      if (lead) lead.members.push(s); else { s.members = [s]; leaders.push(s); }
    }
    for (const s of all) {
      s.el.hidden = !s.members;
      if (!s.members) { s.el.classList.remove('open'); continue; }
      s.el.style.transform = 'translate(' + s.x.toFixed(1) + 'px,' + s.y.toFixed(1) + 'px)';
      s.el.style.zIndex = Math.round(s.y);                 // lower on screen = in front, as on a map
      render(s);
    }
  }
  return api;
}
