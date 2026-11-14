// Compare our sky (core.js + sky_2027_2066.bin) with JPL Horizons observer values. Target: < 0.1 deg angular separation.
// Usage: node tools/verify_sky.js   -> prints a table, writes docs/validation_sky.md, exit code 1 if the target is missed.
const fs = require('fs'), path = require('path');
const C = require('../core.js');
const root = path.join(__dirname, '..');
const meta = JSON.parse(fs.readFileSync(path.join(root, 'data/sky_meta.json')));
const sky = C.Sky.fromNodeBuffer(meta, fs.readFileSync(path.join(root, 'data/sky_2027_2066.bin')));
const ref = JSON.parse(fs.readFileSync(path.join(root, 'data/validation/horizons_reference.json')));
const R = Math.PI / 180;
function sep(az1, el1, az2, el2) {
  const c = Math.sin(el1 * R) * Math.sin(el2 * R) + Math.cos(el1 * R) * Math.cos(el2 * R) * Math.cos((az1 - az2) * R);
  return Math.acos(Math.max(-1, Math.min(1, c))) / R;
}
const rows = []; let worst = 0;
for (const s of ref.sites) {
  const site = C.makeSite({ id: 'v', name: s.name, lat: s.lat, lon: s.lon }, null);
  for (const body of ['sun', 'earth']) {
    ref.jd_ut.forEach((jd, k) => {
      const t = jd - ref.jd_epoch_2027_01_01;
      const o = C.skyDir(sky, site, t, body === 'sun' ? 'sun' : 'earth');
      const [raz, rel] = s[body][k];
      const d = sep(o.az, o.el, raz, rel);
      worst = Math.max(worst, d);
      rows.push({ site: s.name, body, date: new Date(C.EPOCH + t * C.DAY).toISOString().slice(0, 16).replace('T', ' '),
        az: o.az, el: o.el, raz, rel, daz: ((o.az - raz + 540) % 360) - 180, del: o.el - rel, sep: d });
    });
  }
}
const f = (x, n) => x.toFixed(n);
let md = '# Sky validation against JPL Horizons\n\n';
md += 'Our value = `core.js` with `sky_2027_2066.bin` (Horizons sub-Earth/sub-solar points, hourly, linear interpolation, Sun at infinity, Earth at finite distance).\n';
md += 'Reference = Horizons observer table, apparent azimuth/elevation of the body centre seen from a user-defined site on the Moon (retrieved ' + ref.retrieved + ').\n';
md += 'Target: angular separation < 0.1 deg. Aberration (up to 0.006 deg) and the Sun\'s parallax from the Moon\'s radius (0.0007 deg) are not modelled.\n\n';
md += '| Site | Body | Date (UTC) | Az ours | Az Horizons | El ours | El Horizons | dAz | dEl | Separation |\n|---|---|---|---|---|---|---|---|---|---|\n';
for (const r of rows) md += `| ${r.site} | ${r.body} | ${r.date} | ${f(r.az, 4)} | ${f(r.raz, 4)} | ${f(r.el, 4)} | ${f(r.rel, 4)} | ${f(r.daz, 4)} | ${f(r.del, 4)} | ${f(r.sep, 4)} |\n`;
md += `\n**Worst separation: ${f(worst, 4)} deg** over ${rows.length} comparisons (${worst < 0.1 ? 'target met' : 'TARGET MISSED'}).\n`;
fs.writeFileSync(path.join(root, 'docs/validation_sky.md'), md);
fs.writeFileSync(path.join(root, 'data/validation/sky_validation.json'), JSON.stringify({ worst_deg: +worst.toFixed(4), n: rows.length, reference_retrieved: ref.retrieved, target_deg: 0.1 }, null, 1));
console.log(md);
process.exit(worst < 0.1 ? 0 : 1);
