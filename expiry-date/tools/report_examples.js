// Prints the strip result of every curated site for both profiles on given landing dates (default 2027-09-28).
const fs = require('fs'), path = require('path');
const C = require('../core.js'); const root = path.join(__dirname, '..');
const meta = JSON.parse(fs.readFileSync(path.join(root, 'data/sky_meta.json')));
const sky = C.Sky.fromNodeBuffer(meta, fs.readFileSync(path.join(root, 'data/sky_2027_2066.bin')));
const defs = JSON.parse(fs.readFileSync(path.join(root, 'data/sites.json'))).sites;
const sites = defs.map(d => { let hz = null; if (d.horizon) { hz = JSON.parse(fs.readFileSync(path.join(root, d.horizon))); d.lat = hz.target.lat_deg; d.lon = hz.target.lon_deg_east; d.z = hz.target.z_m; } return C.makeSite(d, hz); });
const PROF = { short: { M: 10, D: 6, G: 12 }, long: { M: 30, D: 48, G: 48 } };
const dates = process.argv.slice(2).length ? process.argv.slice(2) : ['2027-09-28'];
for (const ds of dates) {
  const t0 = C.tOf(Date.parse(ds + 'T00:00:00Z'));
  console.log('\n== landing', ds);
  for (const s of sites) for (const [pn, pr] of Object.entries(PROF)) {
    const a = C.analyse(sky, s, t0, pr);
    console.log(s.name.padEnd(28), s.basis.padEnd(7), pn.padEnd(6), 'n=' + String(a.n).padStart(2), (a.lo !== undefined ? 'range ' + a.lo + '-' + a.hi : '').padEnd(12), a.nom.map(x => x.ok ? 'G' : '.').join(''));
  }
}
