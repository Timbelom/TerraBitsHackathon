#!/usr/bin/env python3
"""Horizon profile (360 azimuths) for a PGDA 5 m LOLA landing-site DEM, seen from its highest point.

Inputs (data/raw/, from download_data.bat):
  SiteNN_final_adj_5mpp_surf.tif    5 m DEM (m above the 1737.4 km reference sphere), south polar stereographic
  SiteNN_final_adj_5mpp_toterr.tif  5 m total height uncertainty (m, RMS)
  LDEM_80S_80MPP_ADJ.TIF            80 m DEM 80-90 deg S (far field, raster edge ~304 km from the pole)
Output: data/horizon_<id>.json  angle_deg[360], distance_m[360], sigma_deg[360] + target point + method.

Method: rays along great circles from the target (receiver 2 m above ground). Per ray, every sample point gives an
elevation angle against the local horizontal, exact spherical geometry (curvature included):
    tan(el) = ((R+z1) cos(theta) - r0) / ((R+z1) sin(theta)),  theta = distance / R,  r0 = R + z0 + 2 m
The horizon is the maximum over the ray. Step 5 m up to 5 km, 10 m up to 12 km, 40 m up to 285 km; the 5 m DEM is used
wherever it covers the point, the 80 m DEM elsewhere. Rays are cast every 0.25 deg; output bin i holds the maximum over
azimuth i +- 0.5 deg (conservative: the profile is never lower than the true silhouette).
Sigma (deg) = (sigma_z(obstacle) + sigma_z(target)) / max(distance, 100 m), per the concept. sigma_z(obstacle) comes from
the 5 m uncertainty map; outside the 5 m raster (no error raster loaded) an assumed 3 m is used.

Written with AI assistance (Claude, Anthropic).
"""
import datetime as dt, json, math, os, sys, time
import numpy as np, rasterio

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'data', 'raw')
OUT = os.path.join(ROOT, 'data')
R = 1737400.0
H_RX = 2.0
EDGE_M = 1000.0
SIGMA_FAR_M = 3.0
D_FLOOR_M = 100.0
MAX_D = 285000.0
CHUNK = 48


class Grid:
    def __init__(self, path):
        ds = rasterio.open(path)
        self.a = ds.read(1).astype(np.float32)
        self.left, self.top, self.res = ds.bounds.left, ds.bounds.top, ds.res[0]
        self.h, self.w = self.a.shape
        self.path = os.path.basename(path)

    def sample(self, x, y):
        fx = (x - self.left) / self.res - 0.5      # pixel centres at integer fx / fy
        fy = (self.top - y) / self.res - 0.5
        inside = (fx >= 0) & (fx <= self.w - 1) & (fy >= 0) & (fy <= self.h - 1)
        fx = np.clip(fx, 0, self.w - 1 - 1e-6)
        fy = np.clip(fy, 0, self.h - 1 - 1e-6)
        x0 = fx.astype(np.int64); y0 = fy.astype(np.int64)
        tx = fx - x0; ty = fy - y0
        a = self.a
        v = (a[y0, x0] * (1 - tx) * (1 - ty) + a[y0, x0 + 1] * tx * (1 - ty)
             + a[y0 + 1, x0] * (1 - tx) * ty + a[y0 + 1, x0 + 1] * tx * ty)
        return v, inside

    def xy(self, row, col):
        return self.left + (col + 0.5) * self.res, self.top - (row + 0.5) * self.res


def xy_to_unit(x, y):
    rho = math.hypot(x, y)
    c = 2 * math.atan(rho / (2 * R))
    s = math.sin(c)
    return np.array([s * y / rho, s * x / rho, -math.cos(c)])


def box_mean(a, k):
    c = np.cumsum(np.cumsum(np.pad(a.astype(np.float64), ((1, 0), (1, 0))), 0), 1)
    s = c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]
    return s / (k * k)


def pick_target(dem):
    k = 5
    sm = box_mean(dem.a, k)                      # sm[i, j] = mean of a[i:i+k, j:j+k]; centre pixel (i+2, j+2)
    m = int(EDGE_M / dem.res)
    h, w = sm.shape
    i0, i1 = max(m - k // 2, 0), min(h, dem.h - m - k // 2)
    j0, j1 = max(m - k // 2, 0), min(w, dem.w - m - k // 2)
    sub = sm[i0:i1, j0:j1]
    i, j = np.unravel_index(np.argmax(sub), sub.shape)
    return i0 + i + k // 2, j0 + j + k // 2


def distances():
    return np.concatenate([np.arange(5.0, 5000.0, 5.0), np.arange(5000.0, 12000.0, 10.0),
                           np.arange(12000.0, MAX_D, 40.0)])


def trace(p, north, east, r0, alphas_deg, d, near, far, err):
    th = d / R; sth = np.sin(th); cth = np.cos(th)
    n = len(alphas_deg)
    ang = np.empty(n); dist = np.empty(n); sig = np.empty(n); in_near = np.empty(n, bool)
    for c0 in range(0, n, CHUNK):
        al = np.radians(alphas_deg[c0:c0 + CHUNK])
        t = np.cos(al)[:, None] * north[None, :] + np.sin(al)[:, None] * east[None, :]
        X = p[0] * cth[None, :] + t[:, 0:1] * sth[None, :]
        Y = p[1] * cth[None, :] + t[:, 1:2] * sth[None, :]
        Z = p[2] * cth[None, :] + t[:, 2:3] * sth[None, :]
        k = 2 * R / (1.0 - Z)
        x = k * Y; y = k * X
        z5, in5 = near.sample(x, y)
        z80, in80 = far.sample(x, y)
        z = np.where(in5, z5, z80)
        e = np.arctan2((R + z) * cth[None, :] - r0, (R + z) * sth[None, :])
        e = np.where(in5 | in80, e, -np.inf)
        j = e.argmax(axis=1)
        ar = np.arange(len(j))
        ang[c0:c0 + len(j)] = np.degrees(e[ar, j])
        dist[c0:c0 + len(j)] = d[j]
        s5, ins = err.sample(x[ar, j], y[ar, j])
        sig[c0:c0 + len(j)] = np.where(ins, s5, SIGMA_FAR_M)
        in_near[c0:c0 + len(j)] = ins
    return ang, dist, sig, in_near


def build(tag, out_id, name, far):
    t0 = time.time()
    near = Grid(os.path.join(RAW, f'{tag}_final_adj_5mpp_surf.tif'))
    err = Grid(os.path.join(RAW, f'{tag}_final_adj_5mpp_toterr.tif'))
    row, col = pick_target(near)
    x, y = near.xy(row, col)
    z0 = float(near.a[row, col]); s0 = float(err.a[row, col])
    p = xy_to_unit(x, y)
    lat = math.degrees(math.asin(p[2])); lon = math.degrees(math.atan2(p[1], p[0])) % 360
    phi, lam = math.radians(lat), math.radians(lon)
    east = np.array([-math.sin(lam), math.cos(lam), 0.0])
    north = np.array([-math.sin(phi) * math.cos(lam), -math.sin(phi) * math.sin(lam), math.cos(phi)])
    r0 = R + z0 + H_RX
    print(f'[{tag}] target row {row} col {col}  x {x:.0f} y {y:.0f}  lat {lat:.5f} lon {lon:.5f}  z {z0:.1f} m  sigma_z {s0:.2f} m')
    print(f'[{tag}] DEM range {near.a.min():.0f}..{near.a.max():.0f} m; argmin at ', end='')
    ri, ci = np.unravel_index(np.argmin(near.a), near.a.shape)
    mx, my = near.xy(ri, ci); mp = xy_to_unit(mx, my)
    print(f'lat {math.degrees(math.asin(mp[2])):.4f} lon {math.degrees(math.atan2(mp[1], mp[0])) % 360:.3f}')
    d = distances()
    alphas = np.arange(1440) * 0.25
    ang, dist, sig, in_near = trace(p, north, east, r0, alphas, d, near, far, err)
    # bin to 360: bin i = max over azimuth i +- 0.5 deg
    A = np.empty(360); D = np.empty(360); S = np.empty(360); N = np.empty(360, bool)
    for i in range(360):
        idx = [(4 * i + o) % 1440 for o in (-2, -1, 0, 1, 2)]
        b = idx[int(np.argmax(ang[idx]))]
        A[i], D[i], N[i] = ang[b], dist[b], in_near[b]
        S[i] = math.degrees((SIGMA_FAR_M if not in_near[b] else sig[b]) * 0 + (sig[b] + s0) / max(dist[b], D_FLOOR_M))
    # self-check: dense 5 m sampling on a few raw azimuths
    dd = np.arange(5.0, MAX_D, 5.0)
    chk = [0, 90, 180, 270, 45, 333]
    worst = 0.0
    for a in chk:
        da, _, _, _ = trace(p, north, east, r0, np.array([a * 1.0]), dd, near, far, err)
        j = int(a / 0.25)
        worst = max(worst, abs(da[0] - ang[j]))
    print(f'[{tag}] step-size check: max |dense - standard| over {len(chk)} azimuths = {worst:.5f} deg')
    sun_band = (A > -2.0)
    print(f'[{tag}] horizon: min {A.min():.2f} max {A.max():.2f} deg (az of max {int(A.argmax())}); azimuths with horizon > -2 deg: {int(sun_band.sum())}')
    print(f'[{tag}] obstacle distance: median {np.median(D):.0f} m, p10 {np.percentile(D, 10):.0f} m, p90 {np.percentile(D, 90):.0f} m; in 5 m raster: {int(N.sum())}/360')
    print(f'[{tag}] sigma_deg: median {np.median(S):.4f} max {S.max():.4f}; for horizon > -2 deg: median {np.median(S[sun_band]) if sun_band.any() else float("nan"):.4f}')
    out = {
        'id': out_id, 'name': name, 'pgda_site': tag,
        'target': {'x_m': round(x, 1), 'y_m': round(y, 1), 'lat_deg': round(lat, 6), 'lon_deg_east': round(lon, 6),
                   'z_m': round(z0, 2), 'z_sigma_m': round(s0, 3),
                   'rule': 'highest point (5 x 5 pixel mean) at least 1 km from the 5 m raster edge'},
        'receiver_height_m': H_RX,
        'azimuth': 'index i = azimuth i deg clockwise from geographic north at the target; bin = max over i +- 0.5 deg',
        'angle_deg': [round(float(v), 4) for v in A],
        'distance_m': [int(round(float(v))) for v in D],
        'sigma_deg': [round(float(v), 5) for v in S],
        'method': {
            'geometry': 'great-circle rays, exact spherical elevation incl. curvature, reference sphere 1737.4 km',
            'steps_m': '5 (to 5 km), 10 (to 12 km), 40 (to 285 km)', 'ray_spacing_deg': 0.25,
            'near_field': 'PGDA 5 m DEM where it covers the point', 'far_field': 'PGDA LDEM_80S_80MPP_ADJ (80 m) elsewhere',
            'sigma': '(sigma_z obstacle + sigma_z target) / max(distance, 100 m); +-1 sigma band',
        },
        'assumptions': {
            'sigma_far_field_m': SIGMA_FAR_M,
            'sigma_distance_floor_m': D_FLOOR_M,
            'note': 'No error raster loaded for the 80 m far field: an assumed 3 m is used there (effect < 0.02 deg beyond 10 km). '
                    'The 100 m floor stops adjacent-pixel errors, which are strongly correlated, from giving absurd angles. Both are team-adjustable assumptions.',
        },
        'step_check_max_diff_deg': round(worst, 5),
        'source': {
            'dem_5m': f'NASA PGDA LOLA 5 m/pixel landing-site DEMs, {tag}: https://pgda.gsfc.nasa.gov/products/78',
            'dem_80m': 'NASA PGDA LOLA LDEM_80S_80MPP_ADJ: https://pgda.gsfc.nasa.gov/products/90',
            'frame': 'MOON_ME, DE421, south polar stereographic', 'citation': 'Barker et al., 2023, Planetary Science Journal 4, 183 (as requested on the PGDA page)'},
        'generated_utc': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%MZ'),
        'ai_note': 'Prepared with AI assistance (Claude, Anthropic).',
    }
    json.dump(out, open(os.path.join(OUT, f'horizon_{out_id}.json'), 'w'), separators=(',', ':'))
    print(f'[{tag}] done in {time.time() - t0:.0f} s -> data/horizon_{out_id}.json')


if __name__ == '__main__':
    far = Grid(os.path.join(RAW, 'LDEM_80S_80MPP_ADJ.TIF'))
    print('far field raster', far.a.shape, 'half-width km', far.w * far.res / 2000)
    build('Site01', 'site01', 'Connecting ridge (PGDA Site01)', far)
    build('Site04', 'site04', 'Shackleton rim (PGDA Site04)', far)
