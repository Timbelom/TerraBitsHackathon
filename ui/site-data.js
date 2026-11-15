// What is known about the ground at each marked point, and so which horizon its numbers rest on.
// Best first:
//   'profile'  5 m site profile of Expiry Date (the two listed south-pole sites)
//   'block'    terrain block from LOLA LDEM64, loaded when a card or the terrain view asks for it
//   'globe'    the global 7.6 km grid, there for every point once it has loaded
//   'smooth'   no terrain: horizon at 0 deg
// get() answers at once with the best that is there and starts loading what could be better; when
// something arrives, `version` goes up and onChange() is called, so cards and plots redo their numbers.
import { makeSite, horizonFromBlock, horizonFromGlobe, horizonFromProfile, basisOf } from '../core/visibility.js';
import { blockFromGlobe } from '../core/terrain.js';

const keyOf = s => s.lat.toFixed(5) + ',' + s.lon.toFixed(5);

/** source: TerrainSource (core/terrain.js), already initialised or null; profileDir: folder of the paths in sites.json. */
export function createSiteData({ source, profileDir = 'expiry-date/', onChange }) {
  const entries = new Map();          // coordinate key -> entry
  let globe = null;
  const api = { version: 0, get, block, loadBlock, setGlobe, setSource, availability };
  const bump = () => { api.version++; onChange?.(); };

  function entry(s) {
    const k = keyOf(s);
    let e = entries.get(k);
    if (!e) {
      e = { key: k, lat: s.lat, lon: s.lon, profile: null, profileState: s.horizonFile ? 'idle' : 'none', block: null, blockState: 'idle', blockError: null,
            blockHorizon: null, globeHorizon: null, site: null, siteFor: null };
      entries.set(k, e);
      if (entries.size > 200) entries.delete(entries.keys().next().value);
    }
    return e;
  }
  function best(e) {
    if (e.profile) return e.profile;
    if (e.block && !e.block.coarse) return e.blockHorizon ??= horizonFromBlock(e.block);
    if (globe) return e.globeHorizon ??= horizonFromGlobe(globe, e.lat, e.lon);
    return null;
  }
  /**
   * The point as the calculation takes it. s: { lat, lon, horizonFile? }. want: also fetch the terrain block
   * if one can be had (cards do, a plot line alone does not).
   * Returns { site, horizon, basis, loading, available } - site is makeSite() of core/visibility.js.
   */
  function get(s, want = false) {
    const e = entry(s);
    if (e.profileState === 'idle') {
      e.profileState = 'loading';
      fetch(profileDir + s.horizonFile).then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
        .then(j => { e.profile = horizonFromProfile(j); e.profileState = 'ready'; bump(); }, () => { e.profileState = 'failed'; bump(); });
    }
    const available = availability(s);
    // a site with a 5 m profile does not need the block for its numbers
    if (want && e.profileState === 'none' && e.blockState === 'idle' && available) loadBlock(s).catch(() => {});
    const horizon = best(e);
    if (e.siteFor !== horizon || !e.site) { e.site = makeSite(e.lat, e.lon, horizon ? horizon.heightM : 0, horizon); e.siteFor = horizon; }
    return { site: e.site, horizon, basis: basisOf(horizon), available, error: e.blockError,
             loading: e.profileState === 'loading' || (e.blockState === 'loading' && !e.profile) };
  }
  function availability(s) { return source ? source.availability(s.lat, s.lon) : null; }
  /** The loaded terrain block of a point, if any. */
  function block(s) { return entry(s).block; }
  /**
   * The terrain block of a point: full resolution where a source has it, otherwise built from the global
   * grid (block.coarse = true). Rejects only if neither is there.
   */
  function loadBlock(s, onProgress) {
    const e = entry(s);
    if (e.block && !e.block.coarse) { onProgress?.('download', 1); return Promise.resolve(e.block); }
    if (!availability(s)) {
      if (e.block) return Promise.resolve(e.block);
      if (!globe) return Promise.reject(new Error('no terrain data loaded yet'));
      e.block = blockFromGlobe(globe, e.lat, e.lon);
      return Promise.resolve(e.block);
    }
    e.blockState = 'loading'; e.blockError = null;
    return source.load(s.lat, s.lon, onProgress).then(b => { e.block = b; e.blockHorizon = null; e.blockState = 'ready'; bump(); return b; },
      err => { e.blockState = 'failed'; e.blockError = err.message; bump(); throw err; });
  }
  function setGlobe(g) { globe = g; bump(); }
  function setSource(src) { source = src; for (const e of entries.values()) if (e.blockState === 'failed') e.blockState = 'idle'; bump(); }
  return api;
}
