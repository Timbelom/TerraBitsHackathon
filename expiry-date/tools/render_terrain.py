"""High-resolution render of the LOLA 5 m DEMs (PGDA Site01 / Site04): hillshade + cast shadows (soft, Sun disc 0.2666 deg,
Moon curvature included) for a given Sun azimuth/elevation. Usage: render_terrain.py site01|site04 sun_az sun_el earth_az earth_el 'label'
Written with AI assistance (Claude, Anthropic)."""
import sys, json, math, numpy as np, rasterio
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
sid, saz, sel, eaz, eel, label = sys.argv[1], *map(float, sys.argv[2:6]), sys.argv[6]
tif = {'site01': 'Site01_final_adj_5mpp_surf.tif', 'site04': 'Site04_final_adj_5mpp_surf.tif'}[sid]
hz = json.load(open('data/horizon_%s.json' % sid)); tg = hz['target']
r = rasterio.open('data/raw/' + tif); h = r.read(1).astype('float32'); t = r.transform
if np.isnan(h).any(): h = np.where(np.isnan(h), np.nanmean(h), h).astype('float32')
R, C = h.shape; P = 5.0; RM = 1737400.0
lam = math.radians(tg['lon_deg_east'])
north = np.array([math.sin(lam), math.cos(lam)]); east = np.array([math.cos(lam), -math.sin(lam)])
def grid_dir(az): a = math.radians(az); v = math.sin(a) * east + math.cos(a) * north; return v[0], v[1]
gx, gy = grid_dir(saz)
maxs = np.full((R, C), -1e9, np.float32)
dists = np.concatenate([np.arange(5, 600, 5), np.arange(600, 3000, 15), np.arange(3000, 16000, 60)]).astype(float)
for d in dists:
    sx, sy = int(round(gx * d / P)), int(round(-gy * d / P)); dd = math.hypot(sx, sy) * P
    if dd == 0: continue
    r0, r1, c0, c1 = max(0, -sy), R - max(0, sy), max(0, -sx), C - max(0, sx)
    if r1 <= r0 or c1 <= c0: continue
    sl = (h[r0 + sy:r1 + sy, c0 + sx:c1 + sx] - h[r0:r1, c0:c1] - dd * dd / (2 * RM)) / dd
    np.maximum(maxs[r0:r1, c0:c1], sl.astype('float32'), out=maxs[r0:r1, c0:c1])
ang = np.degrees(np.arctan(np.maximum(maxs, -1)))
SR = 0.2666
vis = np.clip((sel + SR - ang) / (2 * SR), 0, 1)
k = np.ones(3) / 3; hs = h.copy()
hs = (hs + np.roll(hs, 1, 0) + np.roll(hs, -1, 0)) / 3; hs = (hs + np.roll(hs, 1, 1) + np.roll(hs, -1, 1)) / 3
dzr, dzc = np.gradient(hs, P)
nx, ny, nz = -dzc, dzr, np.ones_like(hs)            # world y = -row direction
nn = np.sqrt(nx * nx + ny * ny + 1); ce = math.cos(math.radians(sel)); se = math.sin(math.radians(sel))
diff = np.clip((nx * gx * ce + ny * gy * ce + se) / nn, 0, 1)
I = vis * diff
ref = np.percentile(I[vis > 0.9], 99.5) if (vis > 0.9).any() else 1.0
I = np.clip(I / max(ref, 1e-6), 0, 1) ** 0.75
amb = 0.035 + 0.02 * (hs - hs.min()) / (hs.max() - hs.min())     # faint earthshine/scatter so shadows keep structure
Z = (hs - hs.min()) / (hs.max() - hs.min())
rgb = np.dstack([0.92 * I + 0.8 * amb, 0.89 * I + 0.82 * amb, 0.84 * I + 0.90 * amb]).clip(0, 1)
ext = [(t.c - tg['x_m']) / 1000, (t.c + C * P - tg['x_m']) / 1000, (t.f - R * P - tg['y_m']) / 1000, (t.f - tg['y_m']) / 1000]
fig = plt.figure(figsize=(16, 16.9), dpi=200, facecolor='#05070b'); ax = fig.add_axes([0.05, 0.06, 0.92, 0.85])
ax.imshow(rgb, extent=ext, interpolation='lanczos'); ax.set_facecolor('#05070b')
ax.plot([0], [0], marker='+', color='#ffdd55', ms=26, mew=2.5); ax.annotate('Target point (highest point of the tile)', (0, 0), (0.25, 0.9), color='#ffdd55', fontsize=13,
    arrowprops=dict(color='#ffdd55', lw=1.2))
ax.contour(np.linspace(ext[0], ext[1], C), np.linspace(ext[3], ext[2], R), hs, levels=np.arange(np.floor(hs.min() / 250) * 250, hs.max() + 250, 250), colors='#8fb4ff', linewidths=0.35, alpha=0.35)
ax.set_xlabel('km along grid x from target', color='#9aa7b8'); ax.set_ylabel('km along grid y from target', color='#9aa7b8'); ax.tick_params(colors='#9aa7b8')
for s in ax.spines.values(): s.set_color('#2a3547')
def arrow(az, col, txt, cx0, cy0, L=1.5):
    vx, vy = grid_dir(az); ax.annotate('', (cx0 + vx * L, cy0 + vy * L), (cx0, cy0), arrowprops=dict(color=col, lw=3, arrowstyle='-|>', mutation_scale=26), zorder=6)
    ax.text(cx0 + vx * (L + 0.45), cy0 + vy * (L + 0.45), txt, color=col, fontsize=13, ha='center', va='center', fontweight='bold', zorder=6)
bx, by = ext[0] + 2.4, ext[3] - 2.4          # compass box, top-left corner
ax.add_patch(plt.Rectangle((ext[0] + 0.2, ext[3] - 4.6), 4.4, 4.4, color='#05070b', alpha=0.75, zorder=5))
arrow(saz, '#ffcc33', 'Sun', bx, by); arrow(eaz, '#5aa9ff', 'Earth', bx, by); arrow(0, '#ff8080', 'N', bx, by)
ax.set_xlim(ext[0], ext[1]); ax.set_ylim(ext[2], ext[3])
sx0, sy0 = ext[1] - 2.6, ext[2] + 0.6; ax.plot([sx0, sx0 + 2], [sy0, sy0], color='w', lw=4); ax.text(sx0 + 1, sy0 + 0.25, '2 km', color='w', ha='center', fontsize=12)
mn, mx = float(h.min()), float(h.max())
fig.text(0.04, 0.955, 'Expiry Date · ' + tg.get('rule', '') [:0] + hz['name'] + ' · NASA LOLA 5 m DEM, cast shadows', color='#e6ebf2', fontsize=22, fontweight='bold')
fig.text(0.04, 0.938, label, color='#9aa7b8', fontsize=13)
fig.text(0.04, 0.920, 'Sun elevation %.2f°, azimuth %.0f° · Earth elevation %.2f°, azimuth %.0f° (JPL Horizons DE441) · relief %.0f m (%.0f–%.0f m)' % (sel, saz, eel, eaz, mx - mn, mn, mx), color='#9aa7b8', fontsize=13)
fig.text(0.04, 0.008, 'Soft shadows (Sun disc 0.27°), Moon curvature included. Illustration; not a landing-ellipse or safety product. Generated with AI assistance (Claude, Anthropic). Data: NASA PGDA.', color='#6c7a8c', fontsize=10)
out = 'docs/renders/render_%s.png' % sid; fig.savefig(out, facecolor=fig.get_facecolor()); print('wrote', out, 'shadow frac', float((vis < 0.5).mean()))
