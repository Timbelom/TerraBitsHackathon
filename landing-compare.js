// Comparison of the marked points on the landing-page Moon ("Compare" in the header).
// A table: one column per marked point (the selected point and every point with an open info card, pins.marked()),
// one row per number of the cards: Sun in view, longest darkness, Earth in view, longest outage of direct-to-Earth
// (DTE) communication, days of delay the site tolerates, and the ground the numbers rest on. The numbers are those of
// the open cards (cards.metrics() of landing-cards.js), nothing is calculated here; a marked point without a card
// says "open its card". The best value of a row carries a tick (most Sun and Earth, shortest gaps, most days of delay);
// no tick when the values are equal. On coarse ground a point has no days of delay (the card says so too).
// Above the table one sentence gives the verdict, from the numbers of the table only: the days of delay of each point,
// most first; with no limit set, the share of sunlight. It adds when points rest on different ground.
// The panel behaves like the time series: shown and hidden by the header entry (show(); off at the start), with a
// close button, opens top left and can be dragged (or moved with the arrow keys); the info cards keep clear of it (rect()).

const EDGE = 16, TOP = 93, LEFT = 72, REFRESH_MS = 250;      // px: gap to the hero's edge, clear of the header and of the Parameters tab
const HOUR = 3600000, DAY = 86400000;
const CLOSE_SVG = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8"/></svg>';
const BEST_SVG = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 7.5l3 3 6-7"/></svg>';
const day = ms => new Date(ms).toISOString().slice(0, 10);
const hours = (h, open) => (open ? '≥ ' : '') + (h < 100 ? h.toFixed(1) : Math.round(h)) + ' h';
const share = v => (v.share * 100).toFixed(1) + ' %';
const list = names => names.length < 2 ? names.join('') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
/** Days of delay of a column, or null: no card, no limit set, or coarse ground. */
const delayOf = c => c.delay && !c.coarse ? c.delay : null;

/** Indices of the best of the values (numbers; null = no value): the highest, or the lowest with higher = false. Empty with fewer than two values or when all are equal. */
export function bestOf(values, higher = true) {
  const have = values.filter(v => v != null), out = new Set();
  if (have.length < 2 || have.every(v => v === have[0])) return out;
  const best = higher ? Math.max(...have) : Math.min(...have);
  values.forEach((v, i) => { if (v === best) out.add(i); });
  return out;
}

/**
 * The sentence above the table, from the columns of the table only. cols: cards.metrics() (name, basis, coarse,
 * sun.share, delay: { holds, all } or null); limits: { dark, dte } in hours, null = off.
 */
export function verdict(cols, limits) {
  const out = [];
  if (limits.dark == null && limits.dte == null) {
    const by = [...cols].sort((a, b) => b.sun.share - a.sun.share);
    if (by.length > 1) out.push(by.map((c, i) => c.name + (i ? ' ' : ' has the Sun in view ') + share(c.sun) + (i ? '' : ' of the time')).join(', ') + '.');
    out.push('Set a limit in the sidebar to compare the days of delay.');
  } else {
    const by = cols.filter(delayOf).sort((a, b) => b.delay.holds - a.delay.holds);
    const count = d => d.all ? d.holds + '+' : String(d.holds);
    if (by.length) out.push(by.map((c, i) => c.delay.holds < 0 ? c.name + ' is not viable on the landing date'
      : i ? c.name + ' ' + count(c.delay) : c.name + ' holds ' + count(c.delay) + (c.delay.holds === 1 && !c.delay.all ? ' day' : ' days') + ' of delay').join(', ') + '.');
    const coarse = cols.filter(c => c.coarse).map(c => c.name);
    if (coarse.length) out.push('No reliable answer for ' + list(coarse) + ' on coarse ground: open the terrain.');
  }
  if (new Set(cols.map(c => c.basis)).size > 1) out.push('The values rest on different ground.');
  return out.join(' ');
}

/** The rows of the table: label and, per column, the text and the number that is compared (null = not compared). */
export function rows(cols, missionMs) {
  const cell = (text, value = null) => ({ text, value });
  const mission = missionMs == null ? '' : ', ' + (missionMs % DAY ? Math.round(missionMs / HOUR) + ' h' : missionMs / DAY + ' d') + ' mission';
  return [
    { label: 'Sun in view', higher: true, cells: cols.map(c => cell(share(c.sun), c.sun.share)) },
    { label: 'Longest darkness', higher: false, cells: cols.map(c => cell(hours(c.sun.longestGapHours, c.sun.longestGapOpen), c.sun.longestGapHours)) },
    { label: 'Earth in view', higher: true, cells: cols.map(c => cell(share(c.earth), c.earth.share)) },
    { label: 'Longest DTE outage', higher: false, cells: cols.map(c => cell(hours(c.earth.longestGapHours, c.earth.longestGapOpen), c.earth.longestGapHours)) },
    { label: 'Days of delay' + mission, higher: true, cells: cols.map(c => !c.delay ? cell('no limit set') : c.coarse ? cell('coarse ground')
      : cell(c.delay.holds < 0 ? 'not viable' : c.delay.holds + (c.delay.all ? '+' : '') + ' d', c.delay.holds)) },
    { label: 'Ground', plain: true, cells: cols.map(c => cell(c.ground + (c.coarse ? ' (coarse)' : ''))) },
  ];
}

/**
 * hero: the hero element (the panel lives in it); marked(): the marked sites ({ id, name }); metrics(): the numbers of the
 * open cards (cards.metrics()); limits(): { dark, dte } in hours, null = off; onClose(): the panel's close button was pressed.
 */
export function createCompare({ hero, marked, metrics, limits, onClose }) {
  const el = document.createElement('section'); el.className = 'compare'; el.hidden = true; el.tabIndex = 0;
  el.setAttribute('aria-label', 'Comparison of the marked points');
  el.innerHTML = '<header><h2>Compare</h2><button type="button" class="compare-close" aria-label="Close">' + CLOSE_SVG + '</button></header>'
    + '<p class="compare-empty">Mark two or more points on the Moon and open their cards to compare them.</p>'
    + '<p class="compare-verdict" role="status"></p><p class="compare-span"></p><div class="compare-scroll"><table></table></div>';
  hero.append(el);
  const verdictEl = el.querySelector('.compare-verdict'), spanEl = el.querySelector('.compare-span'), table = el.querySelector('table');
  el.querySelector('.compare-close').addEventListener('click', () => onClose?.());

  let on = false, key = '', last = 0;
  // Position in hero px. Until the panel is moved by hand it sits top left.
  const at = { x: 0, y: 0, manual: false };
  const clamp = (v, a, b) => Math.max(a, Math.min(v, Math.max(a, b)));
  function moveTo(x, y) {
    at.x = clamp(x, EDGE, hero.clientWidth - EDGE - el.offsetWidth); at.y = clamp(y, Math.min(TOP, EDGE), hero.clientHeight - EDGE - el.offsetHeight);
    el.style.transform = 'translate(' + Math.round(at.x) + 'px,' + Math.round(at.y) + 'px)';
  }
  let grab = null;
  el.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    grab = { dx: e.clientX - at.x, dy: e.clientY - at.y }; el.setPointerCapture(e.pointerId); el.classList.add('moving');
  });
  el.addEventListener('pointermove', e => { if (grab) { at.manual = true; moveTo(e.clientX - grab.dx, e.clientY - grab.dy); } });
  const drop = () => { grab = null; el.classList.remove('moving'); };
  el.addEventListener('pointerup', drop); el.addEventListener('pointercancel', drop);
  el.addEventListener('keydown', e => {
    const d = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] }[e.key];
    if (d && e.target === el) { e.preventDefault(); at.manual = true; moveTo(at.x + d[0], at.y + d[1]); }
  });

  const node = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };
  function draw(sites, cols, lim) {
    const withCard = sites.map(s => cols.find(c => c.id === s.id)).filter(Boolean), first = withCard[0];
    verdictEl.textContent = withCard.length > 1 ? verdict(withCard, lim) : 'Open the cards of the marked points to compare their numbers.';
    // the span the numbers cover and the limits they are held against; the first mention of DTE spells it out
    spanEl.textContent = (first ? (first.free ? 'Next 24 h' : day(first.startMs) + ' to ' + day(first.endMs) + ' UTC') + ' · ' : '')
      + 'Limits: darkness ' + (lim.dark == null ? 'off' : lim.dark + ' h') + ', direct-to-Earth (DTE) outage ' + (lim.dte == null ? 'off' : lim.dte + ' h');
    const head = node('tr'); head.append(node('td'));
    for (const s of sites) { const th = node('th', s.name); th.scope = 'col'; head.append(th); }
    const thead = node('thead'); thead.append(head);
    const tbody = node('tbody'), all = rows(withCard, first?.missionMs);
    all.forEach((r, ri) => {
      const tr = node('tr', null, r.plain ? 'compare-plain' : ''), th = node('th', r.label); th.scope = 'row'; tr.append(th);
      const best = r.plain ? new Set() : bestOf(r.cells.map(c => c.value), r.higher);
      for (const s of sites) {
        const i = withCard.findIndex(c => c.id === s.id);
        if (i < 0) { if (!ri) { const td = node('td', 'open its card', 'compare-none'); td.rowSpan = all.length; tr.append(td); } continue; }
        const td = node('td', r.cells[i].text, r.cells[i].value == null ? 'compare-text' : '');
        if (best.has(i)) { td.className = 'compare-best'; td.insertAdjacentHTML('afterbegin', BEST_SVG + '<span class="compare-sr">best: </span>'); }
        tr.append(td);
      }
      tbody.append(tr);
    });
    table.replaceChildren(thead, tbody);
  }

  /** Call once per frame after cards.update(). */
  function update() {
    if (el.hidden !== !on) { el.hidden = !on; key = ''; }
    if (!on) return;
    const t = performance.now();
    if (t - last > REFRESH_MS || !key) {
      last = t;
      const sites = marked(), few = sites.length < 2;
      el.classList.toggle('empty', few);
      if (few) key = ' ';
      else {
        const cols = metrics(), lim = limits();
        // redrawn only when something the table shows has changed
        const k = JSON.stringify([sites.map(s => [s.id, s.name]), lim, cols.map(c => [c.id, c.basis, c.free, c.startMs, c.endMs, c.missionMs, c.sun.share, c.sun.longestGapHours, c.earth.share, c.earth.longestGapHours, c.delay && [c.delay.holds, c.delay.all]])]);
        if (k !== key) { key = k; el.style.width = Math.min(hero.clientWidth - 2 * EDGE, 248 + sites.length * 176) + 'px'; draw(sites, cols, lim); }
      }
    }
    if (at.manual) moveTo(at.x, at.y); else moveTo(LEFT, TOP);              // also keeps the panel inside a resized hero
  }
  /** The panel's rectangle in hero px while it is shown, otherwise null (the info cards keep clear of it). */
  function rect() { return el.hidden ? null : { x: at.x, y: at.y, w: el.offsetWidth, h: el.offsetHeight }; }
  function show(v) { on = v; }
  return { update, rect, show };
}
