import { dp, onScale } from './ui/scale.js';
// Tutorial of the landing page: twelve stops at the page's own controls, in three chapters.
// "Tutorial" on the title page, "Tutorial" in the header and "Start the tutorial" at the end of the guided demo
// start it (landing-demo.js runs the page's opening move first). The demo tells why a landing site depends on the
// date; the tutorial shows how to ask that question with the tool. The page stays in the user's hands throughout.
//
// Every stop has the same parts, in the order of an experiment:
//   a question     what a user wants to know at this control
//   the answer     what the control is and what its numbers mean, two or three sentences
//   Try it         one action. The stop watches the page and ticks the action off when it has been done.
//                  "Show me" does it for the user, with the page's own controls, so that it can be watched.
//   Observed       what the page then says, read from the page itself (the line under the limit sliders, the card,
//                  the legend, the table's verdict). No number here is written into the tutorial.
//   Note           the one thing that is easily misread at that control.
// Controls that explain themselves (play, the speeds, panel handles) have no stop; they are listed on the
// "Reference" sheet together with the definitions behind the numbers and the sources.
//
// The tutorial changes the page only where a stop cannot be shown otherwise (the sidebar opens for the stops about
// its controls; a stop about the card marks Connecting ridge when no point is marked; the table closes when a stop
// needs the cards) and through "Show me". What the user set stays as it is when the tutorial is closed.
//
// Where the hint stands is fixed per stop, so it does not wander: top right of the scene; top left for the stops
// whose subject stands at the right (the plots, the legend); and for the stops about the info card the side where
// the cards are not (dock: 'card': left only when every card stands at the right), which the stops after them keep. The side is settled once per
// stop; the place itself is plain CSS (anchored to the edge of the scene), so the hint follows the scene exactly
// when the sidebar narrows it. A change of side is a short fade, never a slide across the picture. The hint can be
// dragged; at the next stop it is back in its place. It ends above the time bar where the window is high enough; a
// long stop scrolls between its head and its buttons.

const HOUR = 3600000, DAY = 24 * HOUR;
const OFF = 97;                                                   // right end of the limit sliders: no limit
const EXAMPLE = 'cr', SECOND = 'sh';                              // Connecting ridge and Shackleton rim: the two listed sites with 5 m ground
const CHAPTERS = ['Basics', 'Mission limits', 'The analysis'];
let EDGE, TOP, MIN_ROOM;   // design px times dp(), see ui/scale.js
onScale(k => { EDGE = 16 * k; TOP = 93 * k; MIN_ROOM = 560 * k; });
//                                        // px; TOP clears the header (as the cards do; the same value stands in landing-tour.css)
const CHECK_MS = 150;                             // px: with less height than this above the time bar the hint is not cut short there; it then lies over the bar's end
const stamp = ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
const days = ms => { const d = ms / DAY; return d < 2 ? Math.round(ms / HOUR) + ' h' : (Math.abs(d - Math.round(d)) < .02 ? Math.round(d) : d.toFixed(1)) + ' d'; };
// the line under the two limit sliders (landing-area.js), e.g. "31.2 % of the Moon stays within both limits from … to … UTC. Marked on the Moon; …"
const AREA = /^(Under 0\.1|[\d.]+) % of the Moon stays within (both limits|the limit) (?:in the 24 h from (\S+ \S+)|from (\S+ \S+) to (\S+ \S+)) UTC/;
const utc = s => Date.parse(s.replace(' ', 'T') + ':00Z');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CHECK_SVG = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7.4 5.8 10 11 4"/></svg>';
const CLOSE_SVG = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8"/></svg>';

// The reference sheet: everything that has no stop of its own. Groups of term and meaning.
const REFERENCE = [
  ['Time bar', [
    ['Play, Pause', 'Runs the clock at 1.4 h of simulated time per second.'],
    ['−1 h, +1 h', 'One hour back or forward. Stays within a set time span.'],
    ['2×, 12×, 250×', 'Faster. 12× is one week in 10 s, 250× one year in 25 s.'],
    ['Slider', 'The time within the span; with no span, within two lunar days from the simulated time.'],
    ['Start, Stop, Clear', 'The mission time span in UTC. Clear removes it.'],
    ['Line under the slider', 'Source of the Sun and Earth positions at this time: JPL Horizons for 2027–2066, an analytic model outside those years.'],
  ]],
  ['Scene', [
    ['Drag', 'Rotates the view. In the terrain view it rotates the terrain, and scrolling zooms.'],
    ['Ctrl + scroll, + and −', 'Zoom between the Moon and the whole system.'],
    ['Click on the Moon', 'Marks a point. A click on the marker opens its card.'],
    ['Backspace', 'Removes the most recent marker, with its card.'],
    ['Esc', 'Closes the sidebar; in the terrain view, goes back to the Moon. While the tutorial runs it closes the tutorial.'],
    ['Pointer', 'Shows the values under it: coordinates, elevation, solar elevation, and the limits where they are set.'],
  ]],
  ['Search and coordinates', [
    ['Search field', 'The name of a listed site, or latitude, longitude in any common notation, for example 89.45 S, 137.2 W.'],
    ['Coordinates in the sidebar', 'Decimal degrees, longitude 0–360° E, Mean Earth/Polar Axis frame (MOON_ME). Copy puts them on the clipboard.'],
    ['Name on a card', 'Type to rename a site. Named sites are kept for this browser session and appear in the search.'],
  ]],
  ['Parameters', [
    ['Max. darkness, Max. DTE outage', '0 to 96 h; the right end is Off. Team assumptions, not lander specifications.'],
    ['Surface', 'Shaded relief, imagery (LROC WAC), elevation (LOLA), mean illumination and DTE availability. On the globe the last two are 2027 means; in the terrain view they cover your span.'],
    ['Layers', 'Sun and Earth paths, listed landing sites, latitude and longitude grid, elevation contours, 200 km squares.'],
    ['Edge of the sidebar', 'Drag it, or use the arrow keys on it, to change the width.'],
  ]],
  ['Panels', [
    ['Solar elevation, Sky view, Compare as table', 'Opened and closed in the header. Drag a panel to move it; the arrow keys move a focused panel.'],
    ['Corners of Solar elevation', 'Resize the chart.'],
    ['Squares on a card', 'A click moves the landing to that day of delay.'],
  ]],
  ['Definitions', [
    ['In view', 'At least half of the disk is above the terrain horizon. Angular radius: Sun 0.2666°, Earth from its distance.'],
    ['Elevation above horizon', 'Angle of the disk center above the terrain horizon at the azimuth of the body. Zero is the horizon.'],
    ['Longest darkness, longest DTE outage', 'The longest continuous interval with less than half the disk in view within the span, from hourly samples.'],
    ['DTE', 'Direct-to-Earth communication: an unobstructed line of sight to Earth. No link budget, no ground-station coverage.'],
    ['Terrain data', 'The elevation model behind a horizon, best first: 5 m site DEM, LDEM64 (474 m pixels), global grid (7.6 km cells), smooth sphere. Every card names it.'],
    ['Apparent sizes', 'The Sun and Earth are drawn at three times their true angular size. All numbers use the true sizes.'],
  ]],
  ['Sources', [
    ['Terrain', 'NASA LRO LOLA gridded topography (GSFC PGDA): LDEM64 for the whole Moon, 5 m site DEMs for Connecting Ridge and Shackleton Rim.'],
    ['Sun and Earth', 'NASA JPL Horizons (DE441), hourly, 2027 to 2066, frame MOON_ME.'],
    ['Not modeled', 'Temperature, relay satellites, ground stations, link budget.'],
  ]],
];

export function createTour({ api, hero, onClose }) {
  const { pivot, reduce } = api;
  const $ = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const field = id => document.getElementById(id);
  const q = sel => document.querySelector(sel);
  const shown = e => !!e && !e.hidden && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const read = sel => { const e = typeof sel === 'string' ? q(sel) : sel; return e ? e.textContent.replace(/\s+/g, ' ').trim() : ''; };
  const pressed = id => field(id)?.getAttribute('aria-pressed') === 'true';

  // --- Elements -------------------------------------------------------------------------------------
  const panel = $('section', 'tour-hint'); panel.hidden = true; panel.setAttribute('aria-label', 'Tutorial');
  panel.innerHTML = '<header class="tour-head"><p class="tour-chapter"></p><button type="button" class="tour-ref-open">Reference</button><button type="button" class="tour-close" aria-label="Close tutorial">Close</button></header>'
    + '<div class="tour-steps" aria-hidden="true"></div>'
    + '<div class="tour-scroll"><div class="tour-body" aria-live="polite"><h2 class="tour-q"></h2><p class="tour-text"></p></div>'
    + '<div class="tour-try"><i class="tour-check">' + CHECK_SVG + '</i><p><b>Try it</b><span class="tour-try-text"></span></p><button type="button" class="tour-auto">Show me</button></div>'
    + '<div class="tour-seen" role="status" hidden><b>Observed</b><div class="tour-seen-text"></div></div>'
    + '<p class="tour-note" hidden><b>Note</b><span class="tour-note-text"></span></p></div>'
    + '<div class="tour-nav"><button type="button" class="tour-back">Back</button><span class="tour-count"></span><button type="button" class="tour-next">Next</button></div>';
  const sheet = $('section', 'tour-ref'); sheet.hidden = true; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', 'Reference'); sheet.tabIndex = -1;
  sheet.innerHTML = '<header><h2>Reference</h2><p>Every control that has no stop in the tutorial, the definitions behind the numbers, and the sources.</p><button type="button" class="tour-close" aria-label="Close reference">' + CLOSE_SVG + '</button></header>'
    + '<div class="tour-ref-grid">' + REFERENCE.map(([title, rows]) => '<section><h3>' + title + '</h3><dl>' + rows.map(([k, v]) => '<dt>' + k + '</dt><dd>' + v + '</dd>').join('') + '</dl></section>').join('') + '</div>';
  hero.append(panel, sheet);
  const el = Object.fromEntries(['chapter', 'count', 'steps', 'scroll', 'q', 'text', 'try', 'try-text', 'auto', 'seen', 'seen-text', 'note', 'note-text', 'back', 'next', 'ref-open']
    .map(k => [k.replace(/-(.)/g, (m, c) => c.toUpperCase()), panel.querySelector('.tour-' + k)]));
  // nothing of the tutorial's own passes through to the scene below (drag, marker, zoom, values under the pointer)
  for (const box of [panel, sheet]) for (const type of ['pointerdown', 'pointermove', 'click', 'wheel', 'dblclick']) box.addEventListener(type, e => e.stopPropagation());

  // --- State ----------------------------------------------------------------------------------------
  let on = false, index = 0, token = 0, base = null, flags = {}, wasDone = false, seenKey = '', busy = false;
  let spots = [], lastCheck = 0, log = [];

  const wait = ms => { const my = token; return new Promise(r => setTimeout(() => r(my === token), reduce.matches ? Math.min(ms, 60) : ms)); };
  /** Resolves true as soon as test() holds, false when the time is up or the stop has changed. */
  function until(test, ms = 30000) {
    const my = token, t0 = performance.now();
    return new Promise(done => { const tick = () => { const ok = !!test(); if (ok || my !== token || performance.now() - t0 > ms) done(ok && my === token); else setTimeout(tick, 100); }; tick(); });
  }

  // --- The page, read and set through its own controls ---------------------------------------------------
  const sideOpen = () => field('params').classList.contains('open');
  let sideByTour = false;                                         // the tutorial opened the sidebar: it may close it again when a stop needs the room
  const setSide = open => { if (sideOpen() === open) return; if (!open && !sideByTour) return; sideByTour = open; field('params-tab').click(); };
  const limit = id => { const v = +field(id).value; return v >= OFF ? null : v; };
  const noLimit = () => limit('p-dark') == null && limit('p-dte') == null;
  const site = id => api.pins.sites.find(s => s.id === id);
  const cards = () => api.pins.marked().filter(s => api.cards.has(s.id));
  const cardEl = () => [...document.querySelectorAll('.card')].find(shown) ?? null;
  const tabled = () => pressed('compare-toggle');
  function mark(id) { const s = site(id); if (!s || api.cards.has(s.id)) return s; api.pins.pick(s); api.cards.open(s); return s; }
  /** A stop about the card needs one: Connecting ridge is marked when no point is, and the table gives way to the cards. */
  function needCard() {
    if (tabled()) field('compare-toggle').click();
    if (!cards().length) { const s = mark(EXAMPLE); if (s && api.scope() === 'system') api.pins.face(s); }
  }
  const intoView = sel => setTimeout(() => cardEl()?.querySelector(sel)?.scrollIntoView({ block: 'nearest' }), 300);
  /** The line under the limit sliders as numbers, or null while there is none (no limit set, still calculating). */
  function area() {
    const m = AREA.exec(read('#p-area-note')); if (!m) return null;
    const a = utc(m[3] ?? m[4]), b = m[5] ? utc(m[5]) : a + DAY;
    return { pct: m[1] === 'Under 0.1' ? 'under 0.1' : m[1], both: m[2] === 'both limits', a, b, free: !m[5], key: m[1] + '|' + m[2] + '|' + a + '|' + b + '|' + limit('p-dark') + '|' + limit('p-dte') };
  }
  const areaLine = () => { const t = read('#p-area-note'); return AREA.test(t) ? esc(t.split('. Marked')[0]) + '.' : /^Calculating/.test(t) ? esc(t) : ''; };
  /** Move a slider to a value so that the move can be watched. */
  async function slide(id, to) {
    const r = field(id), from = +r.value, my = token, ms = reduce.matches ? 0 : 1300;
    if (from === to) return true;
    r.scrollIntoView({ block: 'nearest' });
    await new Promise(done => {
      const t0 = performance.now();
      const step = now => {
        if (my !== token) return done();
        const p = ms ? Math.min(Math.max((now - t0) / ms, 0), 1) : 1, v = Math.round(from + (to - from) * (.5 - .5 * Math.cos(Math.PI * p)));
        if (+r.value !== v) { r.value = v; r.dispatchEvent(new Event('input')); }
        if (p < 1) requestAnimationFrame(step); else done();
      };
      requestAnimationFrame(step);
    });
    return my === token;
  }
  const hourNow = () => Math.floor(api.now() / HOUR) * HOUR;
  const full = t => t ? t.replace(/[.\s]+$/, '') + '.' : '';        // a text of the page as a sentence
  const cardValue = (c, f) => esc(read(c.querySelector('[data-f="' + f + '"]')));

  // --- The stops --------------------------------------------------------------------------------------
  // ch: chapter. dock: where the hint stands (see the head of this file; top right when not given). spot: the controls the stop is about (selectors, or a function giving elements); the hint stands
  // beside the first. enter: what the stop needs to be there. done(flags): the action has been carried out.
  // seen(): what the page says about it, as HTML; shown once the action is done (always: also before).
  // auto: carries the action out with the page's own controls.
  const STOPS = [
    { ch: 0, q: 'What am I looking at?',
      text: 'The Moon as measured by NASA’s LOLA laser altimeter, illuminated for the time shown in the bar below. Sun and Earth positions are from JPL Horizons for that time.',
      act: 'Drag the Moon to turn it.',
      done: f => !!f.turned,
      seen: () => 'You turn the whole system. Light and shadow stay as they are at this time; only the clock moves them.',
      note: 'Ctrl + scroll, or + and −, zooms between the Moon and the whole system.',
      async auto() { api.pins.turnTo(pivot.rotation.x, pivot.rotation.y + .7); if (await wait(900)) flags.turned = true; } },

    { ch: 0, q: 'When does my mission run?', spot: ['#timebar'],
      text: 'One clock, in UTC, moves the Sun, Earth and every number on the page. <b>Start</b> and <b>Stop</b> mark your mission: the cards, the area on the Moon, the maps and the charts are all calculated for that span.',
      act: 'Set a Start date and a Stop date.',
      done: () => !!api.span(),
      seen: () => { const [a, b] = api.span(); return 'Span: ' + stamp(a) + ' to ' + stamp(b) + ' UTC, ' + days(b - a) + '. The slider now runs over this span and the clock repeats it.'; },
      note: 'With no span set, the cards and the area use the next 24 h, the charts two lunar days.',
      async auto() { const a = hourNow(); api.setSpan(a, a + 10 * DAY); } },

    { ch: 0, q: 'Where do I land?', spot: ['.site-header .search'],
      text: 'Click the Moon to mark a site, then click the marker to open its card. Or use the search field: the name of a listed site, or latitude and longitude in degrees.',
      act: 'Mark a site and open its card.',
      enter: () => { if (tabled()) field('compare-toggle').click(); },
      done: () => cards().length > 0,
      seen: () => { const s = cards().at(-1), named = !/^\d/.test(s.name);                    // a free marker is named by its coordinates
        return 'Marked: ' + (named ? esc(s.name) + ', ' : '') + Math.abs(s.lat).toFixed(4) + '° ' + (s.lat < 0 ? 'S' : 'N') + ', ' + (+s.lon).toFixed(4) + '° E. ' + esc(full(read(cardEl()?.querySelector('.card-ground')))); },
      note: 'Drag the Moon first to bring a pole into view. Coordinates are in the Mean Earth/Polar Axis frame (MOON_ME), longitude 0–360° E. Backspace removes the most recent marker.',
      async auto() { const s = mark(EXAMPLE); if (s && api.scope() === 'system') api.pins.face(s); } },

    { ch: 0, q: 'What does the card tell me?', spot: () => [cardEl()], dock: 'card',
      text: 'For the Sun and for Earth: the elevation of the disk center above the terrain horizon at that azimuth, the share of the disk in view, and the time to the next rise or set. Below, for your span: the share of hours in view and the longest interval without.',
      act: 'Step the clock with +1 h and watch the elevations change.',
      enter: needCard,
      done: f => !!f.stepped,
      seen: () => { const c = cardEl(); return c ? 'At ' + stamp(api.now()) + ' UTC. Sun: ' + cardValue(c, 'sunEl') + ', disk in view ' + cardValue(c, 'sunFrac') + '. Earth: ' + cardValue(c, 'earthEl') + ', disk in view ' + cardValue(c, 'earthFrac') + '.' : ''; },
      note: 'A body counts as in view when at least half of its disk is above the terrain horizon. The line under the name gives the terrain data used.',
      async auto() { const b = q('.tb-step[data-step="1"]'); for (let i = 0; i < 3; i++) { b.click(); if (!await wait(450)) return; } } },

    { ch: 1, q: 'How long can the lander go without sunlight?', spot: () => [field('p-dark').closest('.prange'), field('p-area-note')],
      text: '<b>Max. darkness</b> is the longest unbroken time with less than half of the Sun’s disk in view that your lander tolerates. Set it, and the Moon keeps only the area that stays within it over your span.',
      act: 'Set Max. darkness, for example to 6 h.',
      enter: () => setSide(true),
      done: () => limit('p-dark') != null,
      seen: areaLine,
      note: 'The area is calculated per 0.5° cell from the 7.6 km grid horizon: large-scale relief only. A marked site’s card uses higher-resolution terrain data.',
      auto: () => slide('p-dark', 6) },

    { ch: 1, q: 'How long without a DTE link?', spot: () => [field('p-dte').closest('.prange'), field('p-area-note')],
      text: '<b>DTE</b> is direct-to-Earth communication: an unobstructed line of sight to Earth, with no relay satellite. With both limits set, only the area that keeps both remains: the intersection.',
      act: 'Set Max. DTE outage, for example to 12 h.',
      enter: () => setSide(true),
      done: () => limit('p-dte') != null,
      seen: areaLine,
      note: 'DTE here is line-of-sight geometry only: no link budget, no ground-station coverage.',
      auto: () => slide('p-dte', 12) },

    { ch: 1, q: 'Why does a longer mission leave less?', spot: () => [q('.tb-span'), field('p-area-note')], always: true,
      text: 'A site must stay within the limits over the whole span, from Start to Stop. Every further day is one more chance for a long darkness period or a long DTE outage, so the area can only shrink.',
      act: 'Move Stop later and compare the share.',
      enter: () => { setSide(true); log = []; },
      done: () => log.length > 1,
      seen() {
        if (noLimit()) return 'Set a limit first: without one there is no area to compare.';
        const a = area();
        if (a && log.length && log[0].a !== a.a) log = [];                 // another Start: another experiment
        if (a && !log.some(r => r.key === a.key)) { log.push({ key: a.key, a: a.a, ms: a.b - a.a, len: a.free ? '24 h' : days(a.b - a.a), pct: a.pct }); if (log.length > 5) log.shift(); }
        const pending = a ? '' : '<p>' + (areaLine() || 'Calculating the area …') + '</p>';
        return (log.length ? '<p>Start ' + stamp(log[0].a) + ' UTC, limits as set.</p><table><thead><tr><th>Span</th><th>Share of the Moon within the limits</th></tr></thead><tbody>'
          + [...log].sort((x, y) => x.ms - y.ms).map(r => '<tr><td>' + r.len + '</td><td>' + r.pct + ' %</td></tr>').join('') + '</tbody></table>' : '') + pending;
      },
      note: 'While a long span is being calculated, the line under the sliders says so.',
      async auto() {
        if (noLimit() && !(await slide('p-dark', 6) && await slide('p-dte', 12))) return;
        // the same Start with Stop 1, 3, 7 and 14 days later, then the span as it was (10 days when there was none)
        const was = api.span(), a = was?.[0] ?? hourNow();
        for (const d of [1, 3, 7, 14]) {
          api.setSpan(a, a + d * DAY);
          if (!await until(() => { const r = area(); return r && !r.free && r.a === a && r.b === a + d * DAY; }, 90000)) return;
          if (!await wait(1100)) return;
        }
        api.setSpan(a, was?.[1] ?? a + 10 * DAY);
      } },

    { ch: 1, q: 'What if the launch slips?', spot: () => [cardEl()?.querySelector('.card-delay')], dock: 'card',
      text: 'Thirty squares on the card: the same mission, landing 0 to 29 days later. A square is filled green where the limits hold over the whole mission and outlined red where one of them breaks. The sentence beside them names the days of delay this site tolerates.',
      act: 'Click a square to move the landing to that day.',
      enter: () => { needCard(); intoView('.card-delay'); },
      done: f => !!f.day,
      seen: () => { const c = cardEl(), d = c?.querySelector('.card-day'); return c ? esc(full(d?.title || 'Landing ' + stamp(api.span()?.[0] ?? api.now()) + ' UTC')) + ' ' + esc(full(read(c.querySelector('.card-delay-text')))) : ''; },
      note: 'The mission is your span; with none set it lands at the time of the clock and lasts 10 days. On coarse ground the squares are hatched and no number of days is given.',
      // the first later day on which the limits hold; the seventh when there is none
      async auto() { const all = [...(cardEl()?.querySelectorAll('.card-day') ?? [])], d = all.find((x, k) => k > 0 && !x.classList.contains('bad')) ?? all[7]; if (d) { d.scrollIntoView({ block: 'nearest' }); d.click(); flags.day = true; } } },

    { ch: 2, q: 'What happens over the coming weeks?', spot: ['#series-toggle', '#sky-toggle'], dock: 'left',     // the plots open top right
      text: '<b>Solar elevation</b> plots the Sun’s elevation above the terrain horizon over your span. Zero is the horizon; the band under the plot marks the illuminated hours. <b>Sky view</b> draws the horizon over 360° of azimuth with the paths of the Sun and Earth.',
      act: 'Open Solar elevation or Sky view.',
      enter: () => { needCard(); setSide(false); },
      done: () => pressed('series-toggle') || pressed('sky-toggle'),
      seen: () => [pressed('series-toggle') && 'Solar elevation', pressed('sky-toggle') && 'Sky view'].filter(Boolean).join(' and ') + ' open for ' + esc(cards().map(s => s.name).join(', ') || 'the marked site') + '.',
      note: 'Near the poles the Sun’s center stays within about 1.5° of the horizontal all year. There the terrain horizon, not the time of day, decides between light and dark.',
      async auto() { if (!pressed('series-toggle')) field('series-toggle').click(); } },

    { ch: 2, q: 'Which site is better?', spot: ['#compare-toggle'],
      text: 'Mark a second site. <b>Compare as table</b> sets the cards side by side, one column per site, for the same time, span and limits. The sentence above the table gives the verdict.',
      act: 'Mark a second site and open the table.',
      enter: () => setSide(false),
      done: () => cards().length > 1 && tabled(),
      seen: () => esc(read('.compare-verdict')),
      note: 'The verdict notes when two sites use different terrain data. Such numbers are not strictly comparable.',
      async auto() {
        if (api.scope() === 'terrain') { api.closeTerrain(); if (!await until(() => api.scope() === 'system' && !api.terrainOpening(), 8000)) return; }
        for (const id of [EXAMPLE, SECOND]) { if (cards().length > 1) break; mark(id); }
        if (!await wait(500)) return;
        if (!tabled()) field('compare-toggle').click();
      } },

    { ch: 2, q: 'Why is this site dark, or lit?', spot: () => [cardEl()?.querySelector('.card-terrain')], dock: 'card',
      text: '<b>View terrain</b> opens the terrain 200 × 200 km around the site at true scale, with the Moon’s curvature and no vertical exaggeration. It is lit and shadowed for the Sun’s position at the simulated time.',
      act: 'Open the terrain view of a marked site.',
      enter: () => { needCard(); setSide(false); intoView('.card-terrain'); },
      done: () => api.scope() === 'terrain',
      seen: () => esc(full(read('#t-name') + (read('#t-meta') ? ': ' + read('#t-meta') : ''))) + ' “Back to the Moon”, top left, leaves the terrain view.',
      note: 'LDEM64 has 474 m pixels; terrain within about 1 km of the site is not resolved. The far field to 300 km is not drawn but casts shadows.',
      async auto() { const s = cards()[0]; if (s && api.scope() === 'system') await api.openTerrain(s); } },

    { ch: 2, q: 'Where nearby is it better?', dock: 'left', spot: () => [field('p-surface').closest('.pitem'), field('legend')], always: true,
      text: 'In the terrain view, <b>Mean illumination</b> and <b>DTE availability</b> are calculated for this terrain and your span: one value every 1.6 km, each point against its own terrain horizon. Move the pointer over the terrain to read a value.',
      act: 'Choose Mean illumination under Surface, then point at a ridge and at a crater floor.',
      enter: () => setSide(true),
      done: () => ['sunlight', 'earth'].includes(field('p-surface').value) && (api.scope() !== 'terrain' || api.terrain.mode === field('p-surface').value),
      seen() {
        const s = field('p-surface'), want = ['sunlight', 'earth'].includes(s.value);
        if (!want) return '';
        if (api.scope() === 'terrain' && api.terrain.mode !== s.value) return esc(read('#p-surface-note'));                 // still being worked out: the page's own progress line
        const ticks = [...document.querySelectorAll('#legend-ticks span')].map(e => e.textContent.trim()).filter(Boolean);
        return esc(read('#legend-title')) + (ticks.length > 1 ? ', scale ' + esc(ticks[0]) + ' to ' + esc(ticks.at(-1)) : '') + '. ' + esc(full(read('#legend-note').split('. ')[0]));
      },
      note: 'In the terrain view the color scale runs from the lowest to the highest value on this terrain, so colors cannot be compared between two sites. Read the legend.',
      async auto() { const s = field('p-surface'), o = s.querySelector('option[value="sunlight"]'); if (o && !o.disabled && s.value !== 'sunlight') { s.value = 'sunlight'; s.dispatchEvent(new Event('change')); } } },

    { last: true, q: 'Your turn.',
      text: 'A task to start with: find a site near the south pole that stays within 6 h of darkness and 12 h of DTE outage over a 10-day mission, even if the landing slips by two weeks. The Reference sheet lists every other control, the definitions and the sources.' },
  ];
  const COUNT = STOPS.length - 1;
  el.steps.innerHTML = CHAPTERS.map((c, k) => '<span class="tour-group">' + STOPS.filter(s => s.ch === k).map(() => '<i></i>').join('') + '</span>').join('');
  const dots = [...el.steps.querySelectorAll('i')];

  // --- What the user does, watched while the tutorial runs ----------------------------------------------------
  const own = t => t.closest?.('.tour-hint, .tour-ref, .card, .series, .compare, .params, .timebar, .site-header, .legend, .tbar');
  let press = null;
  addEventListener('pointerdown', e => { if (on && !own(e.target)) press = { x: e.clientX, y: e.clientY }; }, true);
  addEventListener('pointermove', e => { if (on && press && e.buttons && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 40) flags.turned = true; }, true);
  addEventListener('pointerup', () => { press = null; }, true);
  addEventListener('click', e => { if (!on) return; if (e.target.closest?.('.tb-step[data-step]')) flags.stepped = true; if (e.target.closest?.('.card-day')) flags.day = true; }, true);
  addEventListener('input', e => { if (on && e.target.id === 'tb-scrub') flags.stepped = true; }, true);

  // --- Showing a stop ---------------------------------------------------------------------------------
  function outline(list) {
    spots.forEach(e => e.classList.remove('tour-spot'));
    spots = (list ?? []).map(s => typeof s === 'string' ? q(s) : s).filter(Boolean);
    spots.forEach(e => e.classList.add('tour-spot'));
  }
  const targets = s => typeof s.spot === 'function' ? s.spot() : s.spot ?? [];
  function render() {
    const s = STOPS[index];
    panel.classList.toggle('last', !!s.last);
    el.chapter.textContent = s.last ? 'Tutorial' : (s.ch + 1) + ' · ' + CHAPTERS[s.ch];
    el.count.textContent = s.last ? '' : (index + 1) + ' / ' + COUNT;
    dots.forEach((d, k) => { d.className = k < index ? 'past' : k === index ? 'now' : ''; });
    el.q.textContent = s.q; el.text.innerHTML = s.text;
    el.try.hidden = !s.act; el.tryText.textContent = s.act ?? ''; el.auto.hidden = !s.auto; el.auto.disabled = false;
    el.note.hidden = !s.note; el.noteText.textContent = s.note ?? '';
    el.seen.hidden = true; el.seenText.innerHTML = ''; seenKey = ''; wasDone = false; el.try.classList.remove('done');
    el.back.disabled = index === 0;
    el.next.textContent = s.last ? 'Explore freely' : 'Next';
  }
  /** The action of the stop: done or not, and what the page says about it. */
  function check() {
    const s = STOPS[index]; if (!s.done) return;
    let ok = false, html = '';
    try { if (s.always) html = s.seen() ?? ''; ok = !!s.done(flags); if (ok && !s.always && s.seen) html = s.seen() ?? ''; } catch { /* a control is not there at this moment: the next round tries again */ }
    if (ok !== wasDone) { wasDone = ok; el.try.classList.toggle('done', ok); }
    if (html !== seenKey) { seenKey = html; el.seenText.innerHTML = html; el.seen.hidden = !html; }
  }
  function go(i) {
    token++; index = i; flags = {}; busy = false;
    const s = STOPS[i], before = [!!cardEl(), sideOpen(), tabled()];
    s.enter?.();
    render(); outline(targets(s)); check(); el.scroll.scrollTop = 0;
    // a control that is only now arriving (the sidebar sliding out, a card opening) is outlined once it is there
    const my = token; for (const ms of [450, 1200]) setTimeout(() => { if (my === token && on) outline(targets(s)); }, ms);
    // the side: at once, or, where it goes by the card and the cards are being laid out anew, once they have come to rest
    const byCard = s.dock === 'card', moving = !before[0] || before[1] !== sideOpen() || before[2] !== tabled();
    settle(byCard && moving ? SETTLE_MS : 0);
    if (panel.contains(document.activeElement) || document.activeElement === document.body) el.next.focus({ preventScroll: true });
  }

  // --- Where the hint stands ----------------------------------------------------------------------------
  // CSS anchors the hint top right of the scene (class left: top left, clear of the Parameters tab). Here only the
  // side is chosen, once per stop, and the height is kept above the time bar.
  const SETTLE_MS = 700, SWAP_MS = 160;
  let side = 'right', home = 'right', settleAt = 0, scopeWas = '', off = { x: 0, y: 0 };
  /** The hint goes left only where the stop says so, or where it goes by the cards and every card stands at the right. */
  function wanted() {
    const d = STOPS[index].dock;
    if (d !== 'card') return d ?? home;                            // no word of its own: where the last stop about the cards put it
    const h = hero.getBoundingClientRect(), sides = [...document.querySelectorAll('.card')].filter(shown).map(c => { const r = c.getBoundingClientRect(); return r.left + r.width / 2 - h.left < h.width / 2 ? 'left' : 'right'; });
    return home = sides.length && sides.every(x => x === 'right') ? 'left' : 'right';
  }
  /** Back to the place of the stop (a dragged hint too), on the side the stop asks for; ms: only after that time. */
  function settle(ms) {
    off = { x: 0, y: 0 }; panel.style.transform = ''; scopeWas = api.scope();
    if (ms > 0) { settleAt = performance.now() + ms; return; }
    settleAt = 0; dock(wanted());
  }
  function dock(to) {
    if (to === side) return;
    side = to;
    if (panel.classList.contains('fresh') || reduce.matches) { panel.classList.toggle('left', to === 'left'); return; }
    const my = token; panel.classList.add('swap');                 // out, over, in: the hint does not slide across the picture
    setTimeout(() => { panel.classList.toggle('left', side === 'left'); if (my === token || on) panel.classList.remove('swap'); }, SWAP_MS);
  }
  function place(now) {
    if (settleAt && now >= settleAt) { settleAt = 0; dock(wanted()); }
    // the terrain view opening or closing lays the cards out anew: the side is settled again once
    if (api.scope() !== scopeWas) { scopeWas = api.scope(); if (STOPS[index].dock === 'card') settleAt = now + SETTLE_MS + 300; }
    // down to the time bar, if that leaves enough height; otherwise the CSS limit (the window) holds
    const bar = field('timebar'), room = shown(bar) ? bar.getBoundingClientRect().top - hero.getBoundingClientRect().top - EDGE - TOP : 0;
    const max = room >= MIN_ROOM ? Math.round(room) + 'px' : '';
    if (panel.style.maxHeight !== max) panel.style.maxHeight = max;
  }
  // dragging the hint (anywhere but its buttons): an offset from its place, kept inside the scene, until the next stop
  let grab = null;
  panel.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('button, .tour-seen-text')) return;
    const r = panel.getBoundingClientRect(), h = hero.getBoundingClientRect();
    grab = { x: e.clientX - off.x, y: e.clientY - off.y, minX: h.left + EDGE - (r.left - off.x), maxX: h.right - EDGE - (r.right - off.x), minY: h.top + EDGE - (r.top - off.y), maxY: h.bottom - EDGE - (r.bottom - off.y) };
    panel.setPointerCapture(e.pointerId); panel.classList.add('moving');
  });
  const drop = () => { grab = null; panel.classList.remove('moving'); };
  panel.addEventListener('pointermove', e => {
    if (!grab) return; if (!(e.buttons & 1)) return drop();
    off = { x: Math.min(Math.max(e.clientX - grab.x, grab.minX), Math.max(grab.minX, grab.maxX)), y: Math.min(Math.max(e.clientY - grab.y, grab.minY), Math.max(grab.minY, grab.maxY)) };
    panel.style.transform = 'translate(' + Math.round(off.x) + 'px,' + Math.round(off.y) + 'px)';
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) panel.addEventListener(type, drop);

  // --- Reference sheet ---------------------------------------------------------------------------------
  let refFrom = null;
  function showRef(open) {
    if (sheet.hidden === !open) return;
    sheet.hidden = !open;
    if (open) { refFrom = document.activeElement; sheet.scrollTop = 0; sheet.focus({ preventScroll: true }); } else refFrom?.focus?.({ preventScroll: true });
  }
  sheet.querySelector('.tour-close').addEventListener('click', () => showRef(false));
  el.refOpen.addEventListener('click', () => showRef(true));

  // --- Start, end, keys ----------------------------------------------------------------------------------
  function start() {
    if (on) return; on = true; sideByTour = false; side = home = 'right'; panel.classList.remove('left', 'swap'); panel.hidden = false; panel.classList.add('fresh');
    go(0); place(performance.now()); requestAnimationFrame(() => requestAnimationFrame(() => panel.classList.remove('fresh')));
  }
  function close() {
    if (!on) return; on = false; token++; outline(null); showRef(false); panel.hidden = true;
  }
  const end = () => { close(); onClose?.(); };
  el.next.addEventListener('click', () => { if (index < STOPS.length - 1) go(index + 1); else end(); });
  el.back.addEventListener('click', () => { if (index > 0) go(index - 1); });
  panel.querySelector('.tour-close').addEventListener('click', end);
  el.auto.addEventListener('click', async () => {
    const s = STOPS[index], my = token; if (busy || !s.auto) return;
    busy = true; el.auto.disabled = true;
    try { await s.auto(); } finally { if (my === token) { busy = false; el.auto.disabled = false; } }
  });
  /** Keys while the tutorial runs; true when the key was the tutorial's. The arrow keys step only from within the hint: elsewhere they belong to the page. */
  function key(e) {
    if (!on) return false;
    if (e.key === 'Escape') { if (!sheet.hidden) showRef(false); else end(); return true; }
    if (!panel.contains(e.target) || !sheet.hidden) return false;
    if (e.key === 'ArrowRight') { el.next.click(); return true; }
    if (e.key === 'ArrowLeft') { el.back.click(); return true; }
    return false;
  }
  function frame(now) {
    if (!on) return;
    if (now - lastCheck > CHECK_MS) { lastCheck = now; check(); }
    place(now);
  }
  return { start, close, frame, key, get active() { return on; } };
}
