#!/usr/bin/env python3
"""Check of the frame conversion MOON_ME -> MOON_PA used for the global LOLA raster.

LDEM64_PA is in MOON_PA; the LOLA 80 m south-pole model (LDEM_80S_80MPP_ADJ.TIF, PGDA product 90) is in
MOON_ME. The same ground must have the same height in both. This script takes random points between
82 and 89.5 deg S, reads the 80 m model there (averaged to the pixel size of LDEM64) and compares it with
LDEM64 read three ways: with the conversion of tools/lunar.py, without any conversion, and with the
inverse conversion. The right conversion gives the smallest difference.

  python tools/check_frames.py [--ldem PATH] [--polar PATH] [--points 20000]

Needs numpy and rasterio. Exit code 1 if the conversion in lunar.py is not the best of the three.
"""
import argparse
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lunar  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


def load_polar(path: Path, factor: int):
    """The polar model reduced by `factor` (area mean), with what is needed to look points up in it."""
    import rasterio
    from rasterio.enums import Resampling

    with rasterio.open(path) as ds:
        rows, cols = ds.height // factor, ds.width // factor
        grid = ds.read(1, out_shape=(rows, cols), resampling=Resampling.average).astype(np.float64)
        if ds.nodata is not None:
            grid[np.isclose(grid, ds.nodata)] = np.nan
        left, top = ds.bounds.left, ds.bounds.top
        res_x = (ds.bounds.right - ds.bounds.left) / cols
        res_y = (ds.bounds.top - ds.bounds.bottom) / rows
    return grid, left, top, res_x, res_y


def sample_polar(polar, lat_deg, lon_deg):
    """Bilinear height from the south polar stereographic grid (LOLA convention: x = rho sin lon, y = rho cos lon)."""
    grid, left, top, res_x, res_y = polar
    colat = np.radians(90.0 + lat_deg)
    rho = 2.0 * lunar.MOON_RADIUS_M * np.tan(colat / 2.0)
    lon = np.radians(lon_deg)
    fx = (rho * np.sin(lon) - left) / res_x - 0.5
    fy = (top - rho * np.cos(lon)) / res_y - 0.5
    h, w = grid.shape
    ok = (fx >= 0) & (fx <= w - 1.001) & (fy >= 0) & (fy <= h - 1.001)
    fx, fy = np.clip(fx, 0, w - 1.001), np.clip(fy, 0, h - 1.001)
    x0, y0 = fx.astype(np.int64), fy.astype(np.int64)
    tx, ty = fx - x0, fy - y0
    z = (grid[y0, x0] * (1 - tx) * (1 - ty) + grid[y0, x0 + 1] * tx * (1 - ty)
         + grid[y0 + 1, x0] * (1 - tx) * ty + grid[y0 + 1, x0 + 1] * tx * ty)
    return z, ok & np.isfinite(z)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--ldem", help="global raster (default: LDEM64_PA_pixel_202405.tif in the repo folder)")
    ap.add_argument("--polar", default=str(ROOT / "expiry-date" / "data" / "raw" / "LDEM_80S_80MPP_ADJ.TIF"))
    ap.add_argument("--points", type=int, default=20000)
    args = ap.parse_args()

    ldem_path = lunar.find_ldem(ROOT, args.ldem)
    if ldem_path is None:
        sys.exit(f"Global raster not found. Download: {lunar.LDEM_URL}")
    if not Path(args.polar).exists():
        sys.exit(f"Polar model not found: {args.polar} (expiry-date/data/raw/download_data.bat fetches it)")

    raw = lunar.Ldem(ldem_path, frame="ME")              # frame="ME": no conversion inside sample()
    factor = max(1, int(round(raw.cell_m / 80.0)))       # 80 m pixels -> about the pixel size of the global raster
    polar = load_polar(Path(args.polar), factor)
    print(f"{raw.describe().replace('MOON_ME', 'as stored')}")
    print(f"{Path(args.polar).name}: averaged {factor} x {factor} pixels to {80 * factor} m")

    rng = np.random.default_rng(20261115)
    lat = -82.0 - 7.5 * rng.random(args.points)          # 82 .. 89.5 deg S
    lon = 360.0 * rng.random(args.points)
    z_ref, ok = sample_polar(polar, lat, lon)

    variants = {
        "MOON_ME -> MOON_PA (lunar.py)": lunar.me_to_pa(lat, lon),
        "no conversion": (lat, lon),
        "inverse conversion": lunar.pa_to_me(lat, lon),
    }
    rms = {}
    print(f"\n{int(ok.sum())} points, 82-89.5 deg S. Height in LDEM64 minus height in the 80 m model:")
    for name, (la, lo) in variants.items():
        d = (raw.sample(la, lo) - z_ref)[ok]
        rms[name] = float(np.sqrt(np.mean(d * d)))
        print(f"  {name:32s} RMS {rms[name]:7.1f} m   mean {d.mean():+6.1f} m   median |d| {np.median(np.abs(d)):6.1f} m")
    best = min(rms, key=rms.get)
    print(f"\nSmallest difference: {best}")
    if best != "MOON_ME -> MOON_PA (lunar.py)":
        sys.exit(1)


if __name__ == "__main__":
    main()
