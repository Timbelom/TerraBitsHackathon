#!/usr/bin/env python3
"""Terrain blocks for the listed landing sites: data/terrain/<id>.bin + data/terrain/index.json.

These files let the page open "View terrain" for the listed sites without the local server, e.g. on
GitHub Pages. Each block holds the ground around one site (MOON_ME): 640 x 640 heights over 250 km and a
coarse grid out to 300 km, both read from LOLA LDEM64 (format: tools/lunar.py, reader: core/terrain.js).

  python tools/build_terrain.py [--ldem PATH] [--sites expiry-date/data/sites.json] [--out data/terrain]

Needs numpy and rasterio. About 1.5 MB and a few seconds per site.
"""
import argparse
import datetime as dt
import hashlib
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lunar  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--ldem", help="global raster (default: LDEM64_PA_pixel_202405.tif in the repo folder)")
    ap.add_argument("--sites", default=str(ROOT / "expiry-date" / "data" / "sites.json"))
    ap.add_argument("--out", default=str(ROOT / "data" / "terrain"))
    args = ap.parse_args()

    path = lunar.find_ldem(ROOT, args.ldem)
    if path is None:
        sys.exit(f"Global raster not found. Put it into the repo folder or pass --ldem. Download: {lunar.LDEM_URL}")
    ldem = lunar.Ldem(path)
    print(ldem.describe())
    sites = json.loads(Path(args.sites).read_text(encoding="utf-8"))["sites"]
    # The landing spot of the guided demo (landing-demo.js): a free point, not a listed site. Its block is built
    # here too so that the demo shows the same ground and the same numbers without the local server.
    sites = sites + [{"id": "demo", "name": "Landing spot of the guided demo (free point, plain 32 km from the south pole)",
                      "lat": -88.9481, "lon": 75.048}]
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    entries = []
    for s in sites:
        t0 = time.time()
        blob = lunar.build_block(ldem, s["lat"], s["lon"])
        name = f"{s['id']}.bin"
        (out / name).write_bytes(blob)
        entries.append({"id": s["id"], "name": s["name"], "lat": s["lat"], "lon": s["lon"] % 360.0,
                        "file": name, "bytes": len(blob), "sha256": hashlib.sha256(blob).hexdigest()})
        print(f"  {s['id']:5s} {s['name']:28s} {len(blob) / 1e6:.2f} MB  {time.time() - t0:.1f} s")

    index = {
        "description": "Terrain blocks around the listed landing sites, for 'View terrain' without the local server.",
        "format": {
            "magic": lunar.BLOCK_MAGIC.decode(), "version": lunar.BLOCK_VERSION, "header_bytes": lunar.BLOCK_HEADER_BYTES,
            "near": f"{lunar.BLOCK_RES} x {lunar.BLOCK_RES} uint16 over {lunar.BLOCK_FULL_KM:g} km "
                    f"({lunar.BLOCK_FULL_KM / (lunar.BLOCK_RES - 1) * 1000:.0f} m apart); the inner {lunar.BLOCK_VISIBLE_KM:g} km are shown",
            "far": f"{lunar.FAR_RES} x {lunar.FAR_RES} uint16, {lunar.FAR_STEP_KM:g} km apart, out to {lunar.FAR_HALF_KM:g} km from the site",
            "layout": "local map of the site: x east, y north, distances along the surface; row 0 = north, column 0 = west",
            "definition": "tools/lunar.py",
        },
        "frame": "MOON_ME (mean Earth / polar axis, DE421), east longitude positive",
        "height_reference": "metres above the sphere of 1737.4 km",
        "source": {
            "file": path.name,
            "product": "LOLA MOON_PA gridded dataset, 64 px/deg (NASA PGDA)",
            "url": lunar.LDEM_URL,
            "pixel_m_north_south": round(ldem.cell_m, 1),
            "frame": f"MOON_{ldem.frame}",
        },
        "generated_utc": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "ai_note": "Prepared with AI assistance (Claude, Anthropic). NASA data, resampled as described.",
        "blocks": entries,
    }
    (out / "index.json").write_text(json.dumps(index, indent=1) + "\n", encoding="utf-8")
    print(f"Wrote {len(entries)} blocks and index.json to {out}")


if __name__ == "__main__":
    main()
