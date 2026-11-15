// Worker for core/area.js: the grids of the longest darkness and the longest time without the Earth are worked out
// off the page's thread, so the scene keeps moving. Messages in: { skyline: { bytes, meta } | null } once, then
// { id, samples, capH, sun, earth, part } per window (part { k, of }: the rows this worker does). Messages out: { id, progress } and { id, grids }.
import { makeSkyline, gapGrids } from './area.js';

let skyline = makeSkyline();
onmessage = e => {
  const m = e.data;
  if ('skyline' in m) skyline = m.skyline ? makeSkyline(m.skyline.bytes, m.skyline.meta) : makeSkyline();
  if (!m.samples) return;
  const grids = gapGrids(skyline, m.samples, { capH: m.capH, sun: m.sun, earth: m.earth, part: m.part, onProgress: f => postMessage({ id: m.id, progress: f }) });
  postMessage({ id: m.id, grids, part: m.part }, [grids.sun, grids.earth].filter(Boolean).map(g => g.buffer));
};
