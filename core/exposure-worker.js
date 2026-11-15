// Worker for core/exposure.js. Messages in: { block: blockFields() } once per block, then
// { id, sun, earth (skySamples), part } per time window. Messages out: { id, part, progress } and { id, part, grids }.
import { blockFrom, prepare, localSamples, exposureGrids } from './exposure.js';

let P = null;
onmessage = e => {
  const m = e.data;
  if (m.block) P = prepare(blockFrom(m.block));
  if (!m.sun || !P) return;
  const grids = exposureGrids(P, localSamples(m.sun, P.block.basis), localSamples(m.earth, P.block.basis), { part: m.part, onProgress: f => postMessage({ id: m.id, part: m.part, progress: f }) });
  postMessage({ id: m.id, part: m.part, grids }, [grids.sun.buffer, grids.earth.buffer]);
};
