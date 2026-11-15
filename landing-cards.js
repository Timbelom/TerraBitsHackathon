// Info cards for markers on the landing-page Moon. A click on a marker opens a card beside the Moon,
// joined to its marker by a thin line. The card shows the site's name (a field: type to rename any point;
// empty gives the original name back) and three groups of values:
//   Sun and Earth at the simulated time: sub-point, elevation of the disc centre, height of the horizon in
//     that direction, visible share of the disc, time until it next passes 50 % (rise or set)
//   the time span (Start to Stop, or the next 24 h when none is set): share of the hours with the Sun and with
//     the Earth in view, the longest stretch without each, against the limits of the sidebar that are set
//   what the numbers rest on: sky source and ground (5 m site profile, LDEM64 block, global grid, smooth sphere)
// All values come from core/visibility.js with the horizon that ui/site-data.js has for the point; when
// better ground arrives (a terrain block has loaded) the numbers are redone. Several cards can be open to
// compare sites. "View terrain" opens the terrain view around the point.
// Placement: all cards are arranged together (plan()): in columns left and right of the Moon, each card on the
// side its site is on where there is room, in a column ordered like the sites from top to bottom, clear of the
// time bar, the plot and the legend. The arrangement is redone when a card comes or goes, when the Moon is turned or
// zoomed and when a panel moves; cards glide to their new places. When there is no free place for every card the
// page zooms out (fit() says how far). Cards can be dragged (or moved with the arrow keys); a moved card stays
// where it was put and the others keep clear of it.
// While a site is behind the limb its marker, line and card are hidden; the card comes back with the site
// (a card that was not moved by hand then looks for its place again).
import { siteSky, DAY_MS } from './core/sky.js';
import { siteState, nextChange, spanMetrics, IN_VIEW, HOUR_MS } from './core/visibility.js';
import { coordText } from './landing-pins.js';

// Rise and set (the disc passing 50 %) are searched hourly for 60 days, then in 6 h steps up to 19 years (one
// cycle of the lunar nodes, so every libration state has occurred). Nothing found in that time is shown as "never".
const HOUR = HOUR_MS, SEARCH_MS = 19 * 365.25 * DAY_MS, REFRESH_MS = 200;
const MAX_SAMPLES = 9000;                                        // span metrics: hourly up to a year, coarser steps beyond
const LINE_CLEAR = 5, LINE_PAST = 14;                            // px; a line keeps this far from other cards, and turns this far past them
const GAP = 48, BETWEEN = 12, EDGE = 16, TOP = 93, LEFT = 72;   // px; TOP clears the header, LEFT the Parameters tab
const CLOSE_SVG = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8"/></svg>';
const body = (word, id) => '<dl><dt>Sub-' + (id === 'sun' ? 'solar' : 'Earth') + ' point</dt><dd data-f="' + id + 'Sub"></dd><dt>' + (id === 'sun' ? 'Solar' : 'Earth') + ' elevation above horizon</dt><dd data-f="' + id + 'El"></dd>'
  + '<dt>' + word + '\u2019s disc in view</dt><dd data-f="' + id + 'Frac"></dd><dt data-f="' + id + 'Lab"></dt><dd data-f="' + id + 'In"></dd></dl>';
const ROWS = body('Sun', 'sun') + body('Earth', 'earth')
  + '<p class="card-span" data-f="span"></p><dl class="card-limits"><dt>Sun in view</dt><dd data-f="sunShare"></dd><dt>Longest darkness</dt><dd data-f="sunGap"></dd>'
  + '<dt>Earth in view</dt><dd data-f="earthShare"></dd><dt>Longest DTE outage</dt><dd data-f="earthGap"></dd></dl>';
const clamp = (v, a, b) => Math.max(a, Math.min(v, Math.max(a, b)));
const point = p => Math.abs(p[0]).toFixed(1) + '° ' + (p[0] < 0 ? 'S' : 'N') + ', ' + p[1].toFixed(1) + '° E';
const angle = d => (d < 0 ? '−' : '+') + Math.abs(d).toFixed(1) + '°';
const span = ms => { const h = Math.floor(ms / HOUR); return Math.floor(h / 24) + ' d ' + h % 24 + ' h'; };
const day = ms => new Date(ms).toISOString().slice(0, 10);

/** hero: the hero element (cards live in it); pins: createPins api; now(): simulated UTC ms; disc(): Moon on screen {x, y, r} in hero px;
 *  avoid(): rectangles {x, y, w, h} in hero px the cards keep clear of (time series panel, time bar, legend), nulls allowed;
 *  ground(site): the point for the calculation, from ui/site-data.js get(site, true); groundVersion(): changes when any ground changed;
 *  window(): { a, b, free } the UTC span the metrics cover (free: the 24 h from the simulated time); limits(): { dark, dte } in hours, null = off; onTerrain(site): "View terrain" was pressed. */
export function createCards({ hero, pins, now, disc, avoid, ground, groundVersion, window: spanWindow, limits, onTerrain }) {
  const NS = 'http://www.w3.org/2000/svg';
  const lines = document.createElementNS(NS, 'svg'); lines.setAttribute('class', 'card-lines'); lines.setAttribute('aria-hidden', 'true');
  const root = document.createElement('div'); root.className = 'cards';
  hero.append(lines, root);
  const cards = new Map();                       // site id -> card
  let lastFill = 0;
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  let docked = null, dockTop = TOP;                // see dock() below
  pins.onOpen = s => cards.has(s.id) ? close(s.id) : open(s);
  pins.onClose = id => close(id);

  function bounds() { return { l: LEFT, t: TOP, r: hero.clientWidth - EDGE, b: hero.clientHeight - EDGE }; }
  function moveTo(c, x, y) {
    const B = bounds();
    c.x = clamp(x, Math.min(B.l, EDGE), B.r - c.w); c.y = clamp(y, B.t, B.b - c.h);
    c.tx = c.x; c.ty = c.y;
    c.el.style.transform = 'translate(' + Math.round(c.x) + 'px,' + Math.round(c.y) + 'px)';
  }
  /** Glide to x, y: the card moves there over the next frames (update()). */
  function glide(c, x, y) {
    const B = bounds();
    c.tx = clamp(x, Math.min(B.l, EDGE), B.r - c.w); c.ty = clamp(y, B.t, B.b - c.h);
    if (c.fresh || still.matches) { c.fresh = false; moveTo(c, c.tx, c.ty); }      // a new card appears in its place
  }
  /** What the cards keep clear of: the panels the page names (avoid()) and the cards moved by hand. */
  function obstacles() {
    const v = avoid?.(), out = (Array.isArray(v) ? v : [v]).filter(Boolean);
    for (const c of cards.values()) if (!c.el.hidden && (c.manual || c.held)) out.push(c);
    return out;
  }
  /**
   * All cards that were not moved by hand, arranged together beside a Moon disc d. k scales the sites' offsets from
   * the disc centre (1 = as on screen; smaller = the Moon as it would be after zooming out).
   *   Columns stand left and right of the disc, the nearest first. A column ends above or below a panel in its way.
   *   Sites further left go to the left, the others to the right; the split uses as few columns as possible and
   *   otherwise follows the side each site is on.
   *   In a column the cards stand in the order of their sites from top to bottom, as one block at the height of
   *   the Moon's centre, so the lines to the markers do not cross and the columns line up.
   * Returns the places [card, { x, y }] and over: the number of cards there is no free place for.
   */
  function plan(d, k) {
    const cur = disc(), B = bounds(), obs = obstacles(), out = [];
    const auto = [...cards.values()].filter(c => !c.el.hidden && !c.manual && !c.held).map(c => {
      const s = c.site; return { c, sx: s.vis ? d.x + (s.x - cur.x) * k : d.x, sy: s.vis ? d.y + (s.y - cur.y) * k : d.y };
    });
    const n = auto.length; if (!n) return { out, over: 0 };
    const w = auto[0].c.w, H = Math.max(...auto.map(a => a.c.h)), mid = (B.t + B.b) / 2;
    const columns = side => {
      const cols = [];
      for (let i = 0; i < 6; i++) {
        const x = side < 0 ? d.x - d.r - GAP - w - i * (w + BETWEEN) : d.x + d.r + GAP + i * (w + BETWEEN);
        if (x < B.l || x + w > B.r) break;
        let t = B.t, b = B.b;
        for (const o of obs) if (o.x < x + w + BETWEEN && o.x + o.w > x - BETWEEN) { if (o.y + o.h / 2 < mid) t = Math.max(t, o.y + o.h + BETWEEN); else b = Math.min(b, o.y - BETWEEN); }
        cols.push({ x, t, b, cap: Math.max(0, Math.floor((b - t + BETWEEN) / (H + BETWEEN))), items: [] });
      }
      return cols;
    };
    const L = columns(-1), R = columns(1), room = cs => cs.reduce((m, c) => m + c.cap, 0);
    const used = (cs, m) => { let i = 0; for (; i < cs.length && m > 0; i++) m -= cs[i].cap; return m > 0 ? Infinity : i; };   // columns needed for m cards
    auto.sort((a, b) => a.sx - b.sx);
    const natural = auto.filter(a => a.sx < d.x).length;
    let nL = -1, best = Infinity;
    for (let i = 0; i <= n; i++) { const cost = Math.max(used(L, i), used(R, n - i)) * 1000 + Math.abs(i - natural); if (cost < best) { best = cost; nL = i; } }
    const over = nL < 0 ? n - room(L) - room(R) : 0;
    if (nL < 0) nL = Math.round(n * (room(L) + 1) / (room(L) + room(R) + 2));          // no room for all: share them out, they will overlap
    for (const [cs, list, side] of [[L, auto.slice(0, nL), -1], [R, auto.slice(nL), 1]]) {
      if (!list.length) continue;
      list.sort((a, b) => a.sy - b.sy);
      let m = list.length, nc = 0; for (; nc < cs.length && m > 0; nc++) m -= cs[nc].cap;
      let use = cs.slice(0, nc).filter(c => c.cap > 0);
      if (!use.length) use = [{ x: side < 0 ? B.l : B.r - w, t: B.t, b: B.b, cap: Infinity, items: [] }];   // no column fits: along the edge
      let ci = 0;                                                            // dealt round the columns, each stays ordered by height
      for (const a of list) { for (let tries = 0; tries < use.length && use[ci % use.length].items.length >= use[ci % use.length].cap; tries++) ci++; use[ci++ % use.length].items.push(a); }
      for (const col of use) {
        if (!col.items.length) continue;
        const S = col.items.reduce((h, a) => h + a.c.h, 0) + BETWEEN * (col.items.length - 1);
        let y = clamp(d.y - S / 2, col.t, col.b - S);                       // the block stands at the height of the Moon, so the columns line up
        for (const a of col.items) { out.push([a.c, { x: col.x, y }]); y += a.c.h + BETWEEN; }
      }
    }
    return { out, over };
  }
  /** Arrange the cards again for the Moon as it is on screen now. */
  function relayout() { if (docked || !cards.size) return; for (const [c, b] of plan(disc(), 1).out) glide(c, b.x, b.y); }
  /** The largest Moon radius on screen (px, not above the present one, not below rMin) at which every card has a
   *  free place; null when that is so already. */
  function fit(rMin) {
    const d = disc();
    if (docked || !cards.size || !plan(d, 1).over) return null;
    for (let r = d.r * .94; r > rMin; r *= .94) if (!plan({ x: d.x, y: d.y, r }, r / d.r).over) return r;
    return rMin;
  }

  function open(s) {
    const el = document.createElement('section'); el.className = 'card'; el.tabIndex = 0;
    el.innerHTML = '<header><input type="text" class="card-name" aria-label="Name of this point" autocomplete="off" spellcheck="false"><button type="button" class="card-close" aria-label="Close">' + CLOSE_SVG + '</button></header><p class="card-sub"></p>' + ROWS + '<button type="button" class="card-terrain">View terrain</button>';
    el.querySelector('.card-terrain').addEventListener('click', () => onTerrain?.(s));
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
    const line = document.createElementNS(NS, 'polyline'); lines.append(line);
    const c = { site: s, el, line, f: {}, shown: {}, tones: {}, rows: {}, next: {}, over: {}, gv: -1, mKey: '', m: null, x: 0, y: 0, tx: 0, ty: 0, w: 0, h: 0 };
    el.querySelectorAll('[data-f]').forEach(n => { c.f[n.dataset.f] = n; });
    root.append(el); fill(c, now());
    c.w = el.offsetWidth; c.h = el.offsetHeight;
    cards.set(s.id, c); pins.cards.add(s.id); c.fresh = true; relayout();

    el.querySelector('.card-close').addEventListener('click', () => close(s.id));
    let grab = null;
    el.addEventListener('pointerdown', e => {
      if (e.target.closest('button, input')) return;
      c.held = true; moveTo(c, c.x, c.y);                                  // stays where it is while held
      grab = { dx: e.clientX - c.x, dy: e.clientY - c.y }; el.setPointerCapture(e.pointerId); el.classList.add('moving'); root.append(el);   // to the front
    });
    el.addEventListener('pointermove', e => { if (grab) { c.manual = true; moveTo(c, e.clientX - grab.dx, e.clientY - grab.dy); } });
    const drop = () => { grab = null; c.held = false; el.classList.remove('moving'); };
    el.addEventListener('pointerup', drop); el.addEventListener('pointercancel', drop);
    el.addEventListener('keydown', e => {
      const d = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] }[e.key];
      if (d && e.target === el) { e.preventDefault(); c.manual = true; moveTo(c, c.x + d[0], c.y + d[1]); }
      else if (e.key === 'Escape') { e.stopPropagation(); close(s.id); }
    });
  }
  function close(id) {
    const c = cards.get(id); if (!c) return;
    c.el.remove(); c.line.remove(); cards.delete(id); pins.cards.delete(id); relayout();
  }

  function set(c, k, text) { if (c.shown[k] !== text) { c.shown[k] = text; c.f[k].textContent = text; } }
  /** Colour of a value: 'good', 'bad' or '' (no judgement). Only values a mission gains or suffers from carry one. */
  function tone(c, k, t) { if (c.tones[k] !== t) { c.tones[k] = t; c.f[k].classList.toggle('good', t === 'good'); c.f[k].classList.toggle('bad', t === 'bad'); } }
  /** Show or hide a row (the value and its label). */
  function row(c, k, on) { if (c.rows[k] !== on) { c.rows[k] = on; c.f[k].hidden = !on; c.f[k].previousElementSibling.hidden = !on; } }
  const st = { sun: {}, earth: {} };
  function fill(c, ms) {
    const { lat, lon } = c.site, g = ground(c.site), site = g.site, k = siteState(ms, site, st), sub = siteSky(ms, lat, lon);
    const gv = groundVersion();
    if (c.gv !== gv) { c.gv = gv; c.next = {}; c.mKey = ''; }                 // the ground changed: rise, set and span numbers are redone
    set(c, 'sunSub', point(sub.subSolar)); set(c, 'earthSub', point(sub.subEarth));
    for (const [id, word] of [['sun', 'Sun'], ['earth', 'Earth']]) {
      const b = k[id], up = b.frac >= IN_VIEW;
      const above = b.el - b.horizon;                                  // disc centre above the skyline in that direction, as in the plot
      set(c, id + 'El', angle(above)); tone(c, id + 'El', above > 0 ? 'good' : 'bad');
      set(c, id + 'Frac', Math.round(b.frac * 100) + ' %'); tone(c, id + 'Frac', up ? 'good' : 'bad');
      let ev = c.next[id];
      // "never" found from ev.from on: after a jump back only the stretch up to ev.from has to be searched
      if (ev && !ev.at && ms < ev.from && !nextChange(ms, site, id, ev.from)) ev.from = ms;
      if (!ev || ms < ev.from || ms >= ev.redo) { const at = nextChange(ms, site, id, ms + SEARCH_MS); ev = c.next[id] = { from: ms, at, redo: at ?? ms + SEARCH_MS / 2 }; }
      // No rise or set ahead: one row says it, the share of the disc is left out
      row(c, id + 'Frac', !!ev.at);
      set(c, id + 'Lab', ev.at ? word + (up ? 'set in' : 'rise in') : word);
      set(c, id + 'In', ev.at ? span(ev.at - ms) : up ? 'always in view' : 'never in view'); tone(c, id + 'In', ev.at ? '' : up ? 'good' : 'bad');
    }
    // the time span: metrics once per span and ground, limits compared on every refresh
    const w = spanWindow(), mKey = w.a + '|' + w.b;
    if (c.mKey !== mKey) {
      c.mKey = mKey;
      const step = Math.max(1, Math.ceil((w.b - w.a) / HOUR / MAX_SAMPLES)) * HOUR;
      c.m = spanMetrics(site, w.a, w.b, step); c.m.stepH = step / HOUR;
    }
    const m = c.m, lim = limits();
    set(c, 'span', w.free ? 'Next 24 h' : day(m.startMs) + ' to ' + day(m.endMs) + ' UTC');
    for (const [id, limit] of [['sun', lim.dark], ['earth', lim.dte]]) {
      // limit null: that limit is off, the stretch is shown without a judgement. Compared unrounded, as the area on the Moon is.
      const v = m[id], gap = v.longestGapHours, over = limit != null && gap > limit;
      set(c, id + 'Share', (v.share * 100).toFixed(1) + ' % of ' + Math.round(v.hours) + ' h');
      set(c, id + 'Gap', (v.longestGapOpen ? '≥ ' : '') + (gap < 100 ? gap.toFixed(1) : Math.round(gap)) + ' h' + (limit != null ? ' · limit ' + limit + ' h' : ''));
      tone(c, id + 'Gap', limit == null ? '' : over ? 'bad' : 'good');
      if (c.over[id] !== over) { c.over[id] = over; c.f[id + 'Gap'].title = over ? 'Longer than the limit set in the sidebar' : ''; }
    }
  }

  // Docked: in the terrain view there is no Moon to stand beside. Only the card of that site is shown, top left,
  // without a line; the others wait until the view is left.
  function dock(id, top = TOP) {
    docked = id; dockTop = top;
    for (const c of cards.values()) { c.el.hidden = true; c.line.style.display = 'none'; c.docked = false; }   // every card finds its place again
  }

  /** Does the segment from x1, y1 to x2, y2 pass through the card o (with a margin of m px around it)? */
  function crosses(x1, y1, x2, y2, o, m) {
    const dx = x2 - x1, dy = y2 - y1;
    let t0 = 0, t1 = 1;
    for (const [p, q] of [[-dx, x1 - (o.x - m)], [dx, o.x + o.w + m - x1], [-dy, y1 - (o.y - m)], [dy, o.y + o.h + m - y1]]) {
      if (p === 0) { if (q < 0) return false; continue; }
      const r = q / p;
      if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
    }
    return true;
  }
  /**
   * The line from a card to its site s, as x, y pairs from the card to the site; null when the card lies on the site.
   * Straight from the nearest point of the card, unless another card lies on that way (a card in an outer column
   * behind one in an inner column). Then the line leaves the card level, at a height where it passes above or below
   * the cards in between, and turns to the site once it is past them. No free way: the straight line.
   */
  function route(c, s) {
    const x = clamp(s.x, c.x, c.x + c.w), y = clamp(s.y, c.y, c.y + c.h);              // nearest point of the card
    if (x === s.x && y === s.y) return null;
    const others = []; for (const o of cards.values()) if (o !== c && !o.el.hidden) others.push(o);
    const hit = (x1, y1, x2, y2) => others.some(o => crosses(x1, y1, x2, y2, o, LINE_CLEAR));
    const side = s.x < c.x ? -1 : s.x > c.x + c.w ? 1 : 0;
    if (!side || !hit(x, y, s.x, s.y)) return [x, y, s.x, s.y];
    const ex = side < 0 ? c.x : c.x + c.w;                                              // the edge that faces the site
    let wx = ex;                                                                        // where the line is past the cards in between
    for (const o of others) {
      if (side > 0 ? o.x + o.w > ex && o.x < s.x : o.x < ex && o.x + o.w > s.x) wx = side > 0 ? Math.max(wx, o.x + o.w + LINE_PAST) : Math.min(wx, o.x - LINE_PAST);
    }
    if (side > 0 ? wx >= s.x : wx <= s.x) return [x, y, s.x, s.y];                      // the site itself lies under a card
    const lo = c.y + LINE_CLEAR, hi = c.y + c.h - LINE_CLEAR;
    for (let d = 0; d <= hi - lo; d += 2) {                                             // heights on the edge, the nearest to the straight line first
      for (const yy of d ? [y - d, y + d] : [y]) {
        if (yy < lo || yy > hi) continue;
        if (!hit(ex, yy, wx, yy) && !hit(wx, yy, s.x, s.y)) return [ex, yy, wx, yy, s.x, s.y];
      }
    }
    return [x, y, s.x, s.y];
  }

  /** Call once per frame after pins.update(). */
  function update() {
    if (!cards.size) return;
    const t = performance.now(), refresh = t - lastFill > REFRESH_MS, ms = now();
    if (refresh) lastFill = t;
    if (docked) {
      const c = cards.get(docked); if (!c) return;
      if (c.el.hidden) { c.el.hidden = false; fill(c, ms); }
      if (refresh) { fill(c, ms); c.h = c.el.offsetHeight; }
      if (!c.docked) { c.docked = true; moveTo(c, LEFT, dockTop); } else if (refresh) moveTo(c, c.x, c.y);
      return;
    }
    let again = refresh;
    for (const c of cards.values()) {
      const vis = !!c.site.vis;
      if (c.el.hidden === vis) {                                                         // the site went behind the limb or came back
        c.el.hidden = !vis; c.line.style.display = vis ? '' : 'none'; again = true;
        if (vis) { fill(c, ms); c.fresh = !c.manual; }
      }
      if (vis && refresh) { fill(c, ms); c.h = c.el.offsetHeight; if (c.manual) moveTo(c, c.x, c.y); }   // also keeps moved cards inside a resized window
    }
    // The arrangement follows the sites, the panels and the window: redone a few times a second and whenever a card comes or goes
    if (again) relayout();
    for (const c of cards.values()) {
      const s = c.site;
      if (!s.vis) continue;
      if (c.x !== c.tx || c.y !== c.ty) {                                                // on the way to its place
        const nx = c.x + (c.tx - c.x) * .2, ny = c.y + (c.ty - c.y) * .2, there = Math.abs(c.tx - nx) < .5 && Math.abs(c.ty - ny) < .5;
        c.x = there ? c.tx : nx; c.y = there ? c.ty : ny;
        c.el.style.transform = 'translate(' + Math.round(c.x) + 'px,' + Math.round(c.y) + 'px)';
      }
      const pts = route(c, s);                                                           // no line when the card lies on its site
      c.line.style.display = pts ? '' : 'none';
      if (pts) c.line.setAttribute('points', pts.map(v => v.toFixed(1)).join(' '));
    }
  }
  return { update, open, close, dock, relayout, fit, count: () => cards.size, has: id => cards.has(id) };
}
