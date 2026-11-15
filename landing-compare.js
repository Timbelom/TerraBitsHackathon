// The info cards as a table ("Compare as table" in the header).
// The table stands in for the cards: while it is shown the cards and their lines leave the screen (cards.table()), and it
// shows exactly what they show, one column per open card, one row per value, in the order and with the colours of the
// cards (green and red are the cards' own judgements): the ground, the Sun and the Earth at the simulated time, the
// numbers of the time span against the limits, and the delay row with its squares (a click on a square acts as on the
// card). Nothing is calculated here: the texts come from cards.snapshot(), the verdict from cards.metrics().
// Above the table one sentence gives the verdict: the days of delay of each point, most first; with no limit set, the
// share of sunlight. It adds when points rest on different ground.
// Shown and hidden by the header entry (show(); off at the start) or its close button, which brings the cards back.
// Opens top left and can be dragged (or moved with the arrow keys).

const EDGE = 16, TOP = 93, LEFT = 72, REFRESH_MS = 200;      // px: gap to the hero's edge, clear of the header and of the Parameters tab
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

// The rows, as on the cards. [label, field] is a value; [label, labelField, field] a value whose card row has a changing
// label ("Sunset in" / "Sunrise in"): the table names the row once and the cell says which; '' starts a new group, 'delay' is the delay row, 'span' the heading with the time span.
const next = (word, f) => { const W = word === 'sun' ? 'Sun' : 'Earth', lab = f[word + 'Lab'].text; return (lab.length > W.length ? lab.slice(W.length) + ' ' : '') + f[word + 'In'].text; };
const ROWS = [
  ['Ground', 'ground'], 'delay',
  '',
  ['Sub-solar point', 'sunSub'], ['Solar elevation above horizon', 'sunEl'], ['Sun’s disc in view', 'sunFrac'], ['Next sunrise or sunset', 'sun', 'sunIn'],
  '',
  ['Sub-Earth point', 'earthSub'], ['Earth elevation above horizon', 'earthEl'], ['Earth’s disc in view', 'earthFrac'], ['Next Earthrise or Earthset', 'earth', 'earthIn'],
  'span',
  ['Sun in view', 'sunShare'], ['Longest darkness', 'sunGap'], ['Earth in view', 'earthShare'], ['Longest DTE outage', 'earthGap'],
];

/**
 * hero: the hero element (the panel lives in it); snapshot(): what the open cards show (cards.snapshot()); metrics(): their
 * numbers for the verdict (cards.metrics()); limits(): { dark, dte } in hours, null = off; onClose(): the close button was pressed.
 */
export function createCompare({ hero, snapshot, metrics, limits, onClose }) {
  const el = document.createElement('section'); el.className = 'compare'; el.hidden = true; el.tabIndex = 0;
  el.setAttribute('aria-label', 'The info cards as a table');
  el.innerHTML = '<header><h2>Compare</h2><button type="button" class="compare-close" aria-label="Back to the info cards">' + CLOSE_SVG + '</button></header>'
    + '<p class="compare-empty">Click a marker on the Moon to open its info card. The table compares the open cards.</p>'
    + '<p class="compare-verdict" role="status"></p><div class="compare-scroll"><table></table></div>';
  hero.append(el);
  const verdictEl = el.querySelector('.compare-verdict'), table = el.querySelector('table');
  el.querySelector('.compare-close').addEventListener('click', () => onClose?.());

  let on = false, key = '', last = 0, picks = [];
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
        const tr = node('tr', null, 'compare-delay'), th = node('th', 'Delay the site tolerates'); th.scope = 'row'; tr.append(th);
        for (const c of cols) { const td = node('td'), copy = c.delay.el.cloneNode(true); copy.querySelectorAll('.card-day').forEach(b => { b.tabIndex = -1; }); td.append(copy); tr.append(td); }
        tbody.append(tr); continue;
      }
      if (r === 'span') {                                                  // heading: the time span the next rows cover
        const tr = node('tr', null, 'compare-group'), th = node('th', cols[0].f.span.text); th.colSpan = cols.length + 1; th.scope = 'rowgroup'; tr.append(th); tbody.append(tr);
        continue;
      }
      const tr = node('tr', null, r[1] === 'ground' ? 'compare-plain' : gap ? 'compare-gap' : ''), th = node('th', r[0]); th.scope = 'row'; tr.append(th); gap = false;
      for (const c of cols) {
        const f = c.f[r[r.length - 1]], text = r[1] === 'ground' ? f.text.replace(/^Ground: /, '') : r.length > 2 ? next(r[1], c.f) : f.off ? '–' : f.text;
        tr.append(node('td', text, f.off ? '' : f.tone));
      }
      tbody.append(tr);
    }
    picks = cols.map(c => c.delay.pick);
    table.replaceChildren(thead, tbody);
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
        if (k !== key) { key = k; el.style.width = Math.min(hero.clientWidth - 2 * EDGE, 264 + cols.length * 232) + 'px'; draw(cols, lim); }
      }
    }
    if (at.manual) moveTo(at.x, at.y); else moveTo(LEFT, TOP);              // also keeps the panel inside a resized hero
  }
  /** The panel's rectangle in hero px while it is shown, otherwise null. */
  function rect() { return el.hidden ? null : { x: at.x, y: at.y, w: el.offsetWidth, h: el.offsetHeight }; }
  function show(v) { on = v; }
  return { update, rect, show };
}
