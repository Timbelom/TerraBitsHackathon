/* Expiry Date - user interface. Loads the data files, then renders strips, sky view and key figures.
 * Written with AI assistance (Claude, Anthropic). */
(function () {
  'use strict';
  var C = window.EDCore;
  var $ = function (id) { return document.getElementById(id); };
  var PROFILES = {
    short: { name: 'Short lander', M: 10, D: 6, G: 12 },
    long: { name: 'Long stay', M: 30, D: 48, G: 48 }
  };
  var state = { sel: ['cr', 'sh', 'im2'], prof: 'short', d: 6, g: 12, focus: 'cr', clock: 0,
                landing: Date.UTC(2028, 6, 7), custom: 0, res: {} };  // example date: the two south-pole sites differ here (tools/scan_dates.js)
  var sky, META, VALID, VALIDATION = null, SITES = [], ssCache = {};

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmtDate(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function siteById(id) { return SITES.filter(function (s) { return s.id === id; })[0]; }
  function profile() { var p = PROFILES[state.prof]; return { M: p.M, D: state.d, G: state.g }; }
  function t0() { return C.tOf(state.landing); }
  function lonE(l) { return ((l % 360) + 360) % 360; }

  function getJson(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(url + ' (HTTP ' + r.status + ')'); return r.json(); });
  }
  function showFatal(e) {
    $('fatal').hidden = false; $('app').hidden = true; $('badge').textContent = 'Data not loaded';
    $('fatal').innerHTML = '<b>The data files could not be loaded.</b><br>' + esc(e && e.message ? e.message : e) + '<br><br>' +
      (location.protocol === 'file:'
        ? 'This page was opened as a file, and browsers block loading data files that way. Start <code>start.bat</code> in this folder (or run <code>python -m http.server 8080</code> here) and open <code>http://localhost:8080/</code>, or use the GitHub Pages link.'
        : 'Check that the <code>data/</code> folder sits next to this page.');
  }

  // ---------- analysis (cached sky series per site and landing date) ----------
  function analysis(site) {
    var key = site.id + '|' + state.landing;
    if (!ssCache[key]) { if (Object.keys(ssCache).length > 40) ssCache = {}; ssCache[key] = C.skySeries(sky, site, t0()); }
    return C.analyse(sky, site, t0(), profile(), ssCache[key]);
  }

  function labelFor(s, a) {
    var n = a.n, f = function (x) { return x >= 30 ? '30+' : x; };
    if (s.basis === 'upper') {
      return { cls: 'up',
        txt: n === 0 ? 'No day label – upper bound only: not viable at this date even in the best case'
                     : 'No day label – upper bound only (at most ' + f(n) + (n === 1 ? ' day' : ' days') + ' of delay)',
        note: 'No terrain data for this site yet. Smooth horizon assumed, so mountains can only make it worse.' };
    }
    var core;
    if (s.basis === 'terrain') {
      if (a.hi === 0) core = 'not viable at the launch date';
      else core = 'survives ' + (a.lo === a.hi ? f(a.lo) : f(a.lo) + '–' + f(a.hi)) + (a.hi === 1 ? ' day' : ' days') + ' of delay';
    } else if (n === 0) core = 'not viable at the launch date';
    else core = 'survives ' + f(n) + (n === 1 ? ' day' : ' days') + ' of delay';
    var note = s.basis === 'terrain'
      ? 'With terrain (NASA LOLA 5 m). Range = ±1 σ of the height uncertainty. Point value at the target, not a landing-ellipse value.'
      : 'Approx., smooth horizon – no terrain model for this site.';
    return { cls: (s.basis === 'terrain' ? a.hi : n) === 0 ? 'bad' : 'ok', txt: core, note: note };
  }

  // ---------- UI building ----------
  function buildChips() {
    var h = '';
    SITES.forEach(function (s) {
      var on = state.sel.indexOf(s.id) >= 0, full = state.sel.length >= 3 && !on;
      h += '<button class="chip' + (on ? ' on' : '') + (full ? ' dis' : '') + '" data-id="' + s.id + '">' + esc(s.name) + '</button>';
    });
    $('chips').innerHTML = h;
    [].forEach.call($('chips').children, function (b) {
      b.onclick = function () {
        var id = b.dataset.id, i = state.sel.indexOf(id);
        if (i >= 0) { if (state.sel.length > 1) state.sel.splice(i, 1); }
        else if (state.sel.length < 3) state.sel.push(id);
        if (state.sel.indexOf(state.focus) < 0) state.focus = state.sel[0];
        render();
      };
    });
  }
  function buildProf() {
    var h = '';
    Object.keys(PROFILES).forEach(function (k) {
      h += '<button data-k="' + k + '" class="' + (state.prof === k ? 'on' : '') + '">' + PROFILES[k].name + ' (' + PROFILES[k].M + ' d)</button>';
    });
    $('prof').innerHTML = h;
    [].forEach.call($('prof').children, function (b) {
      b.onclick = function () {
        state.prof = b.dataset.k; state.d = PROFILES[state.prof].D; state.g = PROFILES[state.prof].G; render();
      };
    });
  }
  function syncAdj() { $('dr').value = state.d; $('gr').value = state.g; $('dv').textContent = state.d + ' h'; $('gv').textContent = state.g + ' h'; }

  function render() {
    buildChips(); buildProf(); syncAdj();
    $('date').value = fmtDate(state.landing);
    var pr = profile(), h = '', k;
    state.res = {};
    state.sel.forEach(function (id) {
      var s = siteById(id), a = analysis(s); state.res[id] = a;
      var L = labelFor(s, a), cells = '', cur = Math.floor(state.clock / 24);
      for (k = 0; k < 30; k++) {
        cells += '<div class="c' + (a.nom[k].ok ? ' g' : '') + (s.basis === 'upper' ? ' up' : '') + (cur === k ? ' cur' : '') + '" data-k="' + k + '" data-id="' + id + '"></div>';
      }
      h += '<div class="srow' + (state.focus === id ? ' sel' : '') + '" data-id="' + id + '">'
        + '<div class="top"><span class="nm">' + esc(s.name) + ' <span class="note">' + s.lat.toFixed(2) + '°, ' + lonE(s.lon).toFixed(2) + '°E</span></span><span class="lab ' + L.cls + '">' + L.txt + '</span></div>'
        + '<div class="cells">' + cells + '</div>'
        + '<div class="why" id="why_' + id + '">' + L.note + '</div></div>';
    });
    $('strips').innerHTML = h;
    var tk = ''; for (k = 0; k < 30; k++) tk += '<span>' + (k % 5 === 0 ? k : '') + '</span>';
    $('ticks').innerHTML = tk;
    [].forEach.call(document.querySelectorAll('.srow'), function (r) { r.onclick = function () { state.focus = r.dataset.id; render(); }; });
    [].forEach.call(document.querySelectorAll('.c'), function (c) {
      c.onmouseenter = function () {
        var a = state.res[c.dataset.id], i = +c.dataset.k, x = a.nom[i];
        $('why_' + c.dataset.id).textContent = 'Delay +' + i + ' d (' + fmtDate(state.landing + i * 86400000) + '): longest Sun gap ' + x.sg + ' h (limit ' + pr.D + ' h), longest Earth gap ' + x.eg + ' h (limit ' + pr.G + ' h) → ' + (x.ok ? 'works' : 'too long without Sun or Earth');
      };
      c.onmouseleave = function () { $('why_' + c.dataset.id).textContent = labelFor(siteById(c.dataset.id), state.res[c.dataset.id]).note; };
      c.onclick = function (e) { e.stopPropagation(); state.focus = c.dataset.id; state.clock = (+c.dataset.k) * 24; $('tl').value = state.clock; render(); };
    });
    renderSky(); renderBasis();
  }

  function viewRange(s) { return Math.abs(s.lat) >= 60 ? [-4, 9] : [-10, 90]; }

  function renderSky() {
    var s = siteById(state.focus), t = t0() + state.clock / 24;
    $('skyname').textContent = s.name;
    $('clk').textContent = '+' + Math.floor(state.clock / 24) + ' d ' + (state.clock % 24) + ' h  ·  ' + fmtDate(state.landing + state.clock * 3600000);
    var W = 720, H = 260, vr = viewRange(s), eMin = vr[0], eMax = vr[1];
    var X = function (az) { return az / 360 * W; }, Y = function (el) { return H - (el - eMin) / (eMax - eMin) * H; };
    var svg = '<rect width="720" height="260" fill="#0a0f19"/>', i, grid = eMax > 20 ? [0, 30, 60, 90] : [0, 3, 6, 9];
    grid.forEach(function (e) { svg += '<line x1="0" x2="720" y1="' + Y(e) + '" y2="' + Y(e) + '" stroke="#1d2638" stroke-width="1"/><text x="4" y="' + (Y(e) - 3) + '" fill="#56627a" font-size="10">' + e + '°</text>'; });
    [['N', 0], ['E', 90], ['S', 180], ['W', 270], ['N', 360]].forEach(function (p) { svg += '<text x="' + Math.min(X(p[1]) + 4, 700) + '" y="254" fill="#56627a" font-size="10">' + p[0] + '</text>'; });
    var tr = { sun: '', earth: '' };
    ['sun', 'earth'].forEach(function (w) {
      for (i = 0; i <= 60; i++) {
        var tt = t + i / 2; if (tt > sky.maxT) break;
        var b = C.bodyState(sky, s, tt, w, 0);
        if (b.el > eMin && b.el < eMax) tr[w] += '<circle cx="' + X(b.az).toFixed(1) + '" cy="' + Y(b.el).toFixed(1) + '" r="1.6" fill="' + (w === 'sun' ? '#ffc24a' : '#4aa3ff') + '" opacity="' + (0.15 + 0.5 * (1 - i / 60)) + '"/>';
      }
    });
    svg += tr.sun + tr.earth;
    var sb = C.bodyState(sky, s, t, 'sun', 0), eb = C.bodyState(sky, s, t, 'earth', 0), pxDeg = Math.abs(Y(1) - Y(0));
    function body(b, col, lab) {
      if (b.el < eMin) return '<text x="' + X(b.az) + '" y="244" fill="' + col + '" font-size="11" text-anchor="middle">' + lab + ' ↓ below view (' + b.el.toFixed(1) + '°)</text>';
      if (b.el > eMax) return '<text x="' + X(b.az) + '" y="14" fill="' + col + '" font-size="11" text-anchor="middle">' + lab + ' ↑ above view (' + b.el.toFixed(1) + '°)</text>';
      var r = Math.max(3, b.rad * pxDeg);
      return '<circle cx="' + X(b.az) + '" cy="' + Y(b.el) + '" r="' + r + '" fill="' + col + '" opacity=".95"/><text x="' + (X(b.az) + r + 4) + '" y="' + (Y(b.el) - 4) + '" fill="' + col + '" font-size="11">' + lab + '</text>';
    }
    svg += body(eb, '#4aa3ff', 'Earth') + body(sb, '#ffc24a', 'Sun');
    var pts = '0,' + H, up = '';
    for (i = 0; i <= 360; i += 2) { pts += ' ' + X(i) + ',' + Y(C.horizonAt(s, i % 360, 0)); up += (i ? ' ' : '') + X(i) + ',' + Y(C.horizonAt(s, i % 360, 1)); }
    pts += ' ' + W + ',' + H;
    svg += '<polygon points="' + pts + '" fill="#2a303c" stroke="#5d6679" stroke-width="1"/>';
    if (s.basis === 'terrain') svg += '<polyline points="' + up + '" fill="none" stroke="#8a93a6" stroke-width="1" stroke-dasharray="3 3" opacity=".8"/>';
    $('sky').innerHTML = svg;
    $('skynote').textContent = 'Azimuth 0–360° (view ' + eMin + '° to +' + eMax + '°). Dots = next 30 days (bright = soon).' + (s.basis === 'terrain' ? ' Dashed line = horizon + 1 σ.' : ' Horizon is smooth (0°).');
    function fmtH(r) { if (r.hours === null) return '>45 d'; var d = Math.floor(r.hours / 24), h = r.hours % 24; return d ? d + ' d ' + h + ' h' : h + ' h'; }
    var ts = C.timeToChange(sky, s, t, 'sun'), te = C.timeToChange(sky, s, t, 'earth');
    $('kp').innerHTML =
      '<div><b>' + sb.el.toFixed(2) + '°</b><span>Sun elevation (horizon here: ' + sb.h.toFixed(2) + '°)</span></div>'
      + '<div><b>' + eb.el.toFixed(2) + '°</b><span>Earth elevation (horizon here: ' + eb.h.toFixed(2) + '°)</span></div>'
      + '<div><b>' + fmtH(ts) + '</b><span>' + (ts.up ? 'until sunset' : 'until sunrise') + '</span></div>'
      + '<div><b>' + fmtH(te) + '</b><span>' + (te.up ? 'until Earthset' : 'until Earthrise') + '</span></div>';
    // key figures for the stay that starts at the selected delay
    var a = state.res[state.focus], pr = profile(), kd = Math.min(29, Math.floor(state.clock / 24));
    if (a) {
      var vis = C.visSeries(s, a.ss, 0), i0 = kd * 24, i1 = (kd + pr.M) * 24, ns = 0, ne = 0;
      for (i = i0; i <= i1; i++) { if (vis.sun[i] >= 0.5) ns++; if (vis.earth[i] >= 0.5) ne++; }
      var n = i1 - i0 + 1, sg = C.longestGap(vis.sun, i0, i1), eg = C.longestGap(vis.earth, i0, i1);
      $('kp2h').textContent = 'During a ' + pr.M + '-day stay with launch +' + kd + ' d (hourly samples, ≥ 50 % of the disk visible)';
      $('kp2').innerHTML =
        '<div><b>' + Math.round(100 * ns / n) + ' %</b><span>of the time with Sun (' + ns + ' h)</span></div>'
        + '<div><b>' + Math.round(100 * ne / n) + ' %</b><span>of the time with Earth in view (' + ne + ' h)</span></div>'
        + '<div><b>' + sg + ' h</b><span>longest dark phase (limit ' + pr.D + ' h)</span></div>'
        + '<div><b>' + eg + ' h</b><span>longest radio gap (limit ' + pr.G + ' h)</span></div>';
    }
  }

  function renderBasis() {
    var h = '<b>Sky:</b> NASA JPL Horizons (' + esc(META.ephemeris) + '), hourly 2027–2066, Moon-fixed Mean-Earth/Polar-Axis frame, retrieved ' + esc(META.retrieved.replace(/ \d\d:\d\d:\d\d/, '')) + '. '
      + '<a href="https://ssd.jpl.nasa.gov/horizons/" target="_blank" rel="noopener">Horizons</a>.';
    if (VALIDATION) h += ' Checked against Horizons at ' + VALIDATION.n + ' test points: worst difference ' + VALIDATION.worst_deg.toFixed(3) + '° (target ' + VALIDATION.target_deg + '°).';
    h += '<br><b>Terrain:</b> NASA LOLA via PGDA, 5 m site DEMs (near field) and 80 m south-pole DEM (far field to 285 km). Sites without terrain use a smooth horizon.';
    h += '<ul class="src">';
    state.sel.forEach(function (id) {
      var s = siteById(id);
      h += '<li><b>' + esc(s.name) + '</b>: ' + s.lat.toFixed(4) + '°, ' + lonE(s.lon).toFixed(4) + '°E · '
        + (s.sources && s.sources.length ? s.sources.map(function (x) { return '<a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(x.label) + '</a>'; }).join(', ') : 'your coordinates')
        + (s.horizonError ? ' · <span style="color:#ffb4a8">terrain file missing, upper bound only</span>' : '') + '</li>';
    });
    h += '</ul>';
    $('basis').innerHTML = h;
  }

  // ---------- events ----------
  function bind() {
    $('tl').oninput = function () {
      state.clock = +this.value;
      [].forEach.call(document.querySelectorAll('.c'), function (c) { c.classList.toggle('cur', Math.floor(state.clock / 24) === +c.dataset.k); });
      renderSky();
    };
    $('date').min = fmtDate(VALID.firstMs); $('date').max = fmtDate(VALID.lastMs);
    $('date').onchange = function () {
      var v = Date.parse(this.value + 'T00:00:00Z'), chk = C.checkLanding(sky, v);
      if (!chk.ok) {
        $('datemsg').textContent = 'Please pick a landing date between ' + fmtDate(VALID.firstMs) + ' and ' + fmtDate(VALID.lastMs) + ' (the 60-day window must lie inside the Horizons data).';
        this.value = fmtDate(state.landing); return;
      }
      $('datemsg').textContent = ''; state.landing = v; render();
    };
    $('plus').onclick = function () {
      var v = state.landing + 86400000;
      if (v > VALID.lastMs) { $('datemsg').textContent = 'That is the last landing date covered by the data (' + fmtDate(VALID.lastMs) + ').'; return; }
      $('datemsg').textContent = ''; state.landing = v; render();
    };
    $('dr').oninput = function () { state.d = +this.value; render(); };
    $('gr').oninput = function () { state.g = +this.value; render(); };
    $('cadd').onclick = function () {
      var la = parseFloat($('clat').value), lo = parseFloat($('clon').value);
      if (isNaN(la) || isNaN(lo) || Math.abs(la) > 90 || lo < -180 || lo > 360) {
        $('datemsg').textContent = 'Latitude must be -90…90 and longitude -180…360 (east positive).'; return;
      }
      $('datemsg').textContent = '';
      state.custom++;
      var s = C.makeSite({ id: 'c' + state.custom, name: 'Custom ' + state.custom, lat: la, lon: lo, sources: [] }, null);
      SITES.push(s);
      if (state.sel.length >= 3) state.sel.shift();
      state.sel.push(s.id); state.focus = s.id; render();
    };
  }

  // ---------- start ----------
  function init() {
    getJson('data/sky_meta.json').then(function (m) {
      META = m;
      return Promise.all([
        fetch('data/' + m.file).then(function (r) { if (!r.ok) throw new Error('data/' + m.file + ' (HTTP ' + r.status + ')'); return r.arrayBuffer(); }),
        getJson('data/sites.json'),
        getJson('data/validation/sky_validation.json').catch(function () { return null; })
      ]);
    }).then(function (res) {
      sky = new C.Sky(META, res[0]); VALIDATION = res[2];
      VALID = C.landingRange(sky);
      return Promise.all(res[1].sites.map(function (def) {
        if (!def.horizon) return { def: def, hz: null };
        return getJson(def.horizon).then(function (hz) { return { def: def, hz: hz }; })
          .catch(function (e) { def.horizonError = String(e); return { def: def, hz: null }; });
      }));
    }).then(function (list) {
      SITES = list.map(function (x) {
        var def = x.def;
        if (x.hz) { def.lat = x.hz.target.lat_deg; def.lon = x.hz.target.lon_deg_east; def.z = x.hz.target.z_m; }
        return C.makeSite(def, x.hz);
      });
      $('badge').textContent = 'Real data: NASA JPL Horizons + LOLA';
      try {   // optional deep link from the globe: ?sel=id&date=YYYY-MM-DD&prof=short|long
        var q = new URLSearchParams(location.search), ms = Date.parse((q.get('date') || '') + 'T00:00:00Z');
        if (!isNaN(ms) && C.checkLanding(sky, ms).ok) state.landing = ms;
        if (PROFILES[q.get('prof')]) { state.prof = q.get('prof'); state.d = PROFILES[state.prof].D; state.g = PROFILES[state.prof].G; }
        var sid = q.get('sel');
        if (sid && siteById(sid)) { if (state.sel.indexOf(sid) < 0) state.sel[state.sel.length - 1] = sid; state.focus = sid; }
      } catch (e) { /* ignore bad parameters */ }
      bind(); render();
    }).catch(showFatal);
  }
  init();
})();
