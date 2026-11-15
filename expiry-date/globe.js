/* Expiry Date - 3D Moon globe. Orthographic software renderer (no libraries).
 * Colours use the same C.analyse() as the Compare view. Written with AI assistance (Claude, Anthropic). */
(function () {
  'use strict';
  var C = window.EDCore, RAD = Math.PI / 180;
  var $ = function (id) { return document.getElementById(id); };
  var PROFILES = { short: { M: 10, D: 6, G: 12 }, long: { M: 30, D: 48, G: 48 } };
  // Schematic maria: lat, east lon, radius (deg), darkness. Approximate, only for orientation.
  var MARIA = [[8, 31, 10, .5], [28, 18, 8, .5], [35, -17, 14, .5], [15, -50, 18, .45], [17, 59, 5, .5],
    [-21, -15, 8, .4], [-4, 52, 8, .4], [58, 0, 8, .25], [-24, -39, 5, .45], [-15, 34, 4, .4], [1, -30, 10, .3]];
  var st = { clat: 0, clon: 0, landing: Date.UTC(2028, 6, 7), prof: 'short', clock: 0, sel: 'cr', res: {} };
  var sky, SITES = [], ssCache = {}, cv, ctx, W, img, tmp = {}, hit = [];
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function getJson(u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error(u + ' (HTTP ' + r.status + ')'); return r.json(); }); }
  function t0() { return C.tOf(st.landing); }
  function siteById(id) { return SITES.filter(function (s) { return s.id === id; })[0]; }

  function analysis(site) {
    var key = site.id + '|' + st.landing;
    if (!ssCache[key]) { if (Object.keys(ssCache).length > 40) ssCache = {}; ssCache[key] = C.skySeries(sky, site, t0()); }
    return C.analyse(sky, site, t0(), PROFILES[st.prof], ssCache[key]);
  }
  // Same wording rules as app.js labelFor
  function label(s, a) {
    var f = function (x) { return x >= 30 ? '30+' : x; };
    if (s.basis === 'upper') return { cls: 'up', txt: a.n === 0 ? 'Upper bound only: not viable at this date even in the best case' : 'Upper bound only: at most ' + f(a.n) + (a.n === 1 ? ' day' : ' days') + ' of delay' };
    var hi = s.basis === 'terrain' ? a.hi : a.n, core;
    if (hi === 0) core = 'not viable at the launch date';
    else if (s.basis === 'terrain') core = 'survives ' + (a.lo === a.hi ? f(a.lo) : f(a.lo) + '–' + f(a.hi)) + (a.hi === 1 ? ' day' : ' days') + ' of delay';
    else core = 'survives ' + f(a.n) + (a.n === 1 ? ' day' : ' days') + ' of delay (approx., smooth horizon)';
    return { cls: hi === 0 ? 'bad' : 'ok', txt: core };
  }

  function basis() {   // screen right = east E, up = north N, towards viewer = F at the view centre
    var p = st.clat * RAD, l = st.clon * RAD;
    return { F: [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)],
             E: [-Math.sin(l), Math.cos(l), 0],
             N: [-Math.sin(p) * Math.cos(l), -Math.sin(p) * Math.sin(l), Math.cos(p)] };
  }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

  function draw() {
    var t = t0() + st.clock / 24, B = basis();
    sky.dirs(t, tmp);
    var sun = [tmp.sX, tmp.sY, tmp.sZ], ea = [tmp.eX, tmp.eY, tmp.eZ];
    var R = W * 0.46, cx = W / 2, cy = W / 2, d = img.data, i = 0, x, y;
    var mc = MARIA.map(function (m) { return [m[0] * RAD, m[1] * RAD, m[2] * RAD, m[3]]; });
    for (y = 0; y < W; y++) for (x = 0; x < W; x++, i += 4) {
      var u = (x - cx) / R, v = (cy - y) / R, r2 = u * u + v * v;
      if (r2 > 1) { d[i] = 5; d[i + 1] = 7; d[i + 2] = 11; d[i + 3] = 255; continue; }
      var z = Math.sqrt(1 - r2);
      var px = u * B.E[0] + v * B.N[0] + z * B.F[0], py = u * B.E[1] + v * B.N[1] + z * B.F[1], pz = u * B.E[2] + v * B.N[2] + z * B.F[2];
      var lat = Math.asin(pz), lon = Math.atan2(py, px);
      var alb = 0.62, k;
      for (k = 0; k < mc.length; k++) {
        var dl = Math.abs(lon - mc[k][1]); if (dl > Math.PI) dl = 2 * Math.PI - dl;
        var dd = (lat - mc[k][0]) * (lat - mc[k][0]) + (dl * Math.cos(mc[k][0])) * (dl * Math.cos(mc[k][0]));
        alb -= mc[k][3] * 0.5 * Math.exp(-dd / (mc[k][2] * mc[k][2]));
      }
      var g = Math.abs((lat / RAD / 30) % 1), g2 = Math.abs((lon / RAD / 30) % 1);
      var line = (Math.min(g, 1 - g) * 30 < 0.35) || (Math.min(g2, 1 - g2) * 30 * Math.max(Math.cos(lat), 0.05) < 0.35);
      var lit = px * sun[0] + py * sun[1] + pz * sun[2];
      var sh = lit <= -0.04 ? 0.05 : lit >= 0.04 ? 0.05 + 0.95 * Math.min(1, lit * 1.15 + 0.1) : 0.05 + 0.5 * (lit + 0.04) / 0.08 * 0.2;
      var c = 255 * alb * sh; if (line) c = c * 0.7 + 40;
      d[i] = c; d[i + 1] = c * 0.98; d[i + 2] = c * 0.93; d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    ctx.lineWidth = 1; ctx.strokeStyle = '#2a3547'; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
    // Sun and Earth direction markers (sub-solar / sub-Earth point)
    var info = [];
    [['Sun', sun, '#f3c34f'], ['Earth', ea, '#5aa9ff']].forEach(function (b) {
      var sx = dot(b[1], B.E), sy = dot(b[1], B.N), sz = dot(b[1], B.F);
      var la = Math.asin(b[1][2]) / RAD, lo = Math.atan2(b[1][1], b[1][0]) / RAD;
      info.push(b[0] + ' overhead at ' + Math.abs(la).toFixed(1) + '°' + (la < 0 ? 'S' : 'N') + ' ' + Math.abs(lo).toFixed(1) + '°' + (lo < 0 ? 'W' : 'E') + (sz > 0 ? '' : ' (far side)'));
      var mx = cx + sx * R, my = cy - sy * R;
      if (sz <= 0) { var n = Math.hypot(sx, sy) || 1; mx = cx + sx / n * (R + 14); my = cy - sy / n * (R + 14); }
      ctx.beginPath(); ctx.arc(mx, my, sz > 0 ? 9 : 6, 0, 7); ctx.lineWidth = 2; ctx.strokeStyle = b[2];
      if (sz > 0) { ctx.fillStyle = b[2] + '66'; ctx.fill(); } ctx.stroke();
      ctx.fillStyle = b[2]; ctx.font = '12px system-ui'; ctx.fillText(b[0], mx + 12, my + 4);
    });
    $('sunearth').textContent = info.join(' · ') + ' · Earth distance ' + Math.round(tmp.D).toLocaleString('en-US') + ' km';
    // Site markers
    hit = []; var placed = [];
    SITES.forEach(function (s) {
      var sx = dot(s.up, B.E), sy = dot(s.up, B.N), sz = dot(s.up, B.F);
      if (sz < 0.03) return;
      var X = cx + sx * R, Y = cy - sy * R, L = label(s, st.res[s.id]);
      var col = L.cls === 'ok' ? '#3ecf7a' : L.cls === 'bad' ? '#ef5b5b' : '#8aa0bd';
      ctx.beginPath(); ctx.arc(X, Y, 8, 0, 7);
      if (L.cls === 'up') { ctx.fillStyle = '#243044'; ctx.fill(); ctx.setLineDash([3, 2]); } else { ctx.fillStyle = col; ctx.fill(); }
      ctx.lineWidth = s.id === st.sel ? 3 : 1.5; ctx.strokeStyle = s.id === st.sel ? '#fff' : (L.cls === 'up' ? col : '#0b0f17'); ctx.stroke(); ctx.setLineDash([]);
      var name = s.name.replace(/\s*\(.*$/, ''), ty = Y + 4, tw = ctx.measureText(name).width, tries = 0;
      ctx.font = '12px system-ui';
      while (tries++ < 8 && placed.some(function (p) { return Math.abs(p[1] - ty) < 13 && X + 12 < p[0] + p[2] && X + 12 + tw > p[0]; })) ty += 13;
      placed.push([X + 12, ty, tw]);
      ctx.fillStyle = '#000'; ctx.fillText(name, X + 13, ty + 1); ctx.fillStyle = '#e6ebf2'; ctx.fillText(name, X + 12, ty);
      hit.push({ id: s.id, x: X, y: Y });
    });
  }

  function refresh() {
    SITES.forEach(function (s) { st.res[s.id] = analysis(s); });
    var h = '';
    SITES.forEach(function (s) {
      var L = label(s, st.res[s.id]);
      h += '<li data-id="' + s.id + '" class="' + (s.id === st.sel ? 'sel' : '') + '"><span class="dot ' + L.cls + '"></span><span><b>' + esc(s.name) + '</b><br><span class="s">' + esc(L.txt) + '</span></span></li>';
    });
    $('list').innerHTML = h;
    [].forEach.call($('list').children, function (li) { li.onclick = function () { select(li.dataset.id, true); }; });
    var s = siteById(st.sel); $('detail').textContent = s ? s.name + ': ' + label(s, st.res[s.id]).txt + '.' : '';
    clk(); draw();
  }
  function clk() { var h = st.clock; $('clk').textContent = 'day ' + Math.floor(h / 24) + ', ' + (h % 24) + ' h  (' + new Date(st.landing + h * 3600e3).toISOString().slice(0, 16).replace('T', ' ') + ' UTC)'; }
  function select(id, turn) {
    st.sel = id; var s = siteById(id);
    if (turn && s) { st.clat = s.lat; st.clon = s.lon; }
    refresh();
  }

  function bind() {
    var R = C.landingRange(sky);
    $('date').min = new Date(R.firstMs).toISOString().slice(0, 10); $('date').max = new Date(R.lastMs).toISOString().slice(0, 10);
    $('date').value = new Date(st.landing).toISOString().slice(0, 10); $('prof').value = st.prof; $('clock').value = st.clock;
    $('date').onchange = function () { var ms = Date.parse($('date').value + 'T00:00:00Z'); if (C.checkLanding(sky, ms).ok) { st.landing = ms; refresh(); } };
    $('prof').onchange = function () { st.prof = $('prof').value; refresh(); };
    $('clock').oninput = function () { st.clock = +$('clock').value; clk(); draw(); };
    $('bEarth').onclick = function () { sky.dirs(t0() + st.clock / 24, tmp); st.clat = Math.asin(tmp.eZ) / RAD; st.clon = Math.atan2(tmp.eY, tmp.eX) / RAD; draw(); };
    $('bSouth').onclick = function () { st.clat = -80; st.clon = 215; draw(); };
    $('bA11').onclick = function () { select('a11', true); };
    $('goCmp').onclick = function () { location.href = 'index.html?sel=' + st.sel + '&date=' + new Date(st.landing).toISOString().slice(0, 10) + '&prof=' + st.prof; };
    var drag = null, moved = 0;
    cv.onpointerdown = function (e) { drag = { x: e.clientX, y: e.clientY }; moved = 0; cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing'; };
    cv.onpointermove = function (e) {
      if (!drag) return;
      var k = 90 / (cv.getBoundingClientRect().width * 0.46), dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      moved += Math.abs(dx) + Math.abs(dy); drag = { x: e.clientX, y: e.clientY };
      st.clon = ((st.clon - dx * k * 0.7 + 540) % 360) - 180; st.clat = Math.max(-90, Math.min(90, st.clat + dy * k * 0.7)); draw();
    };
    cv.onpointerup = function (e) {
      cv.style.cursor = 'grab'; drag = null;
      if (moved < 5) {
        var r = cv.getBoundingClientRect(), x = (e.clientX - r.left) * W / r.width, y = (e.clientY - r.top) * W / r.height, best = null, bd = 18;
        hit.forEach(function (h) { var q = Math.hypot(h.x - x, h.y - y); if (q < bd) { bd = q; best = h; } });
        if (best) select(best.id, false);
      }
    };
  }

  function init() {
    cv = $('cv'); W = 480; cv.width = cv.height = W; ctx = cv.getContext('2d'); img = ctx.createImageData(W, W);
    var q = new URLSearchParams(location.search);
    if (q.get('date')) { var ms = Date.parse(q.get('date') + 'T00:00:00Z'); if (!isNaN(ms)) st.landing = ms; }
    if (q.get('prof') && PROFILES[q.get('prof')]) st.prof = q.get('prof');
    var META;
    getJson('data/sky_meta.json').then(function (m) {
      META = m;
      return Promise.all([fetch('data/' + m.file).then(function (r) { if (!r.ok) throw new Error('data/' + m.file + ' (HTTP ' + r.status + ')'); return r.arrayBuffer(); }), getJson('data/sites.json')]);
    }).then(function (res) {
      sky = new C.Sky(META, res[0]);
      if (!C.checkLanding(sky, st.landing).ok) st.landing = Date.UTC(2028, 6, 7);
      return Promise.all(res[1].sites.map(function (def) {
        if (!def.horizon) return { def: def, hz: null };
        return getJson(def.horizon).then(function (hz) { return { def: def, hz: hz }; }).catch(function () { return { def: def, hz: null }; });
      }));
    }).then(function (list) {
      SITES = list.map(function (x) {
        if (x.hz) { x.def.lat = x.hz.target.lat_deg; x.def.lon = x.hz.target.lon_deg_east; x.def.z = x.hz.target.z_m; }
        return C.makeSite(x.def, x.hz);
      });
      if (q.get('sel') && siteById(q.get('sel'))) st.sel = q.get('sel');
      var s0 = siteById(st.sel); st.clat = s0.lat; st.clon = s0.lon;
      $('badge').textContent = 'Real data: NASA JPL Horizons + LOLA';
      bind(); refresh();
    }).catch(function (e) {
      $('fatal').hidden = false; $('app').hidden = true; $('badge').textContent = 'Data not loaded';
      $('fatal').innerHTML = '<b>The data files could not be loaded.</b><br>' + esc(e && e.message ? e.message : e) + '<br>Start <code>start.bat</code> and open <code>http://localhost:8080/globe.html</code>.';
    });
  }
  window.__globe = { st: st, draw: draw, refresh: refresh };
  init();
})();
