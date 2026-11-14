// Run: node --test tests/
const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const C = require('../core.js');
const root = path.join(__dirname, '..');
const meta = JSON.parse(fs.readFileSync(path.join(root, 'data/sky_meta.json')));
const sky = C.Sky.fromNodeBuffer(meta, fs.readFileSync(path.join(root, 'data/sky_2027_2066.bin')));
const defs = JSON.parse(fs.readFileSync(path.join(root, 'data/sites.json'))).sites;
function load(id) {
  const d = Object.assign({}, defs.find(x => x.id === id)); let hz = null;
  if (d.horizon) { hz = JSON.parse(fs.readFileSync(path.join(root, d.horizon))); d.lat = hz.target.lat_deg; d.lon = hz.target.lon_deg_east; d.z = hz.target.z_m; }
  return { site: C.makeSite(d, hz), hz };
}
const ymd = ms => new Date(ms).toISOString().slice(0, 10);

test('sky file: 350641 hourly rows, 2027-01-01 .. 2067-01-01', () => {
  assert.equal(sky.n, 350641);
  assert.equal(ymd(C.EPOCH + sky.maxT * C.DAY), '2067-01-01');
  assert.ok(sky.dist[0] > 356000 && sky.dist[0] < 407000);
});

test('sky agrees with JPL Horizons within 0.1 deg at 18 reference points', () => {
  execFileSync(process.execPath, [path.join(root, 'tools/verify_sky.js')], { stdio: 'pipe' });   // exit code 1 if the target is missed
});

test('disc fraction: half at the horizon, full above, none below', () => {
  assert.ok(Math.abs(C.discFrac(0, 0.27) - 0.5) < 1e-12);
  assert.equal(C.discFrac(0.3, 0.27), 1);
  assert.equal(C.discFrac(-0.3, 0.27), 0);
  assert.ok(C.discFrac(0.1, 0.27) > 0.5 && C.discFrac(-0.1, 0.27) < 0.5);
});

test('rule: a gap of exactly D hours is green, D+1 is red; strip stops at the first red day', () => {
  const N = C.SERIES_H, ones = () => new Float32Array(N).fill(1);
  const gap = (len, at) => { const a = ones(); for (let i = 0; i < len; i++) a[at + i] = 0; return a; };
  let st = C.strip({ sun: gap(6, 300), earth: ones() }, 10, 6, 12);
  assert.equal(C.survives(st), 30, 'gap == D must pass');
  st = C.strip({ sun: gap(7, 300), earth: ones() }, 10, 6, 12);
  assert.equal(C.survives(st), 3, 'windows k=3.. contain sample 300..306 first at k=3');
  st = C.strip({ sun: ones(), earth: gap(13, 50) }, 10, 6, 12);
  assert.equal(C.survives(st), 0, 'Earth gap 13 h > G=12 h in the first window');
});

test('landing dates outside the data are rejected, edges accepted', () => {
  const r = C.landingRange(sky);
  assert.equal(ymd(r.firstMs), '2027-01-01');
  assert.equal(ymd(r.lastMs), '2066-11-02');
  assert.ok(C.checkLanding(sky, r.firstMs).ok && C.checkLanding(sky, r.lastMs).ok);
  assert.ok(!C.checkLanding(sky, r.firstMs - C.DAY).ok && !C.checkLanding(sky, r.lastMs + C.DAY).ok && !C.checkLanding(sky, NaN).ok);
  assert.throws(() => C.skyDir(sky, load('a11').site, -1, 'sun'), RangeError);
});

test('horizon files: 360 finite values, plausible ranges, source and AI note present', () => {
  for (const id of ['cr', 'sh']) {
    const { hz } = load(id);
    for (const k of ['angle_deg', 'distance_m', 'sigma_deg']) {
      assert.equal(hz[k].length, 360); assert.ok(hz[k].every(Number.isFinite));
    }
    assert.ok(hz.angle_deg.every(a => a > -10 && a < 10));
    assert.ok(hz.distance_m.every(d => d >= 5 && d <= 285000));
    assert.ok(hz.sigma_deg.every(s => s >= 0 && s < 1));
    assert.ok(hz.source.dem_5m && hz.ai_note && hz.assumptions.note);
    assert.ok(hz.step_check_max_diff_deg < 0.01);
  }
});

test('site basis: terrain / approx / upper bound by data and the 80 deg constant', () => {
  assert.equal(load('cr').site.basis, 'terrain');
  assert.equal(load('a11').site.basis, 'approx');
  assert.equal(load('ch3').site.basis, 'approx');     // 69.4 S
  assert.equal(load('im1').site.basis, 'upper');       // 80.13 S
  assert.equal(load('im2').site.basis, 'upper');
  assert.equal(C.POLAR_LAT, 80);
});

test('terrain range brackets the nominal value; terrain changes the outcome somewhere', () => {
  const cr = load('cr').site, flat = C.makeSite({ id: 'f', name: 'f', lat: cr.lat, lon: cr.lon, z: cr.z }, null);
  const pr = { M: 10, D: 6, G: 12 };
  let differs = 0, scanned = 0;
  for (let i = 0; i < 400; i += 3) {
    const t0 = C.tOf(Date.UTC(2027, 0, 1) + i * C.DAY), a = C.analyse(sky, cr, t0, pr);
    assert.ok(a.lo <= a.n && a.n <= a.hi);
    if (C.analyse(sky, flat, t0, pr).n !== a.n) differs++;
    scanned++;
  }
  assert.ok(differs > 0, 'same place with and without terrain must differ on at least one date (found ' + differs + '/' + scanned + ')');
});

test('R12: three sites analysed in the browser-equivalent code in under 1 s', () => {
  const sites = ['cr', 'sh', 'im2'].map(id => load(id).site), pr = { M: 10, D: 6, G: 12 };
  const t0 = C.tOf(Date.UTC(2028, 6, 7)), s = process.hrtime.bigint();
  sites.forEach(x => C.analyse(sky, x, t0, pr));
  const ms = Number(process.hrtime.bigint() - s) / 1e6;
  console.log('   three sites: ' + ms.toFixed(1) + ' ms');
  assert.ok(ms < 1000);
});

test('pole geometry: Sun within +-1.6 deg at the exact pole, +-(1.6 + distance from pole) at 89.5 S', () => {
  for (const [lat, bound] of [[-90, 1.6], [-89.5, 2.15]]) {
    const p = C.makeSite({ id: 'p', name: 'p', lat, lon: 120 }, null);
    let lo = 99, hi = -99;
    for (let h = 0; h < 366 * 24; h += 7) { const e = C.skyDir(sky, p, h / 24, 'sun').el; lo = Math.min(lo, e); hi = Math.max(hi, e); }
    assert.ok(hi < bound && lo > -bound, `lat ${lat}: el range ${lo.toFixed(2)}..${hi.toFixed(2)}`);
  }
});
