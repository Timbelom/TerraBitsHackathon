#!/usr/bin/env python3
"""Global maps of sunlight and Earth visibility for one year: data/exposure/*.bin + index.json.

For every 0.5 deg cell of the Moon: the share of the Sun's disc, and of the Earth's disc, that stands above
the cell's horizon, averaged over all hours of the year (the usual "mean illumination" of lunar polar
studies, e.g. Mazarico et al. 2011, Icarus 211). The page shows them as the surfaces "Mean sunlight" and
"Earth in view".

Inputs, both already in the repo (no GeoTIFF needed):
  data/globe/ldem_me_1440x720.bin     global heights, 0.25 deg cells (tools/build_globe.py)
  expiry-date/data/sky_2027_2066.bin  hourly sub-solar and sub-Earth point, Earth distance (JPL Horizons)

Method, the same definitions as core/visibility.js:
  horizon   per cell in 72 directions (every 5 deg), from two grid cells (15 km) out to 300 km, every 7.6 km,
            exact spherical geometry with the observer 2 m above the ground; linear between the directions
  visible   area of the disc above a straight horizon line at the azimuth of its centre;
            Sun radius 0.2666 deg, Earth radius from its distance, Earth seen from the cell (parallax)
  time      every second hour of the year

The ground is only as fine as the grid: 7.6 km cells. Craters and ridges smaller than about 15 km are not
in it, so permanently shadowed floors and lit rims near the poles are blurred. The maps show the large
pattern; numbers for a single site come from its terrain block or site profile.

  python tools/build_exposure.py [--year 2027] [--out data/exposure]

Needs numpy. Takes a few minutes.
"""
import argparse
import datetime as dt
import hashlib
import json
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
R_KM = 1737.4
EARTH_R_KM = 6371.0
SUN_R_DEG = 0.2666
RECEIVER_M = 2.0
N_AZ = 72
REACH_KM = 300.0


def load_globe():
    meta = json.loads((ROOT / "data" / "globe" / "ldem_me_1440x720.json").read_text(encoding="utf-8"))
    z = np.fromfile(ROOT / "data" / "globe" / meta["file"], dtype="<i2").reshape(meta["height"], meta["width"]).astype(np.float32)
    return meta, z * meta["height_step_m"]


def sample_globe(meta, z, lat, lon):
    """Bilinear height (m); rows clamp at the poles, columns wrap."""
    h, w = z.shape
    rf = np.clip((meta["lat_first_center_deg"] - lat) / meta["cell_deg"], 0.0, h - 1.0)
    cf = (lon - meta["lon_first_center_deg"]) / meta["cell_deg"]
    r0 = np.minimum(np.floor(rf).astype(np.int32), h - 2)
    c0 = np.floor(cf).astype(np.int32)
    fr, fc = (rf - r0).astype(np.float32), (cf - c0).astype(np.float32)
    c0 %= w
    c1 = (c0 + 1) % w
    return (z[r0, c0] * (1 - fc) + z[r0, c1] * fc) * (1 - fr) + (z[r0 + 1, c0] * (1 - fc) + z[r0 + 1, c1] * fc) * fr


def load_sky(year):
    meta = json.loads((ROOT / "expiry-date" / "data" / "sky_meta.json").read_text(encoding="utf-8"))
    n = meta["n"]
    raw = np.fromfile(ROOT / "expiry-date" / "data" / meta["file"], dtype="<f4").reshape(5, n)
    start = dt.datetime.fromisoformat(meta["start_utc"].replace("Z", "+00:00"))
    i0 = int((dt.datetime(year, 1, 1, tzinfo=dt.timezone.utc) - start).total_seconds() // 3600)
    i1 = int((dt.datetime(year + 1, 1, 1, tzinfo=dt.timezone.utc) - start).total_seconds() // 3600)
    if i0 < 0 or i1 >= n:
        sys.exit(f"The Horizons table does not cover {year}.")
    sl = slice(i0, i1, 2)                                   # every second hour
    e_lon, e_lat, s_lon, s_lat, dist = (raw[k, sl].astype(np.float64) for k in range(5))

    def unit(lon, lat):
        lo, la = np.radians(lon), np.radians(lat)
        return np.stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)], axis=1)

    return unit(s_lon, s_lat).astype(np.float32), (unit(e_lon, e_lat) * dist[:, None]).astype(np.float32), meta


def disc_fraction(d, r):
    """Share of a disc of radius r whose centre stands d above a straight horizon line."""
    x = np.clip(d / r, -1.0, 1.0)
    return 0.5 + (x * np.sqrt(1.0 - x * x) + np.arcsin(x)) / np.pi


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--year", type=int, default=2027)
    ap.add_argument("--out", default=str(ROOT / "data" / "exposure"))
    ap.add_argument("--rows", type=int, default=360, help="rows of the maps; columns are twice as many")
    args = ap.parse_args()
    t_start = time.time()

    gmeta, z = load_globe()
    sun, earth, sky_meta = load_sky(args.year)
    rows, cols = args.rows, 2 * args.rows
    cell = 180.0 / rows
    lat = 90.0 - (np.arange(rows) + 0.5) * cell
    lon = -180.0 + (np.arange(cols) + 0.5) * cell
    lon_g, lat_g = np.meshgrid(lon, lat)
    la, lo = np.radians(lat_g), np.radians(lon_g)
    up = np.stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)], axis=-1)
    east = np.stack([-np.sin(lo), np.cos(lo), np.zeros_like(lo)], axis=-1)
    north = np.stack([-np.sin(la) * np.cos(lo), -np.sin(la) * np.sin(lo), np.cos(la)], axis=-1)
    z0 = sample_globe(gmeta, z, lat_g, lon_g)
    r0 = R_KM + (z0 + RECEIVER_M) / 1000.0

    # --- horizon of every cell, N_AZ directions ---------------------------------------------
    grid_km = gmeta["cell_deg"] * np.pi / 180.0 * R_KM
    dists = np.arange(2.0 * grid_km, REACH_KM, grid_km)
    horizon = np.full((N_AZ, rows, cols), -np.inf, dtype=np.float32)
    print(f"Horizons: {rows} x {cols} cells, {N_AZ} directions, {len(dists)} steps of {grid_km:.1f} km ...")
    for a in range(N_AZ):
        az = np.radians(a * 360.0 / N_AZ)
        t = np.sin(az) * east + np.cos(az) * north           # horizontal direction of the ray
        best = horizon[a]
        for d in dists:
            g = d / R_KM
            p = np.cos(g) * up + np.sin(g) * t                 # point on the great circle
            zq = sample_globe(gmeta, z, np.degrees(np.arcsin(np.clip(p[..., 2], -1, 1))), np.degrees(np.arctan2(p[..., 1], p[..., 0])))
            rq = R_KM + zq / 1000.0
            np.maximum(best, ((rq * np.cos(g) - r0) / (rq * np.sin(g))).astype(np.float32), out=best)
    horizon = np.degrees(np.arctan(horizon))
    print(f"  done in {time.time() - t_start:.0f} s")

    # --- the year, row by row -----------------------------------------------------------------
    sun_map = np.zeros((rows, cols), dtype=np.float32)
    earth_map = np.zeros((rows, cols), dtype=np.float32)
    col_idx = np.arange(cols)[:, None]
    step = 360.0 / N_AZ

    def horizon_at(r, az):                                    # linear between the directions
        f = az / step
        i0 = np.floor(f).astype(np.int32) % N_AZ
        w = (f - np.floor(f)).astype(np.float32)
        return horizon[i0, r, col_idx] * (1 - w) + horizon[(i0 + 1) % N_AZ, r, col_idx] * w

    print(f"Year {args.year}: {sun.shape[0]} time steps ...")
    for r in range(rows):
        u, e, n = up[r].astype(np.float32), east[r].astype(np.float32), north[r].astype(np.float32)
        s_el = np.degrees(np.arcsin(np.clip(u @ sun.T, -1, 1)))
        s_az = np.degrees(np.arctan2(e @ sun.T, n @ sun.T)) % 360.0
        sun_map[r] = disc_fraction(s_el - horizon_at(r, s_az), SUN_R_DEG).mean(axis=1)
        to_e = earth[None, :, :] - (u * r0[r][:, None].astype(np.float32))[:, None, :]       # from the cell itself
        dist = np.linalg.norm(to_e, axis=2)
        e_el = np.degrees(np.arcsin(np.clip(np.einsum("ck,ctk->ct", u, to_e) / dist, -1, 1)))
        e_az = np.degrees(np.arctan2(np.einsum("ck,ctk->ct", e, to_e), np.einsum("ck,ctk->ct", n, to_e))) % 360.0
        earth_map[r] = disc_fraction(e_el - horizon_at(r, e_az), np.degrees(np.arcsin(EARTH_R_KM / dist))).mean(axis=1)
        if r % 60 == 59:
            print(f"  row {r + 1} of {rows}, {time.time() - t_start:.0f} s")

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    layers = []
    for name, grid, title in (("sunlight", sun_map, "Mean sunlight"), ("earth", earth_map, "Earth in view")):
        blob = np.round(np.clip(grid, 0, 1) * 255.0).astype(np.uint8).tobytes()
        fname = f"{name}_{args.year}_{cols}x{rows}.bin"
        (out / fname).write_bytes(blob)
        layers.append({
            "name": name, "title": title, "file": fname, "width": cols, "height": rows, "year": args.year,
            "dtype": "uint8, value / 255 = share of the disc in view, averaged over the year",
            "note": f"{args.year}, every second hour. Ground: LOLA global grid, 7.6 km cells; features under 15 km are not resolved.",
            "mean": round(float(grid.mean()), 4), "sha256": hashlib.sha256(blob).hexdigest(),
        })
        print(f"Wrote {out / fname}: mean {grid.mean():.3f}, min {grid.min():.3f}, max {grid.max():.3f}")
    index = {
        "description": "Global maps: time-averaged visible share of the Sun's and of the Earth's disc above the terrain horizon.",
        "layout": "row 0 = northernmost, column 0 = westernmost (longitude -180 deg); values at cell centres",
        "cell_deg": cell,
        "frame": "MOON_ME (mean Earth / polar axis, DE421), east longitude positive",
        "method": {
            "horizon": f"{N_AZ} directions per cell, from {dists[0]:.1f} km to {REACH_KM:g} km every {grid_km:.1f} km, observer {RECEIVER_M:g} m above the ground, exact spherical geometry",
            "visible": "area of the disc above a straight horizon line at the azimuth of the disc centre; Sun radius 0.2666 deg; Earth radius from its distance, seen from the cell",
            "time": f"every second hour of {args.year} ({sun.shape[0]} steps)",
            "script": "tools/build_exposure.py",
        },
        "sources": {
            "terrain": "data/globe/ldem_me_1440x720.bin (LOLA LDEM64, area means on 0.25 deg cells)",
            "sky": f"expiry-date/data/{sky_meta['file']} (NASA JPL Horizons, {sky_meta.get('ephemeris', 'DE441')})",
        },
        "limits": "The ground is only as fine as the grid (7.6 km cells). Small permanently shadowed craters and lit rims near the poles are not resolved.",
        "generated_utc": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "ai_note": "Prepared with AI assistance (Claude, Anthropic).",
        "layers": layers,
    }
    (out / "index.json").write_text(json.dumps(index, indent=1) + "\n", encoding="utf-8")
    print(f"Done in {time.time() - t_start:.0f} s")


if __name__ == "__main__":
    main()
