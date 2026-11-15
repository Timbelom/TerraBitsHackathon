// Info cards for markers on the landing-page Moon. A click on a marker opens a card beside the Moon,
// joined to its marker by a thin line. The card shows the site's name (a field: type to rename any point;
// empty gives the original name back) and, for the simulated time of the
// scene: sub-solar and sub-Earth point, elevation of Sun and Earth, and the time until the next
// sunrise/sunset and earthrise/earthset. Values come from siteSky (lunar-sky.js): analytic model,
// smooth sphere, disc centre, no terrain. Several cards can be open to compare sites.
// Placement: a card opens on the side of the Moon its site is on, outside the disc, at the height of
// the site; it moves up or down, then to the other side, then further out, until it overlaps no other
// card and its line does not run under another card. Cards can be dragged (or moved with the arrow keys); a moved card stays where it was put.
// While a site is behind the limb its marker, line and card are hidden; the card comes back with the site
// (a card that was not moved by hand then looks for its place again). "View terrain" is a placeholder.
import { siteSky, DAY_MS } from './lunar-sky.js';
import { coordText } from './landing-pins.js';

// Rise and set are searched in 2 h steps for 60 days, then in 12 h steps up to 19 years (one cycle of the
// lunar nodes, so every libration state has occurred). Nothing found in that time is shown as "never".
const HOUR = 3600000, SEARCH_MS = 19 * 365.25 * DAY_MS, FINE_MS = 60 * DAY_MS, REFRESH_MS = 200;
const GAP = 48, BETWEEN = 12, EDGE = 16, TOP = 93, LEFT = 72;   // px; TOP clears the header, LEFT the Parameters tab
const CLOSE_SVG = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8"/></svg>';
const ROWS = '<dl><dt>Sub-solar point</dt><dd data-f="sunSub"></dd><dt>Solar elevation</dt><dd data-f="sunEl"></dd><dt data-f="sunLab"></dt><dd data-f="sunIn"></dd></dl>'
  + '<dl><dt>Sub-Earth point</dt><dd data-f="earthSub"></dd><dt>Earth elevation</dt><dd data-f="earthEl"></dd><dt data-f="earthLab"></dt><dd data-f="earthIn"></dd></dl>';
const clamp = (v, a, b) => Math.max(a, Math.min(v, Math.max(a, b)));
const point = p => Math.abs(p[0]).toFixed(1) + '° ' + (p[0] < 0 ? 'S' : 'N') + ', ' + p[1].toFixed(1) + '° E';
const angle = d => (d < 0 ? '−' : '+') + Math.abs(d).toFixed(1) + '°';
const span = ms => { const h = Math.floor(ms / HOUR); return Math.floor(h / 24) + ' d ' + h % 24 + ' h'; };

/** UTC time (ms) of the next change of sign of an elevation (key of siteSky) between ms and endMs, or null. */
export function nextCrossing(ms, lat, lon, key, endMs = ms + SEARCH_MS) {
  const up = siteSky(ms, lat, lon)[key] > 0;
  for (let a = ms, t = ms + 2 * HOUR; a < endMs; a = t, t += (t - ms < FINE_MS ? 2 : 12) * HOUR) {
    if ((siteSky(t, lat, lon)[key] > 0) === up) continue;
    let lo = a, hi = t;
    while (hi - lo > 60000) { const m = (lo + hi) / 2; if ((siteSky(m, lat, lon)[key] > 0) === up) lo = m; else hi = m; }
    return hi;
  }
  return null;
}

/** hero: the hero element (cards live in it); pins: createPins api; now(): simulated UTC ms; disc(): Moon on screen {x, y, r} in hero px;
 *  avoid(): a rectangle {x, y, w, h} in hero px that new cards keep clear of (the time series panel), or null. */
export function createCards({ hero, pins, now, disc, avoid }) {
  const NS = 'http://www.w3.org/2000/svg';
  const lines = document.createElementNS(NS, 'svg'); lines.setAttribute('class', 'card-lines'); lines.setAttribute('aria-hidden', 'true');
  const root = document.createElement('div'); root.className = 'cards';
  hero.append(lines, root);
  const cards = new Map();                       // site id -> card
  let lastFill = 0;
  pins.onOpen = s => cards.has(s.id) ? close(s.id) : open(s);
  pins.onClose = id => close(id);

  function bounds() { return { l: LEFT, t: TOP, r: hero.clientWidth - EDGE, b: hero.clientHeight - EDGE }; }
  function moveTo(c, x, y) {
    const B = bounds();
    c.x = clamp(x, Math.min(B.l, EDGE), B.r - c.w); c.y = clamp(y, B.t, B.b - c.h);
    c.el.style.transform = 'translate(' + Math.round(c.x) + 'px,' + Math.round(c.y) + 'px)';
  }
  /** Area this rectangle shares with the other cards (each grown by the gap between cards). */
  function taken(c, x, y) {
    let a = 0;
    const v = avoid?.();
    if (v) a += Math.max(0, Math.min(x + c.w, v.x + v.w + BETWEEN) - Math.max(x, v.x - BETWEEN)) * Math.max(0, Math.min(y + c.h, v.y + v.h + BETWEEN) - Math.max(y, v.y - BETWEEN));
    for (const o of cards.values()) if (o !== c && !o.el.hidden)
      a += Math.max(0, Math.min(x + c.w, o.x + o.w + BETWEEN) - Math.max(x, o.x - BETWEEN)) * Math.max(0, Math.min(y + c.h, o.y + o.h + BETWEEN) - Math.max(y, o.y - BETWEEN));
    return a;
  }
  /** Does the line from the site to a card at x, y run under another card? */
  function crossed(c, sx, sy, x, y) {
    const ex = clamp(sx, x, x + c.w), ey = clamp(sy, y, y + c.h);
    for (const o of cards.values()) if (o !== c && !o.el.hidden) for (let i = 1; i < 16; i++) {
      const px = sx + (ex - sx) * i / 16, py = sy + (ey - sy) * i / 16;
      if (px > o.x && px < o.x + o.w && py > o.y && py < o.y + o.h) return true;
    }
    return false;
  }
  function place(c) {
    const d = disc(), B = bounds(), s = c.site, sx = s.vis ? s.x : d.x, sy = s.vis ? s.y : d.y;
    const pref = sx < d.x ? -1 : 1, y0 = d.y + (sy - d.y) * 1.3 - c.h / 2;      // a little further out than the site
    let best = null;
    const tryAt = (x, y, cost) => { cost += taken(c, x, y) + Math.abs(y - y0) + (crossed(c, sx, sy, x, y) ? 300 : 0); if (!best || cost < best.cost) best = { x, y, cost }; };
    for (const side of [pref, -pref]) for (let col = 0; col < 2; col++) {
      const x = side < 0 ? d.x - d.r - GAP - c.w - col * (c.w + BETWEEN) : d.x + d.r + GAP + col * (c.w + BETWEEN);
      if (x < B.l || x + c.w > B.r) continue;
      for (let n = 0; n < 60; n++) tryAt(x, clamp(y0 + (n % 2 ? 1 : -1) * Math.ceil(n / 2) * 24, B.t, B.b - c.h), (side !== pref ? 400 : 0) + col * 600);
    }
    // No room beside the Moon (narrow window): along the edge on the site's side, wherever least is covered.
    if (!best) for (let n = 0; n < 60; n++) tryAt(pref < 0 ? B.l : B.r - c.w, clamp(B.b - c.h - n * 24, B.t, B.b - c.h), 0);
    moveTo(c, best.x, best.y);
  }

  function open(s) {
    const el = document.createElement('section'); el.className = 'card'; el.tabIndex = 0;
    el.innerHTML = '<header><input type="text" class="card-name" aria-label="Name of this point" autocomplete="off" spellcheck="false"><button type="button" class="card-close" aria-label="Close">' + CLOSE_SVG + '</button></header><p class="card-sub"></p>' + ROWS + '<button type="button" class="card-terrain">View terrain</button>';
    const nameEl = el.querySelector('.card-name'), sub = el.querySelector('.card-sub'), base = s.base ??= s.name;
    const label = () => {
      nameEl.value = s.name; el.setAttribute('aria-label', s.name + ', Sun and Earth at this site');
      const named = s.name !== coordText(s);                                 // a free marker is named by its coordinates until renamed
      sub.textContent = named ? coordText(s) : ''; sub.hidden = !named;
    };
    label();
    nameEl.addEventListener('change', () => { pins.rename(s, nameEl.value.trim() || base); label(); c.h = el.offsetHeight; });
    nameEl.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') nameEl.blur(); else if (e.key === 'Escape') { nameEl.value = s.name; nameEl.blur(); }
    });
    const line = document.createElementNS(NS, 'line'); lines.append(line);
    const c = { site: s, el, line, f: {}, shown: {}, next: {}, x: 0, y: 0, w: 0, h: 0 };
    el.querySelectorAll('[data-f]').forEach(n => { c.f[n.dataset.f] = n; });
    root.append(el); fill(c, now());
    c.w = el.offsetWidth; c.h = el.offsetHeight;
    cards.set(s.id, c); pins.cards.add(s.id); place(c);

    el.querySelector('.card-close').addEventListener('click', () => close(s.id));
    let grab = null;
    el.addEventListener('pointerdown', e => {
      if (e.target.closest('button, input')) return;
      grab = { dx: e.clientX - c.x, dy: e.clientY - c.y }; el.setPointerCapture(e.pointerId); el.classList.add('moving'); root.append(el);   // to the front
    });
    el.addEventListener('pointermove', e => { if (grab) { c.manual = true; moveTo(c, e.clientX - grab.dx, e.clientY - grab.dy); } });
    const drop = () => { grab = null; el.classList.remove('moving'); };
    el.addEventListener('pointerup', drop); el.addEventListener('pointercancel', drop);
    el.addEventListener('keydown', e => {
      const d = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] }[e.key];
      if (d && e.target === el) { e.preventDefault(); c.manual = true; moveTo(c, c.x + d[0], c.y + d[1]); }
      else if (e.key === 'Escape') { e.stopPropagation(); close(s.id); }
    });
  }
  function close(id) {
    const c = cards.get(id); if (!c) return;
    c.el.remove(); c.line.remove(); cards.delete(id); pins.cards.delete(id);
  }

  function set(c, k, text) { if (c.shown[k] !== text) { c.shown[k] = text; c.f[k].textContent = text; } }
  function fill(c, ms) {
    const { lat, lon } = c.site, k = siteSky(ms, lat, lon);
    set(c, 'sunSub', point(k.subSolar)); set(c, 'earthSub', point(k.subEarth));
    set(c, 'sunEl', angle(k.sunElevDeg)); set(c, 'earthEl', angle(k.earthElevDeg));
    for (const [body, key, word] of [['sun', 'sunElevDeg', 'Sun'], ['earth', 'earthElevDeg', 'Earth']]) {
      let ev = c.next[body];
      // "never" found from ev.from on: after a jump back only the stretch up to ev.from has to be searched
      if (ev && !ev.at && ms < ev.from && !nextCrossing(ms, lat, lon, key, ev.from)) ev.from = ms;
      if (!ev || ms < ev.from || ms >= ev.redo) { const at = nextCrossing(ms, lat, lon, key); ev = c.next[body] = { from: ms, at, redo: at ?? ms + SEARCH_MS / 2 }; }
      const up = k[key] > 0;
      set(c, body + 'Lab', ev.at ? word + (up ? 'set in' : 'rise in') : word);
      set(c, body + 'In', ev.at ? span(ev.at - ms) : up ? 'never sets' : 'never rises');
    }
  }

  /** Call once per frame after pins.update(). */
  function update() {
    if (!cards.size) return;
    const t = performance.now(), refresh = t - lastFill > REFRESH_MS, ms = now();
    if (refresh) lastFill = t;
    for (const c of cards.values()) {
      const s = c.site, vis = !!s.vis;
      if (c.el.hidden === vis) {                                                         // the site went behind the limb or came back
        c.el.hidden = !vis; c.line.style.display = vis ? '' : 'none';
        if (vis) { fill(c, ms); if (!c.manual) place(c); }
      }
      if (!vis) continue;
      if (refresh) { fill(c, ms); c.h = c.el.offsetHeight; moveTo(c, c.x, c.y); }      // also keeps cards inside a resized window
      const x = clamp(s.x, c.x, c.x + c.w), y = clamp(s.y, c.y, c.y + c.h);   // nearest point of the card
      const on = x !== s.x || y !== s.y;                                                 // no line when the card lies on its site
      c.line.style.display = on ? '' : 'none';
      if (on) { c.line.setAttribute('x1', s.x.toFixed(1)); c.line.setAttribute('y1', s.y.toFixed(1)); c.line.setAttribute('x2', x.toFixed(1)); c.line.setAttribute('y2', y.toFixed(1)); }
    }
  }
  return { update, open, close };
}
