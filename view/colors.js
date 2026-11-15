// Colour scales for data on the ground, shared by the globe, the terrain view and the legend.
// All three are perceptually even and readable with colour-vision deficiencies (after matplotlib's
// viridis, inferno and cividis; a few stops each, blended linearly in between).
export const VIRIDIS = [[0.267, 0.005, 0.329], [0.230, 0.322, 0.545], [0.128, 0.567, 0.551], [0.369, 0.789, 0.383], [0.993, 0.906, 0.144]];
export const INFERNO = [[0.001, 0.000, 0.014], [0.258, 0.039, 0.406], [0.578, 0.148, 0.404], [0.865, 0.317, 0.226], [0.988, 0.645, 0.040], [0.988, 0.998, 0.645]];
// Mean sunlight and Earth contact: dark violet at the low end in both, so ground that rarely sees the body recedes
// into the dark page, warm towards yellow for the Sun, cool towards pale cyan for the Earth. Lightness rises
// steadily along each scale, so they also read without colour.
export const SUNLIGHT = [[0.130, 0.055, 0.300], [0.370, 0.075, 0.430], [0.620, 0.170, 0.390], [0.865, 0.317, 0.226], [0.988, 0.645, 0.040], [0.988, 0.950, 0.560]];
export const EARTHVIEW = [[0.105, 0.055, 0.230], [0.200, 0.140, 0.430], [0.165, 0.350, 0.530], [0.130, 0.560, 0.585], [0.360, 0.765, 0.720], [0.820, 0.955, 0.900]];
export const CIVIDIS = [[0.000, 0.135, 0.305], [0.259, 0.305, 0.423], [0.486, 0.485, 0.471], [0.737, 0.677, 0.427], [0.996, 0.910, 0.218]];

const toLinear = c => c <= .04045 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4);
/**
 * Colour of a scale at t (0..1) into out[o..o+2]. The stops are display (sRGB) values and are blended as
 * such, like the legend's gradient; the result is written in the renderer's linear working space, so the
 * mesh shows exactly the legend's colours.
 */
export function colorAt(t, stops, out, o = 0) {
  t = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(Math.floor(t), stops.length - 2), f = t - i, a = stops[i], b = stops[i + 1];
  out[o] = toLinear(a[0] + (b[0] - a[0]) * f); out[o + 1] = toLinear(a[1] + (b[1] - a[1]) * f); out[o + 2] = toLinear(a[2] + (b[2] - a[2]) * f);
}
/** A scale as a CSS gradient, for the legend. */
export const cssGradient = (stops, dir = 'to right') => 'linear-gradient(' + dir + ',' + stops.map(c => 'rgb(' + c.map(v => Math.round(v * 255)).join(' ') + ')').join(',') + ')';
