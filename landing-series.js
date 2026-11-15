// Solar elevation over time for the marked points on the landing-page Moon (time series panel).
// One line per marked point: the selected point and every point with an open info card (pins.marked()).
// Time axis: the time span of the sidebar (Start to Stop, UTC). With the span cleared: two lunar days
// (2 x synodic month, 2 x 29.53 d) from the simulated time, so the repetition is visible; the Sun's daily
// course repeats after one lunar day, apart from the slow seasonal drift (about 1.5 deg over 347 d). A dashed
// line marks the end of the first lunar day. The window moves on by one lunar day when the clock passes that line.
// The panel opens top right and can be dragged (or moved with the arrow keys); a moved panel stays where it was put.
// Its four corners resize it: wider, narrower, taller, lower (the plot takes the height). The plot is redrawn to fit.
// Values come from core/visibility.js: elevation of the centre of the Sun's disc above the horizon of the point in
// that direction (the terrain skyline where ui/site-data.js has one, the horizontal otherwise). Zero is the skyline.
// Under the plot one thin band per point is filled where at least half of the Sun's disc is in view: the hours
// with sunlight. When better ground arrives for a point its line and band are redrawn.
// Elevation axis: always -90 to +90 deg in steps of 30, so every plot reads the same. Time axis: two-line
// labels (day and month, the year below where it starts or changes). No describing text in the panel.
// A dot on every line marks the value at the time that is read (simulated time, or the pointer over the plot).
// A vertical line marks the simulated time. Moving the pointer over the plot reads the values at that time
// in the legend; a click sets the clock there.
// Colours: fixed order, validated for the dark surface (dataviz palette, 8 slots). A point keeps its colour
// while it is marked. More than 8 marked points: the first 8 are drawn, the panel says how many are left out.
import { DAY_MS, SYNODIC_DAYS } from './core/sky.js';
import { siteState, IN_VIEW } from './core/visibility.js';

const COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9', '#e66767'];
const NS = 'http://www.w3.org/2000/svg', HOUR = 3600000, CYCLE_MS = SYNODIC_DAYS * DAY_MS;
const M = { l: 56, r: 16, t: 12, b: 48 };                 // plot margins, px; b grows by the light bands
const BASE_B = 48, BAND_H = 4, BAND_GAP = 2, BAND_TOP = 9; // light bands between the time axis and its labels
const Y_MAX = 90, Y_STEP = 30;                          // elevation axis, deg
const EDGE = 16, TOP = 93, MIN_W = 420, MIN_PLOT_H = 220, FREE_CYCLES = 2;             // px: gap to the hero's edge, clear of the header; lunar days shown without a span                 // plot margins, px
const PER_CYCLE = 48, MIN_N = 240, MAX_N = 4000;        // samples: 48 per lunar day, within these limits
const X_STEPS = [.25, .5, 1, 2, 5, 10, 15, 30, 60, 90, 180, 365, 730, 1826, 3652];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CLOSE_SVG = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8"/></svg>';
const two = n => String(n).padStart(2, '0');
const angle = (d, digits = 1) => (d < 0 ? '−' : '+') + Math.abs(d).toFixed(digits) + '°';
const stamp = ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const svgEl = (name, attrs) => { const e = document.createElementNS(NS, name); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

/** Time window [a, b] in UTC ms: the span if set, otherwise two lunar days that page forward by one with the clock. */
export function windowFor(span, t, anchor) {
  if (span) return { a: span[0], b: span[1], anchor: null };
  if (anchor == null || t < anchor || t >= anchor + 2 * CYCLE_MS) anchor = t;
  else if (t >= anchor + CYCLE_MS) anchor += CYCLE_MS;
  return { a: anchor, b: anchor + FREE_CYCLES * CYCLE_MS, anchor, cycle: anchor + CYCLE_MS };
}
/** For one site (makeSite of core/visibility.js) at n + 1 evenly spaced times from a to b: y = elevation of the Sun's
 *  centre above its horizon (deg), lit = at least half of the disc in view. */
export function sample(site, a, b, n) {
  const y = new Float64Array(n + 1), lit = new Uint8Array(n + 1), st = { sun: {}, earth: {} };
  for (let i = 0; i <= n; i++) { const k = siteState(a + (b - a) * i / n, site, st).sun; y[i] = k.el - k.horizon; lit[i] = k.frac >= IN_VIEW ? 1 : 0; }
  return { y, lit };
}
export const sampleCount = (a, b) => Math.round(Math.max(MIN_N, Math.min(MAX_N, (b - a) / CYCLE_MS * PER_CYCLE)));
/** Axis ticks: first step of the list that gives at most `most` ticks between lo and hi. */
export function ticks(lo, hi, steps, most) {
  const step = steps.find(s => (hi - lo) / s <= most) ?? steps[steps.length - 1], out = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(Math.abs(v) < 1e-9 ? 0 : v);
  return { step, values: out };
}

/**
 * hero: the hero element (the panel lives in it); marked(): the marked sites ({ id, name, lat, lon });
 * now(): simulated UTC ms; window(): the time window { a, b, cycle? } (windowFor above, kept by the page so cards
 * and plot cover the same span); setTime(ms): jump the clock; onClose(): the panel's close button was pressed;
 * ground(site): the point for the calculation (ui/site-data.js get); groundVersion(): changes when any ground changed.
 */
export function createSeries({ hero, marked, now, window: timeWindow, setTime, onClose, ground, groundVersion }) {
  const el = document.createElement('section'); el.className = 'series'; el.hidden = true; el.tabIndex = 0;
  el.setAttribute('aria-label', 'Solar elevation above the horizon over time for the marked points');
  el.innerHTML = '<header><h2>Solar elevation above the horizon</h2><output class="series-time"></output><button type="button" class="series-close" aria-label="Close">' + CLOSE_SVG + '</button></header>'
    + '<svg class="series-plot" role="img"></svg><ul class="series-legend"></ul>';
  hero.append(el);
  const timeEl = el.querySelector('.series-time'), plot = el.querySelector('.series-plot'), legend = el.querySelector('ul');
  el.querySelector('.series-close').addEventListener('click', () => onClose?.());

  const slots = new Map();                       // site id -> colour slot, kept while the site is marked
  let on = true, key = '', win = null, shown = [], hoverMs = null, lastRead = 0, readKey = '';
  let nowLine = null, hoverLine = null, W = 0, H = 0;
  // Position in hero px. Until the panel is moved by hand it sits top right and follows the hero's width.
  const at = { x: 0, y: 0, manual: false };
  const clamp = (v, a, b) => Math.max(a, Math.min(v, Math.max(a, b)));
  function moveTo(x, y) {
    at.x = clamp(x, EDGE, hero.clientWidth - EDGE - el.offsetWidth); at.y = clamp(y, Math.min(TOP, EDGE), hero.clientHeight - EDGE - el.offsetHeight);
    el.style.transform = 'translate(' + Math.round(at.x) + 'px,' + Math.round(at.y) + 'px)';
  }
  let grab = null;
  el.addEventListener('pointerdown', e => {
    if (e.target.closest('button, .series-plot')) return;
    grab = { dx: e.clientX - at.x, dy: e.clientY - at.y }; el.setPointerCapture(e.pointerId); el.classList.add('moving');
  });
  el.addEventListener('pointermove', e => { if (grab) { at.manual = true; moveTo(e.clientX - grab.dx, e.clientY - grab.dy); } });
  const drop = () => { grab = null; el.classList.remove('moving'); };
  el.addEventListener('pointerup', drop); el.addEventListener('pointercancel', drop);
  // Corners: nw, ne, sw, se. The opposite corner stays where it is.
  const GRIP_SVG = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M12 5 5 12M12 10l-2 2"/></svg>';
  let size = null;
  for (const c of ['nw', 'ne', 'sw', 'se']) {
    const g = document.createElement('div'); g.className = 'series-grip ' + c; if (c === 'se') g.innerHTML = GRIP_SVG; el.append(g);
    g.addEventListener('pointerdown', e => {
      e.stopPropagation(); e.preventDefault();
      size = { x: e.clientX, y: e.clientY, w: el.offsetWidth, ph: plot.clientHeight, ax: at.x, ay: at.y }; g.setPointerCapture(e.pointerId);
    });
    g.addEventListener('pointermove', e => {
      if (!size) return;
      const dx = (e.clientX - size.x) * (c[1] === 'w' ? -1 : 1), dy = (e.clientY - size.y) * (c[0] === 'n' ? -1 : 1);
      const w = clamp(size.w + dx, MIN_W, hero.clientWidth - 2 * EDGE);
      const ph = clamp(size.ph + dy, MIN_PLOT_H, hero.clientHeight - 2 * EDGE - (el.offsetHeight - plot.clientHeight));
      el.style.width = w + 'px'; plot.style.height = ph + 'px'; at.manual = true;
      moveTo(c[1] === 'w' ? size.ax + size.w - w : size.ax, c[0] === 'n' ? size.ay + size.ph - ph : size.ay);
    });
    const end = () => { size = null; };
    g.addEventListener('pointerup', end); g.addEventListener('pointercancel', end);
  }
  el.addEventListener('keydown', e => {
    const d = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] }[e.key];
    if (d && e.target === el) { e.preventDefault(); at.manual = true; moveTo(at.x + d[0], at.y + d[1]); }
  });
  const xOf = ms => M.l + (ms - win.a) / (win.b - win.a) * (W - M.l - M.r);
  const msOf = x => win.a + Math.max(0, Math.min(1, (x - M.l) / (W - M.l - M.r))) * (win.b - win.a);

  /** Two lines per tick: [upper, lower]. The lower line is drawn at the first tick and where it changes. */
  function xLabel(ms, stepDays, spanDays) {
    const d = new Date(ms), mon = MONTHS[d.getUTCMonth()], day = two(d.getUTCDate()) + ' ' + mon, year = String(d.getUTCFullYear());
    if (stepDays < 1) return [two(d.getUTCHours()) + ':00', day + ' ' + year];
    return spanDays < 300 ? [day, year] : [mon, year];
  }
  const yOf = v => M.t + (Y_MAX - v) / (2 * Y_MAX) * (H - M.t - M.b);

  function draw(sites, left) {
    W = plot.clientWidth; H = plot.clientHeight;
    plot.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    const bands = sites.length * (BAND_H + BAND_GAP) + BAND_GAP;
    M.b = BASE_B + bands;
    for (const s of sites) s.calc = ground(s).site;
    const n = sampleCount(win.a, win.b), data = sites.map(s => sample(s.calc, win.a, win.b, n));
    const spanDays = (win.b - win.a) / DAY_MS, xt = ticks(win.a / DAY_MS, win.b / DAY_MS, X_STEPS, Math.max(2, Math.floor((W - M.l - M.r) / 96)));
    const kids = [];
    for (let v = -Y_MAX; v <= Y_MAX; v += Y_STEP) {
      kids.push(svgEl('line', { class: v === 0 ? 'series-zero' : 'series-grid', x1: M.l, x2: W - M.r, y1: yOf(v).toFixed(1), y2: yOf(v).toFixed(1) }));
      const t = svgEl('text', { class: 'series-tick', x: M.l - 10, y: (yOf(v) + 5).toFixed(1), 'text-anchor': 'end' });
      t.textContent = v === 0 ? '0°' : angle(v, 0); kids.push(t);
    }
    let lower = '';
    for (const v of xt.values) {
      const x = xOf(v * DAY_MS), [up, low] = xLabel(v * DAY_MS, xt.step, spanDays);
      const anchor = x > W - M.r - 28 ? 'end' : x < M.l + 28 ? 'start' : 'middle';
      kids.push(svgEl('line', { class: 'series-grid', x1: x.toFixed(1), x2: x.toFixed(1), y1: M.t, y2: H - M.b }));
      kids.push(svgEl('line', { class: 'series-axis', x1: x.toFixed(1), x2: x.toFixed(1), y1: H - M.b, y2: H - M.b + 5 }));
      const t = svgEl('text', { class: 'series-tick', x: x.toFixed(1), y: H - M.b + 21 + bands, 'text-anchor': anchor }); t.textContent = up; kids.push(t);
      if (low !== lower) { lower = low; const u = svgEl('text', { class: 'series-tick series-tick2', x: x.toFixed(1), y: H - M.b + 40 + bands, 'text-anchor': anchor }); u.textContent = low; kids.push(u); }
    }
    kids.push(svgEl('path', { class: 'series-axis', d: 'M' + M.l + ' ' + M.t + 'V' + (H - M.b) + 'H' + (W - M.r) }));     // the two axes
    sites.forEach((s, i) => {
      let d = '';
      for (let k = 0; k <= n; k++) d += (k ? 'L' : 'M') + (M.l + k / n * (W - M.l - M.r)).toFixed(1) + ' ' + yOf(data[i].y[k]).toFixed(1);
      kids.push(svgEl('path', { class: 'series-line', d, stroke: COLORS[slots.get(s.id)] }));
      // light band: a faint track over the whole span, filled where the Sun is in view
      const top = H - M.b + BAND_TOP + i * (BAND_H + BAND_GAP), xk = k => M.l + Math.max(0, Math.min(1, k / n)) * (W - M.l - M.r), lit = data[i].lit;
      kids.push(svgEl('rect', { class: 'series-track', x: M.l, y: top, width: W - M.l - M.r, height: BAND_H }));
      let run = '';
      for (let k = 0; k <= n; k++) if (lit[k] && (k === 0 || !lit[k - 1])) {
        let e = k; while (e < n && lit[e + 1]) e++;
        const x0 = xk(k - .5), x1 = xk(e + .5);
        run += 'M' + x0.toFixed(1) + ' ' + top + 'H' + x1.toFixed(1) + 'V' + (top + BAND_H) + 'H' + x0.toFixed(1) + 'Z';
        k = e;
      }
      if (run) kids.push(svgEl('path', { class: 'series-lit', d: run, fill: COLORS[slots.get(s.id)] }));
    });
    if (win.cycle) {                                       // end of the first lunar day: the curves repeat from here
      const x = xOf(win.cycle).toFixed(1);
      kids.push(svgEl('line', { class: 'series-cycle', x1: x, x2: x, y1: M.t, y2: H - M.b }));
    }
    hoverLine = svgEl('line', { class: 'series-hover', y1: M.t, y2: H - M.b }); hoverLine.style.display = 'none';
    nowLine = svgEl('line', { class: 'series-now', y1: M.t, y2: H - M.b });
    kids.push(hoverLine, nowLine);
    for (const s of sites) { s.dot = svgEl('circle', { class: 'series-dot', r: 5, fill: COLORS[slots.get(s.id)] }); kids.push(s.dot); }
    plot.replaceChildren(...kids);
    plot.setAttribute('aria-label', 'Line chart, solar elevation above the local horizon in degrees, with bands marking the hours of sunlight, from ' + stamp(win.a) + ' to ' + stamp(win.b) + ': ' + sites.map(s => s.name).join(', '));
    legend.replaceChildren(...sites.map(s => {
      const li = document.createElement('li'); li.innerHTML = '<i></i><span></span><b></b>';
      li.firstChild.style.background = COLORS[slots.get(s.id)]; li.children[1].textContent = s.name; s.valueEl = li.lastChild;
      return li;
    }));
    if (left) { const li = document.createElement('li'); li.className = 'series-more'; li.textContent = left + ' more marked point' + (left > 1 ? 's' : '') + ' not drawn'; legend.append(li); }
    readKey = '';
  }
  const readState = { sun: {}, earth: {} };
  /** Legend values and the time in the header: at the pointer while it is over the plot, otherwise at the simulated time. */
  function read(ms) {
    const k = Math.round(ms / 60000) + '|' + (hoverMs != null);
    if (k === readKey) return; readKey = k;
    timeEl.textContent = stamp(ms);
    const inside = ms >= win.a && ms <= win.b, x = inside ? xOf(ms).toFixed(1) : 0;
    for (const s of shown) {
      const k = siteState(ms, s.calc, readState).sun, v = k.el - k.horizon;
      s.valueEl.textContent = angle(v);
      s.dot.style.display = inside ? '' : 'none';
      if (inside) { s.dot.setAttribute('cx', x); s.dot.setAttribute('cy', yOf(v).toFixed(1)); }
    }
  }

  plot.addEventListener('pointermove', e => {
    if (!win) return;
    hoverMs = msOf(e.clientX - plot.getBoundingClientRect().left);
    const x = xOf(hoverMs).toFixed(1); hoverLine.setAttribute('x1', x); hoverLine.setAttribute('x2', x); hoverLine.style.display = '';
    read(hoverMs);
  });
  plot.addEventListener('pointerleave', () => { hoverMs = null; if (hoverLine) hoverLine.style.display = 'none'; if (win) read(now()); });
  plot.addEventListener('click', e => { if (win) setTime(msOf(e.clientX - plot.getBoundingClientRect().left)); });

  /** Call once per frame after pins.update(). */
  function update() {
    const all = on ? marked() : [];
    for (const id of [...slots.keys()]) if (!all.some(s => s.id === id)) slots.delete(id);
    for (const s of all) if (!slots.has(s.id) && slots.size < COLORS.length) slots.set(s.id, COLORS.findIndex((_, i) => ![...slots.values()].includes(i)));
    const sites = all.filter(s => slots.has(s.id));
    if (el.hidden !== !sites.length) { el.hidden = !sites.length; key = ''; }
    if (!sites.length) { win = null; return; }
    const t = now(), w = timeWindow();
    const k = w.a + '|' + w.b + '|' + groundVersion() + '|' + plot.clientWidth + 'x' + plot.clientHeight + '|' + sites.map(s => s.id + ':' + slots.get(s.id) + ':' + s.lat + ':' + s.lon + ':' + s.name).join();
    if (k !== key) {
      key = k; win = w; shown = sites;
      draw(sites, all.length - sites.length);
    }
    if (at.manual) moveTo(at.x, at.y); else moveTo(Infinity, TOP);            // also keeps the panel inside a resized hero
    const inside = t >= win.a && t <= win.b;
    nowLine.style.display = inside ? '' : 'none';
    if (inside) { const x = xOf(t).toFixed(1); nowLine.setAttribute('x1', x); nowLine.setAttribute('x2', x); }
    const p = performance.now();
    if (hoverMs == null && p - lastRead > 200) { lastRead = p; read(t); }
  }
  /** The panel's rectangle in hero px while it is shown, otherwise null (the info cards keep clear of it). */
  function rect() { return el.hidden ? null : { x: at.x, y: at.y, w: el.offsetWidth, h: el.offsetHeight }; }
  function show(v) { on = v; }
  return { update, rect, show };
}
