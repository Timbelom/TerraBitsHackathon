#!/usr/bin/env python3
"""Global height grid for the web page: data/globe/ldem_me_1440x720.bin + .json.

Source: LOLA LDEM64_PA (64 px/deg, MOON_PA). Output: 0.25 deg cells in MOON_ME, each the area mean of the
source pixels it covers (16 x 16), stored as int16 in steps of 0.5 m. Row 0 is the northernmost row,
column 0 starts at longitude -180 deg; values sit at cell centres.

  python tools/build_globe.py [--ldem PATH] [--out data/globe] [--rows 720]

Needs numpy and rasterio. Takes about a minute (the whole 715 MB raster is read once).
"""
import argparse
import datetime as dt
import hashlib
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lunar  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
HEIGHT_STEP_M = 0.5


def bilinear_wrap(grid, row_f, col_f):
    """Bilinear lookup in a global grid: rows clamp at the poles, columns wrap around."""
    rows, cols = grid.shape
    row_f = np.clip(row_f, 0.0, rows - 1.0)
    r0 = np.minimum(np.floor(row_f).astype(np.int64), rows - 2)
    c0 = np.floor(col_f).astype(np.int64)
    fr, fc = row_f - r0, col_f - c0
    c0 %= cols
    c1 = (c0 + 1) % cols
    return ((grid[r0, c0] * (1 - fc) + grid[r0, c1] * fc) * (1 - fr)
            + (grid[r0 + 1, c0] * (1 - fc) + grid[r0 + 1, c1] * fc) * fr)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--ldem", help="global raster (default: LDEM64_PA_pixel_202405.tif in the repo folder)")
    ap.add_argument("--out", default=str(ROOT / "data" / "globe"))
    ap.add_argument("--rows", type=int, default=720, help="rows of the output grid; columns are twice as many")
    args = ap.parse_args()

    path = lunar.find_ldem(ROOT, args.ldem)
    if path is None:
        sys.exit(f"Global raster not found. Put it into the repo folder or pass --ldem. Download: {lunar.LDEM_URL}")
    ldem = lunar.Ldem(path)
    rows, cols = args.rows, 2 * args.rows
    if ldem.height % rows or ldem.width % cols:
        sys.exit(f"{rows} x {cols} does not divide the raster ({ldem.height} x {ldem.width}) evenly")
    print(ldem.describe())
    print(f"Averaging to {rows} x {cols} ...")
    src = ldem.decimated(rows, cols)                       # in the raster's own frame
    if not np.isfinite(src).all():
        src = np.where(np.isfinite(src), src, np.nanmin(src))

    # centres of the averaged cells in the source frame
    step_r, step_c = ldem.height // rows, ldem.width // cols
    src_lat0 = ldem.lat_row0 + (0.5 * step_r - 0.5) * ldem.deg_per_row
    src_lon0 = ldem.lon_col0 + (0.5 * step_c - 0.5) * ldem.deg_per_col
    src_dlat, src_dlon = ldem.deg_per_row * step_r, ldem.deg_per_col * step_c

    cell = 180.0 / rows
    lat = 90.0 - (np.arange(rows) + 0.5) * cell
    lon = -180.0 + (np.arange(cols) + 0.5) * cell
    lon_grid, lat_grid = np.meshgrid(lon, lat)
    if ldem.frame == "PA":
        s_lat, s_lon = lunar.me_to_pa(lat_grid, lon_grid)
    else:
        s_lat, s_lon = lat_grid, lon_grid
    z = bilinear_wrap(src, (s_lat - src_lat0) / src_dlat, (s_lon - src_lon0) / src_dlon)

    q = np.round(z / HEIGHT_STEP_M)
    if np.abs(q).max() > 32767:
        sys.exit("heights do not fit into int16 at this step")
    blob = q.astype("<i2").tobytes()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    name = f"ldem_me_{cols}x{rows}"
    (out / f"{name}.bin").write_bytes(blob)
    meta = {
        "file": f"{name}.bin",
        "description": "Global lunar topography, area means of LOLA LDEM64 on a 0.25 deg grid.",
        "width": cols,
        "height": rows,
        "cell_deg": cell,
        "cell_km_at_equator": round(cell * np.pi / 180.0 * lunar.MOON_RADIUS_KM, 3),
        "lat_first_center_deg": float(lat[0]),
        "lon_first_center_deg": float(lon[0]),
        "layout": "row 0 = northernmost, column 0 = westernmost (longitude -180 deg); values at cell centres",
        "dtype": "int16 little-endian",
        "height_step_m": HEIGHT_STEP_M,
        "height_reference": "metres above the sphere of 1737.4 km",
        "frame": "MOON_ME (mean Earth / polar axis, DE421), east longitude positive",
        "min_m": float(q.min() * HEIGHT_STEP_M),
        "max_m": float(q.max() * HEIGHT_STEP_M),
        "source": {
            "file": path.name,
            "product": "LOLA MOON_PA gridded dataset, 64 px/deg (NASA PGDA)",
            "url": lunar.LDEM_URL,
            "frame": f"MOON_{ldem.frame}",
            "conversion": "MOON_ME -> MOON_PA by the constant rotation of the NAIF kernel moon_080317.tf "
                          "(67.92, 78.56, 0.30 arcsec about axes 3, 2, 1); checked by tools/check_frames.py",
        },
        "generated_utc": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "sha256": hashlib.sha256(blob).hexdigest(),
        "ai_note": "Prepared with AI assistance (Claude, Anthropic). NASA data, averaged and resampled as described.",
    }
    (out / f"{name}.json").write_text(json.dumps(meta, indent=1) + "\n", encoding="utf-8")
    print(f"Wrote {out / (name + '.bin')} ({len(blob) / 1e6:.1f} MB), heights {meta['min_m']:.1f} .. {meta['max_m']:.1f} m")


if __name__ == "__main__":
    main()
