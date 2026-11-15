// Relief shading for the lit surfaces (Moon mesh and terrain view): a display aid on top of the Sun's light.
// Under a high Sun, and on ground that only the fill light reaches, light and shadow alone show little of the
// shape of the ground. As in cartographic slope shading, each mesh node therefore gets one factor on the
// surface brightness: steep ground darker, ridges and rims a little lighter, hollows a little darker. The factor
// depends on the LOLA heights only, not on the Sun, the time or the camera. Cast shadows and the numbers of the
// page (horizon, disc in view, W/m2) do not use it.
const RAD = Math.PI / 180;

/**
 * Factor per node of a height grid (row-major, rows x cols), about 0.4 .. 1.2.
 * height(i): metres; cellX(row), cellY: node spacing in metres; wrap: columns close around (global grid).
 * slopeRefDeg: slope at which most of the darkening is reached; reach: distance (in nodes) of the neighbours the
 * height is compared with; curvRefM: height difference to them that counts as a clear ridge or hollow.
 */
export function reliefShade({ cols, rows, height, cellX, cellY, wrap = false, slopeRefDeg, reach, curvRefM }) {
  const out = new Float32Array(rows * cols), tRef = Math.tan(slopeRefDeg * RAD);
  const at = (r, c) => height(Math.min(rows - 1, Math.max(0, r)) * cols + (wrap ? (c + cols) % cols : Math.min(cols - 1, Math.max(0, c))));
  for (let r = 0; r < rows; r++) {
    const dx = cellX(r);
    for (let c = 0; c < cols; c++) {
      const gx = (at(r, c + 1) - at(r, c - 1)) / (2 * dx), gy = (at(r + 1, c) - at(r - 1, c)) / (2 * cellY), slope = Math.hypot(gx, gy);
      const h = at(r, c), around = (at(r, c - reach) + at(r, c + reach) + at(r - reach, c) + at(r + reach, c)) / 4;
      out[r * cols + c] = (1 - .5 * (1 - Math.exp(-1.6 * slope / tRef))) * (1 + .2 * Math.tanh((h - around) / curvRefM));
    }
  }
  return out;
}

/**
 * Lets a lit material (MeshStandardMaterial) use the geometry's float attribute "shade" as that factor.
 * compress > 0 also bends the brightness of the lit result: out = L / (1 + compress * L). Dark parts keep
 * their brightness, the part under a high Sun is held back, so it does not burn out to white.
 * horizon: uniforms { uHorizon (Data3DTexture: skyline per 0.5 deg node and azimuth, tools/build_horizon.mjs),
 * uHorizonOn (0 | 1), uSunObj (unit vector to the Sun in the mesh's own axes: x = lon 0, y = north, z = lon 90 W),
 * uHorizonMin, uHorizonSpan (deg) }. With it the Sun's light on each fragment is scaled by how far the Sun stands
 * above the skyline there: cast shadows from the terrain model itself, the same on every graphics card.
 */
export function shadeMaterial(material, { compress = 0, horizon = null } = {}) {
  material.onBeforeCompile = shader => {
    if (horizon) Object.assign(shader.uniforms, horizon);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float shade;\nvarying float vShade;\nvarying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvShade = shade;\nvObj = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vShade;\nvarying vec3 vObj;' + (horizon ? `
uniform highp sampler3D uHorizon; uniform float uHorizonOn; uniform vec3 uSunObj; uniform float uHorizonMin; uniform float uHorizonSpan;
// share of the Sun's light that reaches this point: Sun's elevation against the skyline in the Sun's azimuth
float sunOverSkyline() {
  vec3 n = normalize(vObj);
  float el = degrees(asin(clamp(dot(uSunObj, n), -1., 1.)));
  vec3 north = vec3(0., 1., 0.) - n * n.y; float ln = length(north);
  if (ln < 1e-5) return 1.;
  north /= ln; vec3 east = cross(north, n);
  float az = atan(dot(uSunObj, east), dot(uSunObj, north));                 // clockwise from north
  vec3 uvw = vec3(atan(-n.z, n.x) / 6.2831853 + .5, asin(clamp(n.y, -1., 1.)) / 3.14159265 + .5, az / 6.2831853 + .5 / float(textureSize(uHorizon, 0).z));
  float skyline = uHorizonMin + texture(uHorizon, uvw).r * uHorizonSpan;
  // the Sun's disc is 0.53 deg wide; the edge is drawn over 1 deg because the skyline is known per 15 km node only
  return smoothstep(-.5, .5, el - skyline);
}` : ''))
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vShade;')
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>' + (horizon ? '\nif (uHorizonOn > .5) { float sunShare = sunOverSkyline(); reflectedLight.directDiffuse *= sunShare; reflectedLight.directSpecular *= sunShare; }' : ''))
      .replace('#include <opaque_fragment>', (compress > 0 ? 'outgoingLight = outgoingLight / (1.0 + ' + compress.toFixed(3) + ' * outgoingLight);\n' : '') + '#include <opaque_fragment>');
  };
  material.customProgramCacheKey = () => 'relief-shade-' + compress + (horizon ? '-h' : '');
  return material;
}
