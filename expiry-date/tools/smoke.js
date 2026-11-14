// Smoke test: our az/el vs the one Horizons observer value fetched earlier (Sun, lon 0, lat -89.5, 2027-01-01 00:00 UT).
const fs = require('fs'), path = require('path');
const C = require('../core.js');
const meta = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/sky_meta.json')));
const sky = C.Sky.fromNodeBuffer(meta, fs.readFileSync(path.join(__dirname, '../data/sky_2027_2066.bin')));
const site = C.makeSite({ id: 'x', name: 'x', lat: -89.5, lon: 0 }, null);
const ref = [[0, 263.107140, 0.953942], [6, 260.066239, 0.923620], [12, 257.024960, 0.893607], [18, 253.983310, 0.863968], [24, 250.941297, 0.834769]];
for (const [h, az, el] of ref) {
  const s = C.skyDir(sky, site, h / 24, 'sun');
  console.log('h', h, 'az ours', s.az.toFixed(6), 'ref', az.toFixed(6), 'd', (s.az - az).toFixed(6), '| el ours', s.el.toFixed(6), 'ref', el.toFixed(6), 'd', (s.el - el).toFixed(6));
}
const e = C.skyDir(sky, site, 0, 'earth');
console.log('earth at t0:', e);
