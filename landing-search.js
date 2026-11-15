// Search field in the header of the landing page: find a listed landing site by name, or type
// coordinates (any "lat, lon" spelling the Site field of the sidebar accepts).
// Suggestions open under the field; arrow keys move, Enter chooses, Escape closes.
import { coordText } from './landing-pins.js';

/** input, list: the field and its <ul>; sites(): listed sites; parse(text): [lat, lon] or null; choose({site}|{coord}). */
export function createSearch({ input, list, sites, parse, choose }) {
  let items = [], active = -1;
  const open = on => { list.hidden = !on; input.setAttribute('aria-expanded', on); if (!on) input.removeAttribute('aria-activedescendant'); };
  function mark(i) {
    active = i;
    [...list.children].forEach((li, k) => li.setAttribute('aria-selected', k === i));
    if (i >= 0) input.setAttribute('aria-activedescendant', list.children[i].id); else input.removeAttribute('aria-activedescendant');
  }
  function build() {
    const q = input.value.trim(), c = parse(q), k = q.toLowerCase();
    items = c ? [{ label: 'Go to ' + coordText({ lat: c[0], lon: c[1] }), coord: c }]
      : sites().filter(s => s.name.toLowerCase().includes(k)).map(s => ({ label: s.name, sub: coordText(s), site: s }));
    list.replaceChildren(...items.map((it, i) => {
      const li = document.createElement('li'); li.id = 'search-opt-' + i; li.setAttribute('role', 'option');
      const a = document.createElement('span'); a.textContent = it.label; li.append(a);
      if (it.sub) { const b = document.createElement('small'); b.textContent = it.sub; li.append(b); }
      li.addEventListener('pointerdown', e => e.preventDefault());       // keep the focus in the field
      li.addEventListener('click', () => take(i));
      li.addEventListener('pointermove', () => { if (active !== i) mark(i); });
      return li;
    }));
    if (!items.length) { const li = document.createElement('li'); li.className = 'search-none'; li.textContent = 'No listed site. For coordinates type lat, lon in degrees, e.g. -89.45, 222.8'; list.append(li); }
    mark(c ? 0 : -1); open(true);
  }
  function take(i) {
    const it = items[i]; if (!it) return;
    input.value = it.site ? it.site.name : it.coord[0].toFixed(4) + ', ' + it.coord[1].toFixed(4);
    open(false); choose(it);
  }
  input.addEventListener('input', build);
  input.addEventListener('focus', build);
  input.addEventListener('blur', () => open(false));
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (list.hidden) return build(); if (items.length) mark((active + (e.key === 'ArrowDown' ? 1 : items.length - 1) + (active < 0 && e.key === 'ArrowUp' ? 1 : 0)) % items.length); }
    else if (e.key === 'Enter') { e.preventDefault(); take(active >= 0 ? active : 0); }
    else if (e.key === 'Escape' && !list.hidden) { e.stopPropagation(); open(false); }
  });
}
