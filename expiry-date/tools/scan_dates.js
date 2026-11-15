// Scans daily landing dates for the two terrain sites (short profile) and prints dates where they differ most.
// Usage: node tools/scan_dates.js [startISO] [days]
const fs = require('fs'), path = require('path');
const C = require('../core.js'); const root = path.join(__dirname, '..');
const meta = JSON.parse(fs.readFileSync(path.join(root, 'data/sky_meta.json')));
const sky = C.Sky.fromNodeBuffer(meta, fs.readFileSync(path.join(root, 'data/sky_2027_2066.bin')));
const defs = JSON.parse(fs.readFileSync(path.join(root, 'data/sites.json'))).sites;
const mk = id => { const d = defs.find(x => x.id === id); let hz = null; if (d.horizon) { hz = JSON.parse(fs.readFileSync(path.join(root, d.horizon))); d.lat = hz.target.lat_deg; d.lon = hz.target.lon_deg_east; d.z = hz.target.z_m; } return C.makeSite(d, hz); };
const cr = mk('cr'), sh = mk('sh'), a11 = mk('a11');
const pr = { M: 10, D: 6, G: 12 };
const start = Date.parse((process.argv[2] || '2027-01-01') + 'T00:00:00Z'), days = +(process.argv[3] || 730);
const rows = [];
let t = process.hrtime.bigint();
for (let i = 0; i < days; i++) {
  const t0 = C.tOf(start + i * C.DAY);
  const a = C.analyse(sky, cr, t0, pr), b = C.analyse(sky, sh, t0, pr), c = C.analyse(sky, a11, t0, pr);
  rows.push({ d: new Date(start + i * C.DAY).toISOString().slice(0, 10), cr: a, sh: b, a11: c });
}
const ms = Number(process.hrtime.bigint() - t) / 1e6;
console.log('scanned', days, 'dates x 3 sites in', ms.toFixed(0), 'ms  ->', (ms / days).toFixed(1), 'ms per date (3 sites)');
const f = r => `${r.d}  CR n=${String(r.cr.n).padStart(2)} [${r.cr.lo}-${r.cr.hi}]  SH n=${String(r.sh.n).padStart(2)} [${r.sh.lo}-${r.sh.hi}]  A11 n=${String(r.a11.n).padStart(2)}`;
const both = rows.filter(r => r.cr.lo >= 1 && r.sh.lo >= 1);
console.log('\nboth terrain sites survive >= 1 day for sure (lo>=1), largest gap in n:');
both.sort((x, y) => Math.abs(y.cr.n - y.sh.n) - Math.abs(x.cr.n - x.sh.n)).slice(0, 12).forEach(r => console.log(f(r)));
const hist = {}; rows.forEach(r => { const k = r.cr.n + '/' + r.sh.n; hist[k] = (hist[k] || 0) + 1; });
console.log('\ndays with cr.n>=1:', rows.filter(r => r.cr.n >= 1).length, ' sh.n>=1:', rows.filter(r => r.sh.n >= 1).length, ' both:', both.length, ' of', days);
console.log('max n  cr:', Math.max(...rows.map(r => r.cr.n)), ' sh:', Math.max(...rows.map(r => r.sh.n)), '  a11:', Math.max(...rows.map(r => r.a11.n)));
