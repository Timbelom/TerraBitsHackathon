// TerraBits own exploration state: data is user preference, never a NASA measurement.
export const DEFAULT_EXPLORER = Object.freeze({grid:false,markers:false,selected:null});
export function normalizeExplorerState(raw){
  const v=raw&&typeof raw==='object'?raw:{};
  const selected=v.selected&&Number.isFinite(v.selected.lat)&&Number.isFinite(v.selected.lon)&&v.selected.lat>=-90&&v.selected.lat<=90?{lat:v.selected.lat,lon:((v.selected.lon+180)%360+360)%360-180}:null;
  return {grid:v.grid===true,markers:v.markers===true,selected};
}
export function readExplorerState(storage){try{return normalizeExplorerState(JSON.parse(storage.getItem('terrabits:explorer:v1')||'null'))}catch{return {...DEFAULT_EXPLORER}}}
export function saveExplorerState(storage,state){try{storage.setItem('terrabits:explorer:v1',JSON.stringify(normalizeExplorerState(state)))}catch{}}
