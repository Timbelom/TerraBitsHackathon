// Visual astronomy model in Moon-centered coordinates. NOT a Horizons ephemeris.
// Distances are intentionally compressed for legibility; vectors show apparent directions.
export const SYNODIC_DAYS = 29.53059;
export const REFERENCE_MS = Date.UTC(2026,10,14);
export function skyDirections(date){
 const t=(new Date(date).getTime()-REFERENCE_MS)/86400000;
 if(!Number.isFinite(t))throw Error('Invalid date');
 // Apparent solar motion relative to a lunar-fixed observer, one synodic lunar day.
 const p=2*Math.PI*t/SYNODIC_DAYS+0.8;
 const sun=[Math.sin(p),0.08*Math.sin(p-0.4),Math.cos(p)];
 // Earth librates close to its mean direction: not a second monthly orbit.
 const l=2*Math.PI*t/27.321661;
 const earth=[0.60+0.075*Math.sin(l),0.28+0.07*Math.cos(l),0.75+0.055*Math.sin(l+0.5)];
 const norm=v=>{const d=Math.hypot(...v);return v.map(x=>x/d)};
 return {sun:norm(sun),earth:norm(earth),lunarDays:t};
}
