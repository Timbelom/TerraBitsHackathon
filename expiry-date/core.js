/* Expiry Date - core computation. Runs in the browser (window.EDCore) and in Node (require).
 * Sky: NASA JPL Horizons sub-Earth / sub-solar points (data/sky_2027_2066.bin).
 * Terrain: per-site horizon profile from NASA LOLA (data/horizon_*.json), or a smooth 0 deg horizon.
 * Written with AI assistance (Claude, Anthropic). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EDCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var RAD = Math.PI / 180;
  var MOON_R_KM = 1737.4;          // MOON_ME reference sphere, as used by LOLA and Horizons
  var EARTH_R_KM = 6371.0;         // mean Earth radius for the apparent Earth disc
  var SUN_R_DEG = 0.2666;          // angular radius of the Sun (0.53 deg diameter)
  var POLAR_LAT = 80;              // team assumption: |lat| >= 80 without terrain model -> "upper bound only"
  var EPOCH = Date.UTC(2027, 0, 1);
  var DAY = 86400000;
  var SERIES_DAYS = 60;            // 30 days of delay + up to 30 days of mission
  var SERIES_H = SERIES_DAYS * 24 + 1;

  // ---------- Sky data (Horizons) ----------
  function Sky(meta, buf) {
    var n = meta.n;
    if (buf.byteLength !== 20 * n) throw new Error('sky file has ' + buf.byteLength + ' bytes, expected ' + 20 * n);
    this.n = n;
    this.eLon = new Float32Array(buf, 0, n);
    this.eLat = new Float32Array(buf, 4 * n, n);
    this.sLon = new Float32Array(buf, 8 * n, n);
    this.sLat = new Float32Array(buf, 12 * n, n);
    this.dist = new Float32Array(buf, 16 * n, n);
    this.maxT = (n - 1) / 24;      // days after EPOCH
    this.meta = meta;
  }
  Sky.fromNodeBuffer = function (meta, b) {   // b: Node Buffer
    var ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    return new Sky(meta, ab);
  };
  function lerpLon(a, b, f) {      // longitude interpolation across the 0/360 seam
    var d = ((b - a + 540) % 360) - 180;
    return a + d * f;
  }
  // Fills o with unit vectors (Moon-fixed ME frame) towards Earth and Sun, and the Earth distance in km.
  Sky.prototype.dirs = function (t, o) {
    var x = t * 24;
    if (x < 0 || x > this.n - 1 + 1e-6) throw new RangeError('time outside the data range');
    if (x > this.n - 1) x = this.n - 1;
    var i = Math.floor(x), f = x - i, j = i + 1 < this.n ? i + 1 : i;
    var el = lerpLon(this.eLon[i], this.eLon[j], f) * RAD;
    var ep = (this.eLat[i] + (this.eLat[j] - this.eLat[i]) * f) * RAD;
    var sl = lerpLon(this.sLon[i], this.sLon[j], f) * RAD;
    var sp = (this.sLat[i] + (this.sLat[j] - this.sLat[i]) * f) * RAD;
    var ce = Math.cos(ep), cs = Math.cos(sp);
    o.eX = ce * Math.cos(el); o.eY = ce * Math.sin(el); o.eZ = Math.sin(ep);
    o.sX = cs * Math.cos(sl); o.sY = cs * Math.sin(sl); o.sZ = Math.sin(sp);
    o.D = this.dist[i] + (this.dist[j] - this.dist[i]) * f;
    return o;
  };
  // Time (days since EPOCH) to Date helpers
  function tOf(ms) { return (ms - EPOCH) / DAY; }

  // ---------- Sites ----------
  // def: {id, name, lat, lon, z (m above reference sphere, optional)}; horizon: {angle_deg[360], sigma_deg[360]} or null
  function makeSite(def, horizon) {
    var s = {}; for (var k in def) s[k] = def[k];
    var p = s.lat * RAD, l = s.lon * RAD;
    s.up = [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
    s.east = [-Math.sin(l), Math.cos(l), 0];
    s.north = [-Math.sin(p) * Math.cos(l), -Math.sin(p) * Math.sin(l), Math.cos(p)];
    s.rKm = MOON_R_KM + (s.z || 0) / 1000;
    s.hz = horizon ? { ang: Float64Array.from(horizon.angle_deg), sig: Float64Array.from(horizon.sigma_deg) } : null;
    s.basis = s.hz ? 'terrain' : (Math.abs(s.lat) >= POLAR_LAT ? 'upper' : 'approx');
    return s;
  }

  var tmp = {};
  // Azimuth (clockwise from geographic north), elevation (deg, centre of disc, flat local horizontal), angular radius.
  function skyDir(sky, site, t, which) {
    sky.dirs(t, tmp);
    var vx, vy, vz, up = site.up, e = site.east, n = site.north, rad;
    if (which === 'sun') {           // Sun at infinity: parallax from the Moon's radius is < 0.001 deg
      vx = tmp.sX; vy = tmp.sY; vz = tmp.sZ; rad = SUN_R_DEG;
    } else {                         // Earth at finite distance: vector site -> Earth centre
      vx = tmp.D * tmp.eX - site.rKm * up[0];
      vy = tmp.D * tmp.eY - site.rKm * up[1];
      vz = tmp.D * tmp.eZ - site.rKm * up[2];
    }
    var len = Math.sqrt(vx * vx + vy * vy + vz * vz);
    var sinEl = (vx * up[0] + vy * up[1] + vz * up[2]) / len;
    var east = vx * e[0] + vy * e[1] + vz * e[2];
    var north = vx * n[0] + vy * n[1] + vz * n[2];
    if (which !== 'sun') rad = Math.asin(EARTH_R_KM / len) / RAD;
    var az = Math.atan2(east, north) / RAD;
    return { az: (az + 360) % 360, el: Math.asin(Math.max(-1, Math.min(1, sinEl))) / RAD, rad: rad };
  }

  // Horizon height (deg) at an azimuth; shift = number of sigmas (+1 = horizon raised = worse).
  function horizonAt(site, az, shift) {
    if (!site.hz) return 0;
    var a = ((az % 360) + 360) % 360, i = Math.floor(a), f = a - i, j = (i + 1) % 360;
    var h = site.hz.ang[i] * (1 - f) + site.hz.ang[j] * f;
    if (shift) h += shift * (site.hz.sig[i] * (1 - f) + site.hz.sig[j] * f);
    return h;
  }
  // Fraction of a disc of radius r whose centre is d above a straight horizon line.
  function discFrac(d, r) {
    if (d >= r) return 1;
    if (d <= -r) return 0;
    return 0.5 + (d * Math.sqrt(r * r - d * d) / (r * r) + Math.asin(d / r)) / Math.PI;
  }
  function bodyState(sky, site, t, which, shift) {
    var p = skyDir(sky, site, t, which);
    var h = horizonAt(site, p.az, shift || 0);
    return { az: p.az, el: p.el, h: h, rad: p.rad, frac: discFrac(p.el - h, p.rad) };
  }

  // ---------- The rule ----------
  // Sky geometry for 60 days from landing day t0, hourly. Independent of terrain, computed once per site and date.
  function skySeries(sky, site, t0) {
    var o = { sunAz: new Float32Array(SERIES_H), sunEl: new Float32Array(SERIES_H),
              eAz: new Float32Array(SERIES_H), eEl: new Float32Array(SERIES_H), eRad: new Float32Array(SERIES_H) };
    for (var i = 0; i < SERIES_H; i++) {
      var t = t0 + i / 24, s = skyDir(sky, site, t, 'sun'), e = skyDir(sky, site, t, 'earth');
      o.sunAz[i] = s.az; o.sunEl[i] = s.el; o.eAz[i] = e.az; o.eEl[i] = e.el; o.eRad[i] = e.rad;
    }
    return o;
  }
  // Visible fraction of each disc for a horizon shifted by `shift` sigmas.
  function visSeries(site, ss, shift) {
    var sun = new Float32Array(SERIES_H), earth = new Float32Array(SERIES_H);
    for (var i = 0; i < SERIES_H; i++) {
      sun[i] = discFrac(ss.sunEl[i] - horizonAt(site, ss.sunAz[i], shift), SUN_R_DEG);
      earth[i] = discFrac(ss.eEl[i] - horizonAt(site, ss.eAz[i], shift), ss.eRad[i]);
    }
    return { sun: sun, earth: earth };
  }
  function longestGap(arr, i0, i1) {     // longest run of hourly samples with < 50 % of the disc visible
    var best = 0, run = 0;
    for (var i = i0; i <= i1; i++) {
      if (arr[i] < 0.5) { run++; if (run > best) best = run; } else run = 0;
    }
    return best;
  }
  // Day k (0..29) of launch delay is green if both longest gaps stay within limits for the whole mission.
  function strip(vis, M, D, G) {
    var out = [];
    for (var k = 0; k < 30; k++) {
      var i0 = k * 24, i1 = (k + M) * 24;
      var sg = longestGap(vis.sun, i0, i1), eg = longestGap(vis.earth, i0, i1);
      out.push({ ok: sg <= D && eg <= G, sg: sg, eg: eg });
    }
    return out;
  }
  function survives(st) {
    for (var k = 0; k < st.length; k++) if (!st[k].ok) return k;
    return st.length;
  }
  function analyse(sky, site, t0, prof, ssPre) {
    var ss = ssPre || skySeries(sky, site, t0);
    var nom = strip(visSeries(site, ss, 0), prof.M, prof.D, prof.G);
    var out = { nom: nom, n: survives(nom), ss: ss };
    if (site.basis === 'terrain') {
      var worse = survives(strip(visSeries(site, ss, +1), prof.M, prof.D, prof.G));
      var better = survives(strip(visSeries(site, ss, -1), prof.M, prof.D, prof.G));
      out.lo = Math.min(worse, better, out.n); out.hi = Math.max(worse, better, out.n);
    }
    return out;
  }
  // Hours until the disc changes between "mostly visible" (>= 50 %) and not, searching `maxDays` ahead.
  function timeToChange(sky, site, t, which, maxDays) {
    maxDays = maxDays || 45;
    var now = bodyState(sky, site, t, which, 0).frac >= 0.5;
    var last = Math.min(maxDays * 24, Math.floor((sky.maxT - t) * 24));
    for (var h = 1; h <= last; h++) {
      if ((bodyState(sky, site, t + h / 24, which, 0).frac >= 0.5) !== now) return { up: now, hours: h };
    }
    return { up: now, hours: null };
  }

  // Valid landing dates: the 60-day window must lie inside the Horizons file.
  function landingRange(sky) {
    return { firstMs: EPOCH, lastMs: EPOCH + Math.floor(sky.maxT - SERIES_DAYS) * DAY };
  }
  function checkLanding(sky, ms) {
    var r = landingRange(sky);
    if (isNaN(ms) || ms < r.firstMs || ms > r.lastMs) {
      return { ok: false, firstMs: r.firstMs, lastMs: r.lastMs };
    }
    return { ok: true, firstMs: r.firstMs, lastMs: r.lastMs };
  }

  return {
    Sky: Sky, makeSite: makeSite, skyDir: skyDir, horizonAt: horizonAt, discFrac: discFrac, bodyState: bodyState,
    skySeries: skySeries, visSeries: visSeries, longestGap: longestGap, strip: strip, survives: survives,
    analyse: analyse, timeToChange: timeToChange, landingRange: landingRange, checkLanding: checkLanding, tOf: tOf,
    EPOCH: EPOCH, DAY: DAY, POLAR_LAT: POLAR_LAT, SERIES_H: SERIES_H, SUN_R_DEG: SUN_R_DEG, MOON_R_KM: MOON_R_KM
  };
});
