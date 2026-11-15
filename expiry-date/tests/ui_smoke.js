// UI smoke test in jsdom: loads index.html + core.js + app.js with a file-backed fetch, clicks around, reads the DOM.
// Needs jsdom (not part of the repo): npm i jsdom --prefix ~/jsdomenv ; NODE_PATH=~/jsdomenv/node_modules node tests/ui_smoke.js
let JSDOM; try { ({ JSDOM } = require('jsdom')); } catch (e) { console.log('skipped: jsdom not installed'); process.exit(0); }
const fs = require('fs'), path = require('path'), assert = require('assert');
const root = path.join(__dirname, '..');
(async () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<script src="[^"]+"><\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  const w = dom.window, errors = [];
  w.addEventListener('error', e => errors.push(String(e.message)));
  w.fetch = url => {
    const p = path.join(root, url);
    if (!fs.existsSync(p)) return Promise.resolve({ ok: false, status: 404 });
    const b = fs.readFileSync(p);
    return Promise.resolve({ ok: true, status: 200, json: async () => JSON.parse(b.toString()), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) });
  };
  w.eval(fs.readFileSync(path.join(root, 'core.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(root, 'app.js'), 'utf8'));
  const wait = ms => new Promise(r => setTimeout(r, ms)), $ = id => w.document.getElementById(id);
  await wait(800);
  const rows = () => [...w.document.querySelectorAll('.srow')].map(r => ({ name: r.querySelector('.nm').textContent.replace(/\s+/g, ' ').trim(), label: r.querySelector('.lab').textContent, green: r.querySelectorAll('.c.g').length, cells: r.querySelectorAll('.c').length }));
  console.log('badge:', $('badge').textContent, '| fatal hidden:', $('fatal').hidden);
  console.log('default date', $('date').value); rows().forEach(r => console.log('  ', JSON.stringify(r)));
  assert.equal($('fatal').hidden, true); assert.equal(rows().length, 3); assert.ok(rows().every(r => r.cells === 30));
  const cr = rows()[0].label; assert.ok(/survives 6 days/.test(cr), 'Connecting ridge on 2028-07-07 should survive 6 days, got: ' + cr);
  assert.ok(/survives 1 day /.test(rows()[1].label), 'Shackleton rim: ' + rows()[1].label);
  assert.ok(/upper bound only/.test(rows()[2].label));
  console.log('sky name:', $('skyname').textContent, '| kp:', $('kp').textContent.replace(/\s+/g, ' ').slice(0, 160));
  console.log('stay figures:', $('kp2h').textContent, '|', $('kp2').textContent.replace(/\s+/g, ' ').slice(0, 200));
  assert.ok(/<circle/.test($('sky').innerHTML) && /<polygon/.test($('sky').innerHTML) && /stroke-dasharray/.test($('sky').innerHTML));
  console.log('basis:', $('basis').textContent.replace(/\s+/g, ' ').slice(0, 330));
  // interactions
  $('date').value = '2066-12-30'; $('date').dispatchEvent(new w.Event('change')); await wait(50);
  console.log('out of range ->', $('datemsg').textContent, '| date kept:', $('date').value); assert.equal($('date').value, '2028-07-07'); assert.ok($('datemsg').textContent.length > 10);
  $('date').value = '2066-11-02'; $('date').dispatchEvent(new w.Event('change')); await wait(50);
  assert.equal($('date').value, '2066-11-02'); assert.equal($('datemsg').textContent, '');
  $('plus').click(); await wait(20); assert.equal($('date').value, '2066-11-02'); console.log('last day +1 ->', $('datemsg').textContent);
  $('date').value = '2028-07-07'; $('date').dispatchEvent(new w.Event('change')); await wait(50);
  w.document.querySelector('.chip[data-id="a11"]').click(); await wait(20);   // full -> ignored
  w.document.querySelector('.chip[data-id="im2"]').click(); await wait(20);   // deselect
  w.document.querySelector('.chip[data-id="a11"]').click(); await wait(20);   // select Apollo 11
  console.log('after chip change:', rows().map(r => r.name.split(' ')[0] + ' ' + r.name.split(' ')[1] + ' => ' + r.label).join(' || '));
  $('clat').value = '-86.2'; $('clon').value = '45'; $('cadd').click(); await wait(20);
  console.log('custom:', rows().map(r => r.name + ' => ' + r.label).pop());
  w.document.querySelectorAll('.seg button')[1].click(); await wait(20);
  console.log('long stay:', rows().map(r => r.label.slice(0, 40)).join(' | '));
  const cell = w.document.querySelector('.c[data-k="8"]'); cell.click(); await wait(20);
  console.log('after click day 8: clock', $('clk').textContent);
  const t = process.hrtime.bigint(); for (let i = 0; i < 20; i++) { $('dr').value = 6 + i; $('dr').dispatchEvent(new w.Event('input')); }
  console.log('20 re-renders (3 rows each):', (Number(process.hrtime.bigint() - t) / 1e6).toFixed(0), 'ms');
  console.log('script errors:', errors.length ? errors : 'none'); assert.equal(errors.length, 0);
  console.log('UI SMOKE OK'); process.exit(0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
