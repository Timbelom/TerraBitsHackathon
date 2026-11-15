// The sky of one marked point on the landing-page Moon (sky view panel): its horizon over 360 deg of azimuth as a
// silhouette, the Sun and the Earth where they stand at the simulated time, and their course over the time span.
// x: azimuth 0 to 360 deg, clockwise from north (N, E, S, W, N). y: elevation angle against the local horizontal, deg.
// The elevation range is taken from the horizon and the two courses, with a margin, so a polar site (Sun within
// 1.6 deg of the horizontal, going round once a lunar day; Earth swinging about one spot) is resolved, and a site
// at low latitude still shows the whole course.
// Shown and hidden by "Sky view" in the header (show(); off at the start). It opens top right of the scene, where the
// time series opens; while that panel is shown there, top left beside it. It can be dragged (or moved with the arrow
// keys); a moved panel stays where it was put. Where the two cannot stand side by side when one of them is opened,
// the one opened last closes the other.
// Which point: the selected one; with several marked points a list in the panel chooses (it follows a new selection).
// Values come from core/visibility.js (siteState) with the horizon ui/site-data.js has for the point: 360 values,
// one per degree. The panel names the point and the ground the horizon rests on (basisLabel).
// The discs are drawn to the scale of the elevation axis (radius in deg x px per deg), so a disc meets the skyline as
// it does in the calculation; where that is under 3 px they are drawn with 3 px and the panel says so.
// Behind the terrain: a course is a solid line where its body's centre is above the skyline and a dashed, fainter
// line below it; a disc is filled where it is above the skyline and a dashed outline below it.
// The courses are sampled when point, span or ground change (240 samples per lunar day); the plot is redrawn when
// its size changes as well; each frame only the two discs move.
import { DAY_MS, SYNODIC_DAYS } from './core/sky.js';
import { siteState, basisLabel } from './core/visibility.js';
import { ticks } from './landing-series.js';

const BODIES = [{ id: 'sun', name: 'Sun', color: '#c98500' }, { id: 'earth', name: 'Earth', color: '#3987e5' }];   // data colours of the time series palette
const NS = 'http://www.w3.org/2000/svg', CYCLE_MS = SYNODIC_DAYS * DAY_MS;
const M = { l: 56, r: 16, t: 12, b: 48 };                 // plot margins, px
const EDGE = 16, TOP = 93, LEFT = 72, MIN_W = 420, MAX_W = 640;   // px: gap to the hero's edge, clear of the header and of the sidebar's tab
const PER_CYCLE = 240, MIN_N = 240, MAX_N = 6000;         // samples of a course: 1.5 deg of the Sun's azimuth apart
const Y_STEPS = [.5, 1, 2, 5, 10, 15, 30, 45], MIN_RANGE = 4, PAD = .08, MIN_DISC = 3;   // deg, deg, share of the range, px
const COMPASS = ['N', 'E', 'S', 'W', 'N'];
const CLOSE_SVG = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8"/></svg>';
const angle = (d, digits = 1) => (d < 0 ? '−' : '+') + Math.abs(d).toFixed(digits) + '°';
const stamp = ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const svgEl = (name, attrs) => { const e = document.createElementNS(NS, name); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

/**
 * The sky of one site (makeSite of core/visibility.js) from a to b (UTC ms): azimuth and elevation of the Sun's and
 * the Earth's centre at n + 1 evenly spaced times, the horizon at 361 azimuths (0..360 deg; 0 without a profile),
 * and the elevation range [lo, hi] that holds all of it with a margin.
 */
export function skyPaths(site, a, b) {
  const n = Math.round(Math.max(MIN_N, Math.min(MAX_N, (b - a) / CYCLE_MS * PER_CYCLE))), st = { sun: {}, earth: {} };
  const out = { n, sun: { az: new Float32Array(n + 1), el: new Float32Array(n + 1) }, earth: { az: new Float32Array(n + 1), el: new Float32Array(n + 1) }, horizon: new Float32Array(361) };
  let lo = Infinity, hi = -Infinity;
  const see = v => { if (v < lo) lo = v; if (v > hi) hi = v; };
  for (let i = 0; i <= n; i++) {
    siteState(a + (b - a) * i / n, site, st);
    for (const k of ['sun', 'earth']) { out[k].az[i] = st[k].az; out[k].el[i] = st[k].el; see(st[k].el); }
  }
  for (let i = 0; i <= 360; i++) see(out.horizon[i] = site.horizon ? site.horizon.angle[i % 360] : 0);
  const pad = Math.max(PAD * (hi - lo), (MIN_RANGE - (hi - lo)) / 2);
  out.lo = Math.max(-90, lo - pad); out.hi = Math.min(90, hi + pad);
  return out;
}

/**
 * hero: the hero element (the panel lives in it); marked(): the marked sites ({ id, name, lat, lon });
 * picked(): id of the selected site or null; now(): simulated UTC ms; window(): the time window { a, b } of the page;
 * onClose(): the panel's close button was pressed, or the panel gives way to the other one;
 * ground(site): the point for the calculation (ui/site-data.js get); groundVersion(): changes when any ground changed;
 * other(): rectangle of the time series panel in hero px or null; closeOther(): hide that panel.
 */
export function createSky({ hero, marked, picked, now, window: timeWindow, onClose, ground, groundVersion, other, closeOther }) {
  const el = document.createElement('section'); el.className = 'series sky'; el.hidden = true; el.tabIndex = 0;
  el.setAttribute('aria-label', 'Sky of a marked point: horizon, Sun and Earth by azimuth and elevation');
  el.innerHTML = '<header><h2>Sky view</h2><output class="series-time"></output><button type="button" class="series-close" aria-label="Close">' + CLOSE_SVG + '</button></header>'
    + '<p class="series-empty">Mark a point on the Moon to see its sky.</p>'
    + '<p class="sky-site"><strong></strong><select aria-label="Marked point shown" hidden></select><span></span></p><svg class="sky-plot" role="img"></svg>'
    + '<table class="sky-values"><thead><tr><th></th><th scope="col">Azimuth</th><th scope="col">Elevation</th><th scope="col">Above horizon</th></tr></thead><tbody>'
    + BODIES.map(b => '<tr><th scope="row"><i style="background:' + b.color + '"></i>' + b.name + '</th><td></td><td></td><td></td></tr>').join('') + '</tbody></table>'
    + '<p class="sky-note" hidden>Discs drawn larger than to scale (3 px radius).</p>';
  hero.append(el);
  const timeEl = el.querySelector('.series-time'), plot = el.querySelector('.sky-plot'), nameEl = el.querySelector('.sky-site strong'), select = el.querySelector('select'),
    basisEl = el.querySelector('.sky-site span'), note = el.querySelector('.sky-note'), cells = [...el.querySelectorAll('tbody tr')].map(tr => [...tr.querySelectorAll('td')]);
  el.querySelector('.series-close').addEventListener('click', () => onClose?.());

  let on = false, fresh = false, hadOther = false, chosen = null, lastPicked = null, listKey = '';
  let dataKey = '', drawKey = '', data = null, calc = null, marks = null, lastRead = 0, W = 0, H = 0;
  select.addEventListener('change', () => { chosen = select.value; });
  // Position in hero px. Until the panel is moved by hand it sits at its opening place (update()) and follows the hero's width.
  const at = { x: 0, y: 0, manual: false };
  const clamp = (v, a, b) => Math.max(a, Math.min(v, Math.max(a, b)));
  function moveTo(x, y) {
    at.x = clamp(x, EDGE, hero.clientWidth - EDGE - el.offsetWidth); at.y = clamp(y, Math.min(TOP, EDGE), hero.clientHeight - EDGE - el.offsetHeight);
    el.style.transform = 'translate(' + Math.round(at.x) + 'px,' + Math.round(at.y) + 'px)';
  }
  let grab = null;
  el.addEventListener('pointerdown', e => {
    if (e.target.closest('button, select')) return;
    grab = { dx: e.clientX - at.x, dy: e.clientY - at.y }; el.setPointerCapture(e.pointerId); el.classList.add('moving');
  });
  el.addEventListener('pointermove', e => { if (grab) { at.manual = true; moveTo(e.clientX - grab.dx, e.clientY - grab.dy); } });
  const drop = () => { grab = null; el.classList.remove('moving'); };
  el.addEventListener('pointerup', drop); el.addEventListener('pointercancel', drop);
  el.addEventListener('keydown', e => {
    const d = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] }[e.key];
    if (d && e.target === el) { e.preventDefault(); at.manual = true; moveTo(at.x + d[0], at.y + d[1]); }
  });
  const leftOf = () => hero.clientWidth >= MIN_W + LEFT + EDGE ? LEFT : EDGE;
  /** Both panels side by side at their opening places: is there room for this one beside the other (rectangle o)? */
  const fits = o => hero.clientWidth - leftOf() - 2 * EDGE - o.w >= MIN_W;

  const xOf = az => M.l + az / 360 * (W - M.l - M.r);
  const yOf = v => M.t + (data.hi - v) / (data.hi - data.lo) * (H - M.t - M.b);
  /** The course of one body as a path; where the azimuth passes north the line leaves on one side and comes in on the other. */
  function course(b) {
    let d = '';
    for (let k = 0; k <= data.n; k++) {
      const az = b.az[k], y = yOf(b.el[k]).toFixed(1);
      if (k && Math.abs(az - b.az[k - 1]) > 180) {
        const turn = az < b.az[k - 1] ? 360 : -360;
        d += 'L' + xOf(az + turn).toFixed(1) + ' ' + y + 'M' + xOf(b.az[k - 1] - turn).toFixed(1) + ' ' + yOf(b.el[k - 1]).toFixed(1);
      }
      d += (k ? 'L' : 'M') + xOf(az).toFixed(1) + ' ' + y;
    }
    return d;
  }
  function draw(site) {
    W = plot.clientWidth; H = plot.clientHeight;
    plot.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    const l = M.l, r = W - M.r, t = M.t, b = H - M.b, kids = [];
    let line = '';
    for (let i = 0; i <= 360; i++) line += (i ? 'L' : '') + xOf(i).toFixed(1) + ' ' + Math.max(t, Math.min(b, yOf(data.horizon[i]))).toFixed(1);
    // two clip regions: the plot area, and the part of it above the skyline (the open sky)
    const defs = svgEl('defs', {}), box = svgEl('clipPath', { id: 'sky-clip-plot' }), open = svgEl('clipPath', { id: 'sky-clip-open' });
    box.append(svgEl('rect', { x: l, y: t, width: r - l, height: b - t }));
    open.append(svgEl('path', { d: 'M' + l + ' ' + t + 'L' + line + 'L' + r + ' ' + t + 'Z' }));
    defs.append(box, open); kids.push(defs);
    const yt = ticks(data.lo, data.hi, Y_STEPS, Math.max(2, Math.floor((b - t) / 24)));
    for (const v of yt.values) {
      kids.push(svgEl('line', { class: v === 0 ? 'series-zero' : 'series-grid', x1: l, x2: r, y1: yOf(v).toFixed(1), y2: yOf(v).toFixed(1) }));
      const tx = svgEl('text', { class: 'series-tick', x: l - 10, y: (yOf(v) + 5).toFixed(1), 'text-anchor': 'end' });
      tx.textContent = v === 0 ? '0°' : angle(v, yt.step < 1 ? 1 : 0); kids.push(tx);
    }
    for (let az = 0; az <= 360; az += 45) {
      const x = xOf(az).toFixed(1);
      kids.push(svgEl('line', { class: 'series-grid', x1: x, x2: x, y1: t, y2: b }));
      if (az % 90) continue;
      const anchor = az === 0 ? 'start' : az === 360 ? 'end' : 'middle';
      kids.push(svgEl('line', { class: 'series-axis', x1: x, x2: x, y1: b, y2: b + 5 }));
      const up = svgEl('text', { class: 'series-tick', x, y: b + 21, 'text-anchor': anchor }); up.textContent = COMPASS[az / 90];
      const low = svgEl('text', { class: 'series-tick series-tick2', x, y: b + 40, 'text-anchor': anchor }); low.textContent = az + '°';
      kids.push(up, low);
    }
    const inBox = svgEl('g', { 'clip-path': 'url(#sky-clip-plot)' }), sky = svgEl('g', { 'clip-path': 'url(#sky-clip-open)' }), sky2 = svgEl('g', { 'clip-path': 'url(#sky-clip-open)' });
    const paths = BODIES.map(k => course(data[k.id]));
    BODIES.forEach((k, i) => { inBox.append(svgEl('path', { class: 'sky-course sky-behind', d: paths[i], stroke: k.color })); sky.append(svgEl('path', { class: 'sky-course', d: paths[i], stroke: k.color })); });
    inBox.append(svgEl('path', { class: 'sky-ground', d: 'M' + l + ' ' + b + 'L' + line + 'L' + r + ' ' + b + 'Z' }), sky, svgEl('path', { class: 'sky-line', d: 'M' + line }));
    // the Earth first: the Sun is the smaller disc and stays on top
    marks = [...BODIES].reverse().map(k => {
      const ring = svgEl('circle', { class: 'sky-ring', stroke: k.color }), disc = svgEl('circle', { class: 'sky-disc', fill: k.color });
      const label = svgEl('text', { class: 'series-tick sky-label' }); label.textContent = k.name;
      inBox.append(ring); sky2.append(disc);
      return { id: k.id, ring, disc, label };
    });
    inBox.append(sky2); kids.push(inBox);
    kids.push(svgEl('path', { class: 'series-axis', d: 'M' + l + ' ' + t + 'V' + b + 'H' + r }), ...marks.map(m => m.label));
    plot.replaceChildren(...kids);
    plot.setAttribute('aria-label', 'Sky of ' + site.name + ': horizon silhouette over azimuth 0 to 360 degrees from north through east, elevation from '
      + data.lo.toFixed(1) + ' to ' + data.hi.toFixed(1) + ' degrees, with the Sun and the Earth and their courses from ' + stamp(data.a) + ' to ' + stamp(data.b)
      + '. Dashed where a body is below the skyline.');
  }
  const st = { sun: {}, earth: {} };
  /** The two discs at a time; the values beside them at most five times a second. */
  function place(ms) {
    siteState(ms, calc, st);
    const perDeg = (H - M.t - M.b) / (data.hi - data.lo), p = performance.now(), text = p - lastRead > 200;
    let enlarged = false;
    for (const m of marks) {
      const k = st[m.id], inside = k.el >= data.lo && k.el <= data.hi, x = xOf(k.az), y = yOf(k.el), r = Math.max(MIN_DISC, k.radius * perDeg);
      if (k.radius * perDeg < MIN_DISC) enlarged = true;
      for (const c of [m.ring, m.disc]) { c.style.display = inside ? '' : 'none'; if (inside) { c.setAttribute('cx', x.toFixed(1)); c.setAttribute('cy', y.toFixed(1)); c.setAttribute('r', r.toFixed(1)); } }
      m.label.style.display = inside ? '' : 'none';
      if (inside) {
        // the Sun's name to the right of its disc, the Earth's to the left (they can stand in one place); the other side at the plot's edge
        const right = m.id === 'sun' ? x + r + 6 + 48 < W - M.r : x - r - 6 - 48 < M.l;
        m.label.setAttribute('x', (right ? x + r + 6 : x - r - 6).toFixed(1)); m.label.setAttribute('text-anchor', right ? 'start' : 'end');
        m.label.setAttribute('y', Math.max(M.t + 14, y - r - 4).toFixed(1));
      }
    }
    if (!text) return; lastRead = p;
    timeEl.textContent = stamp(ms);
    BODIES.forEach((b, i) => { const k = st[b.id]; cells[i][0].textContent = k.az.toFixed(1) + '°'; cells[i][1].textContent = angle(k.el); cells[i][2].textContent = angle(k.el - k.horizon); });
    if (note.hidden === enlarged) note.hidden = !enlarged;
  }

  /** Call once per frame after the time series' update(). */
  function update() {
    const all = on ? marked() : [], o = on ? other?.() ?? null : null;
    if (el.hidden !== !on) { el.hidden = !on; drawKey = ''; }
    if (!on) { hadOther = false; return; }
    // no room for both panels: the one opened last stays
    if (o && (fresh || !hadOther) && !fits(o)) { if (fresh) closeOther?.(); else { hadOther = false; onClose?.(); return; } }
    fresh = false; hadOther = !!o;
    const pk = picked?.() ?? null;
    if (pk !== lastPicked) { lastPicked = pk; chosen = null; }
    const site = all.find(s => String(s.id) === String(chosen)) ?? all.find(s => s.id === pk) ?? all[0];
    el.classList.toggle('empty', !site);
    // Opening place: top right like the time series; while that panel stands in the right half, top left beside it
    let home = Infinity;
    if (!at.manual) {
      const hw = hero.clientWidth, left = leftOf();
      let w = Math.min(MAX_W, hw - left - EDGE);
      if (o && o.x + o.w / 2 > hw / 2) { home = left; if (o.x - EDGE - left >= MIN_W) w = Math.min(w, o.x - EDGE - left); }
      el.style.width = Math.max(Math.min(MIN_W, hw - 2 * EDGE), w) + 'px';
    }
    if (!site) { data = null; dataKey = drawKey = ''; timeEl.textContent = ''; if (at.manual) moveTo(at.x, at.y); else moveTo(home, TOP); return; }
    const lk = all.map(s => s.id + ':' + s.name).join('|') + '>' + site.id;
    if (lk !== listKey) {
      listKey = lk; nameEl.textContent = site.name; nameEl.hidden = all.length > 1; select.hidden = all.length < 2;
      select.replaceChildren(...all.map(s => { const op = document.createElement('option'); op.value = s.id; op.textContent = s.name; return op; }));
      select.value = site.id;
    }
    const w = timeWindow(), dk = w.a + '|' + w.b + '|' + groundVersion() + '|' + site.id + ':' + site.lat + ':' + site.lon;
    if (dk !== dataKey) {
      dataKey = dk; drawKey = '';
      const g = ground(site); calc = g.site;
      data = skyPaths(calc, w.a, w.b); data.a = w.a; data.b = w.b;
      basisEl.textContent = 'Horizon: ' + basisLabel(g.basis, g.horizon?.pixelM) + (g.loading ? ' (loading better ground)' : '');
    }
    const k = dataKey + '|' + plot.clientWidth + 'x' + plot.clientHeight + '|' + site.name;
    if (k !== drawKey) { drawKey = k; draw(site); lastRead = 0; }
    if (at.manual) moveTo(at.x, at.y); else moveTo(home, TOP);            // also keeps the panel inside a resized hero
    place(now());
  }
  /** The panel's rectangle in hero px while it is shown, otherwise null (the info cards keep clear of it). */
  function rect() { return el.hidden ? null : { x: at.x, y: at.y, w: el.offsetWidth, h: el.offsetHeight }; }
  function show(v) { if (v && !on) fresh = true; on = v; }
  return { update, rect, show };
}
