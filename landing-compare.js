import { dp, onScale } from './ui/scale.js';
// The info cards as a table ("Compare as table" in the header).
// The table stands in for the cards: while it is shown the cards and their lines leave the screen (cards.table()), and it
// shows exactly what they show, one column per open card, one row per value, in the order and with the colours of the
// cards (green and red are the cards' own judgements): the ground, the Sun and the Earth at the simulated time, the
// numbers of the time span against the limits, and the delay row with its squares (a click on a square acts as on the
// card). Nothing is calculated here: the texts come from cards.snapshot(), the verdict from cards.metrics().
// Above the table one sentence gives the verdict: the days of delay of each point, most first; with no limit set, the
// share of sunlight. It adds when points rest on different ground.
// Shown and hidden by the header entry (show(); off at the start) or its close button, which brings the cards back.
// It is as large as its columns and rows need, within the room of the scene, and opens beside the Moon where it covers
// least (home()); it can be dragged (or moved with the arrow keys) and then stays where it was put.

const REFRESH_MS = 200;
let EDGE, TOP, LEFT, GAP;   // design px times dp(), see ui/scale.js
onScale(k => { EDGE = 16 * k; TOP = 93 * k; LEFT = 72 * k; GAP = 24 * k; });
//      // px: gap to the hero's edge, clear of the header and of the Parameters tab
// The header is 85 px high, 119 px in windows from 1280 px (landing-search.css): cards and table start below whichever it is.
const headTop = () => Math.max(TOP, (document.querySelector('.site-header')?.offsetHeight ?? 0) + EDGE / 2);
const CLOSE_SVG = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8"/></svg>';
const share = v => (v.share * 100).toFixed(1) + ' %';
const list = names => names.length < 2 ? names.join('') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
/** Days of delay of a column, or null: no limit set, or coarse ground. */
const delayOf = c => c.delay && !c.coarse ? c.delay : null;

/**
 * The sentence above the table, from the columns of the table only. cols: cards.metrics() (name, basis, coarse,
 * sun.share, delay: { holds, all } or null); limits: { dark, dte } in hours, null = off.
 */
export function verdict(cols, limits) {
  const out = [];
  if (limits.dark == null && limits.dte == null) {
    const by = [...cols].sort((a, b) => b.sun.share - a.sun.share);
    if (by.length > 1) out.push(by.map((c, i) => c.name + (i ? ' ' : ' is illuminated ') + share(c.sun) + (i ? '' : ' of the time')).join(', ') + '.');
    out.push('Set a limit in the sidebar to compare the days of delay.');
  } else {
    const by = cols.filter(delayOf).sort((a, b) => b.delay.holds - a.delay.holds);
    const count = d => d.all ? d.holds + '+' : String(d.holds);
    if (by.length) out.push(by.map((c, i) => c.delay.holds < 0 ? c.name + ' is not feasible on the landing date'
      : i ? c.name + ' ' + count(c.delay) : c.name + ' tolerates ' + count(c.delay) + (c.delay.holds === 1 && !c.delay.all ? ' day' : ' days') + ' of delay').join(', ') + '.');
    const coarse = cols.filter(c => c.coarse).map(c => c.name);
    if (coarse.length) out.push('No reliable result for ' + list(coarse) + ' on coarse terrain data: open the terrain view.');
  }
  if (new Set(cols.map(c => c.basis)).size > 1) out.push('The values are based on different terrain data.');
  return out.join(' ');
}

// The rows, as on the cards. [label, field] is a value; [label, labelField, field] a value whose card row has a changing
// label ("Sunset in" / "Sunrise in"): the table names the row once and the cell says which; '' starts a new group, 'delay' is the delay row, 'span' the heading with the time span.
const next = (word, f) => { const W = word === 'sun' ? 'Sun' : 'Earth', lab = f[word + 'Lab'].text; return (lab.length > W.length ? lab.slice(W.length) + ' ' : '') + f[word + 'In'].text; };
const ROWS = [
  ['Terrain data', 'ground'], 'delay',
  '',
  ['Sub-solar point', 'sunSub'], ['Solar elevation above horizon', 'sunEl'], ['Sun’s disk in view', 'sunFrac'], ['Next sunrise or sunset', 'sun', 'sunIn'],
  '',
  ['Sub-Earth point', 'earthSub'], ['Earth elevation above horizon', 'earthEl'], ['Earth’s disk in view', 'earthFrac'], ['Next Earthrise or Earthset', 'earth', 'earthIn'],
  'span',
  ['Illuminated', 'sunShare'], ['Longest darkness', 'sunGap'], ['DTE available', 'earthShare'], ['Longest DTE outage', 'earthGap'],
];

/**
 * hero: the hero element (the panel lives in it); snapshot(): what the open cards show (cards.snapshot()); metrics(): their
 * numbers for the verdict (cards.metrics()); limits(): { dark, dte } in hours, null = off; onClose(): the close button was pressed.
 */
export function createCompare({ hero, snapshot, metrics, limits, onClose, disc, avoid }) {
  const el = document.createElement('section'); el.className = 'compare'; el.hidden = true; el.tabIndex = 0;
  el.setAttribute('aria-label', 'The info cards as a table');
  el.innerHTML = '<header><h2>Site comparison</h2><button type="button" class="compare-close" aria-label="Back to the info cards">' + CLOSE_SVG + '</button></header>'
    + '<p class="compare-empty">Click a marker on the Moon to open its info card. The table compares the open cards.</p>'
    + '<p class="compare-verdict" role="status"></p><div class="compare-scroll"><table></table></div>';
  hero.append(el);
  const verdictEl = el.querySelector('.compare-verdict'), table = el.querySelector('table'), scroll = el.querySelector('.compare-scroll');
  el.querySelector('.compare-close').addEventListener('click', () => onClose?.());

  let on = false, key = '', last = 0, picks = [];
  // Position in hero px. Until the panel is moved by hand it stands where there is room (home()).
  const at = { x: 0, y: 0, manual: false };
  const clamp = (v, a, b) => Math.max(a, Math.min(v, Math.max(a, b)));
  function moveTo(x, y) {
    at.x = clamp(x, EDGE, hero.clientWidth - EDGE - el.offsetWidth); at.y = clamp(y, Math.min(headTop(), EDGE), hero.clientHeight - EDGE - el.offsetHeight);
    el.style.transform = 'translate(' + Math.round(at.x) + 'px,' + Math.round(at.y) + 'px)';
  }
  let grab = null;
  el.addEventListener('pointerdown', e => {
    e.stopPropagation();                                                   // a press on the table is not a drag of the scene below (which would take the pointer and keep the release from arriving here)
    if (e.button !== 0 || e.target.closest('button')) return;
    grab = { dx: e.clientX - at.x, dy: e.clientY - at.y }; el.setPointerCapture(e.pointerId); el.classList.add('moving');
  });
  const drop = () => { grab = null; el.classList.remove('moving'); };
  // the table follows the pointer only while the button is held: a release that never arrived here ends the move too
  el.addEventListener('pointermove', e => { if (!grab) return; if (!(e.buttons & 1)) return drop(); at.manual = true; moveTo(e.clientX - grab.dx, e.clientY - grab.dy); });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(type, drop);
  el.addEventListener('keydown', e => {
    const d = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] }[e.key];
    if (d && e.target === el) { e.preventDefault(); at.manual = true; moveTo(at.x + d[0], at.y + d[1]); }
  });
  // a square of a delay row: as on the card of that column
  table.addEventListener('click', e => {
    const b = e.target.closest('.card-day'), td = b?.closest('td');
    if (b && td) { picks[td.cellIndex - 1]?.(+b.dataset.k); key = ''; }
  });

  const node = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };
  function draw(cols, lim) {
    const m = metrics();
    verdictEl.textContent = cols.length > 1 ? verdict(cols.map(c => m.find(x => x.id === c.id)).filter(Boolean), lim) : '';
    verdictEl.hidden = cols.length < 2;
    const head = node('tr'); head.append(node('td'));
    for (const c of cols) { const th = node('th', c.name); th.scope = 'col'; if (c.coord) th.append(node('small', c.coord)); head.append(th); }
    const thead = node('thead'); thead.append(head);
    const tbody = node('tbody'); let gap = false;
    for (const r of ROWS) {
      if (r === '') { gap = true; continue; }                               // a new group: set apart by spacing
      if (r === 'delay') {                                                 // the delay row of each card, copied as it is painted there
        const tr = node('tr', null, 'compare-delay'), th = node('th', 'Tolerated landing delay'); th.scope = 'row'; tr.append(th);
        for (const c of cols) { const td = node('td'), copy = c.delay.el.cloneNode(true); copy.querySelectorAll('.card-day').forEach(b => { b.tabIndex = -1; }); td.append(copy); tr.append(td); }
        tbody.append(tr); continue;
      }
      if (r === 'span') {                                                  // heading: the time span the next rows cover
        const tr = node('tr', null, 'compare-group'), th = node('th', cols[0].f.span.text); th.colSpan = cols.length + 1; th.scope = 'rowgroup'; tr.append(th); tbody.append(tr);
        continue;
      }
      const tr = node('tr', null, r[1] === 'ground' ? 'compare-plain' : gap ? 'compare-gap' : ''), th = node('th', r[0]); th.scope = 'row'; tr.append(th); gap = false;
      for (const c of cols) {
        const f = c.f[r[r.length - 1]], text = r[1] === 'ground' ? f.text.replace(/^Terrain data: /, '') : r.length > 2 ? next(r[1], c.f) : f.off ? '–' : f.text;
        tr.append(node('td', text, f.off ? '' : f.tone));
      }
      tbody.append(tr);
    }
    picks = cols.map(c => c.delay.pick);
    table.replaceChildren(thead, tbody);
  }

  // The table is as wide as its columns need (CSS: max-content) and as tall as its rows, within the room it has: from
  // the Parameters tab (or the open sidebar) to the right edge, and down to the time bar where it stands above it.
  const leftEdge = () => { const tab = document.getElementById('params-tab'); return tab ? Math.max(LEFT, tab.getBoundingClientRect().right - hero.getBoundingClientRect().left + EDGE) : LEFT; };
  const over = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  function fit() {
    el.style.maxWidth = Math.max(280 * dp(), hero.clientWidth - EDGE - leftEdge()) + 'px';
    // what lies below the table in its own columns (the time bar, the legend) ends it; the rows scroll if they do not fit
    let floor = hero.clientHeight - EDGE;
    for (const r of (avoid?.() ?? [])) if (r && r.y > at.y + 120 * dp() && r.x < at.x + el.offsetWidth && r.x + r.w > at.x) floor = Math.min(floor, r.y - EDGE);
    scroll.style.maxHeight = Math.max(160 * dp(), floor - at.y - (el.offsetHeight - scroll.offsetHeight)) + 'px';
  }
  /**
   * Where the table stands by itself: at the top, on the side of the Moon where it covers least of the Moon and of
   * the panels named by avoid() (the tutorial's hint among them). Places tried, the first wins a tie: the left
   * edge, the right edge, flush with the Moon on its left, flush on its right. Kept until the room changes, so the
   * table does not wander while other panels move.
   */
  let homeKey = '', homeAt = { x: LEFT, y: headTop() };
  function home() {
    const w = el.offsetWidth, h = el.offsetHeight, W = hero.clientWidth, d = disc?.(), l = leftEdge(), r = Math.max(l, W - EDGE - w);
    const k = [w, Math.round(h / 40), W, hero.clientHeight, l, d && Math.round(d.x), d && Math.round(d.r)].join();
    if (k === homeKey) return homeAt;
    homeKey = k;
    const xs = [l, r]; if (d && d.r > 0) xs.push(Math.min(Math.max(d.x - d.r - GAP - w, l), r), Math.min(Math.max(d.x + d.r + GAP, l), r));
    const keep = (avoid?.() ?? []).filter(Boolean).map(b => ({ b, k: 2 }));
    if (d && d.r > 0) keep.push({ b: { x: d.x - d.r, y: d.y - d.r, w: 2 * d.r, h: 2 * d.r }, k: 1 });
    let least = Infinity;
    xs.forEach((x, n) => { const cost = keep.reduce((sum, o) => sum + over({ x, y: headTop(), w, h }, o.b) * o.k, 0) + n; if (cost < least) { least = cost; homeAt = { x, y: headTop() }; } });
    return homeAt;
  }
  /** Call once per frame after cards.update(). */
  function update() {
    if (el.hidden !== !on) { el.hidden = !on; key = ''; }
    if (!on) return;
    const t = performance.now();
    if (t - last > REFRESH_MS || !key) {
      last = t;
      const cols = snapshot(), none = !cols.length;
      el.classList.toggle('empty', none);
      if (none) key = ' ';
      else {
        const lim = limits(), k = JSON.stringify([lim, cols.map(c => [c.id, c.name, c.coord, c.f, c.delay.key])]);   // redrawn only when something the table shows has changed
        if (k !== key) { key = k; draw(cols, lim); }
      }
      fit();
    }
    if (at.manual) moveTo(at.x, at.y); else { const p = home(); moveTo(p.x, p.y); }   // also keeps the panel inside a resized hero
  }
  /** The panel's rectangle in hero px while it is shown, otherwise null. */
  function rect() { return el.hidden ? null : { x: at.x, y: at.y, w: el.offsetWidth, h: el.offsetHeight }; }
  function show(v) { if (v && !on) homeKey = ''; on = v; }
  return { update, rect, show };
}
