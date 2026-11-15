# TerraBits: Lunar Landing Site Navigator

A tool for the NASA Space Apps 2026 challenge **Lunar Landing Site Navigator**. It shows where the Sun and
the Earth stand above the real terrain horizon of any point on the Moon, for how long, and how that changes
with the date: sunlight for power, Earth in view for direct radio contact.

- **System view:** the Moon as a relief mesh from NASA LOLA topography, with the Sun and the Earth where JPL
  Horizons has them. One clock moves everything. Click the Moon to mark a point.
- **Info card** per marked point: elevation of the Sun and the Earth, height of the horizon in that direction,
  visible share of each disc, time to the next rise or set, and for the chosen time span the share of hours
  in view and the longest darkness and longest outage of direct-to-Earth contact, compared with two limits.
- **Terrain view** ("View terrain" on a card): the ground 200 x 200 km around the point in true proportions,
  lit and shadowed by the Sun as it stands there, with values for the point under the pointer.
- **Surfaces and layers:** relief with shadows, imagery, elevation, mean sunlight and Earth visibility of a
  year; latitude/longitude grid, contour lines, 200 km squares.

Every number names what it rests on: the sky source and the ground (5 m site profile, LDEM64 block, global
grid or smooth sphere).

## Run it

The page loads data files, so it cannot be opened by double-click.

- **Windows:** double-click `start.bat` (needs Python 3.10 or newer). It opens http://127.0.0.1:8080/.
- **Any system:** `python tools/serve.py --open`
- **Static hosting (GitHub Pages):** publish the repo folder; no server code is needed. The listed landing
  sites open in full resolution from `data/terrain/`; other points show coarse ground and say so.

Terrain in full resolution **for any point** needs the local server with `numpy`, `rasterio` and the global
LOLA raster in the repo folder:

```
pip install numpy rasterio
```

Download [LDEM64_PA_pixel_202405.tif](https://pgda.gsfc.nasa.gov/data/LOLA_PA/LDEM64_PA_pixel_202405.tif)
(715 MB) into the repo folder. It is not in the repository (`.gitignore`).

`?detail=light` behind the address starts with a lighter Moon mesh (a quarter of the triangles, smaller
shadow map). Without it the page always draws the full mesh.

Shadows on the Moon of the system view come from a skyline map (`data/globe/horizon_720x360x24.bin`, written by
`node tools/build_horizon.mjs` from the global grid): the terrain horizon for every node of a 0.5 deg grid in 24
azimuths. The page compares the Sun's elevation with it. The terrain view keeps its shadow map at the full
resolution of the block. On both, relief shading (`view/relief.js`) darkens steep ground as a display aid; it
depends on the heights only and no number of the page uses it.

## What is in the folder

| Path | What |
| --- | --- |
| `index.html`, `landing*.js`, `landing*.css`, `tokens.css` | The page: system view, sidebar, markers, search, info cards, time series |
| `core/` | The calculation, no page and no three.js, runs in the browser and in Node: `frames.js` coordinates, `sky.js` Sun and Earth, `terrain.js` grid and terrain blocks, `visibility.js` horizon, disc fraction, span metrics |
| `view/` | three.js scenes: `moon-globe.js` the Moon with its surfaces and layers, `terrain-view.js` the terrain view, `colors.js` colour scales |
| `ui/site-data.js` | Which ground is known for each marked point |
| `lunar-sky.js` | Analytic sky model: fallback outside 2027-2066, and the Moon's orientation among the stars |
| `data/globe/` | Global height grid, 0.25 deg cells, MOON_ME (2 MB) |
| `data/terrain/` | Terrain blocks for the nine listed sites (1.5 MB each) and `index.json` |
| `data/exposure/` | Mean sunlight and Earth visibility 2027, 0.5 deg cells |
| `expiry-date/` | The Expiry Date comparison tool; its `data/` holds the Horizons table, the site list and the two 5 m site profiles that this page uses too |
| `tools/` | Python: `serve.py` local server, `build_globe.py`, `build_terrain.py`, `build_exposure.py` data files, `check_frames.py` frame check, `lunar.py` shared geometry and the terrain block format |
| `tests/` | `node --test` (also runs the Expiry Date tests) |
| `vendor/three@0.169.0/` | three.js, so the page needs no CDN |
| `global_viewer.py`, `slice.py`, `lunar_global_tiered_3d.html`, `mond_3d_linear_viewer.html` | The earlier stand-alone 3D viewer. Its globe, terrain view and tile logic now live in `view/`, `core/` and `tools/`; kept for reference |
| `globe.html`, `terrain.html`, `explore.html` and their scripts | Earlier pages, no longer linked |

## Data and sources

- **Sky:** NASA JPL Horizons API (DE441): hourly sub-solar and sub-Earth point and Earth distance,
  2027-01-01 to 2067-01-01 UTC, frame MOON_ME (`expiry-date/data/sky_2027_2066.bin`,
  https://ssd.jpl.nasa.gov/horizons/). Outside those years the page uses the analytic model of
  `lunar-sky.js` and says so.
- **Terrain, whole Moon:** NASA PGDA, LOLA MOON_PA gridded dataset, 64 px/deg (474 m per pixel north-south),
  https://pgda.gsfc.nasa.gov/products/95
- **Terrain, the two south-pole sites:** NASA PGDA LOLA 5 m site DEMs (https://pgda.gsfc.nasa.gov/products/78)
  and the 80 m south-pole DEM (https://pgda.gsfc.nasa.gov/products/90), as horizon profiles from Expiry Date.
  Cite Barker et al., 2023, Planetary Science Journal 4, 183.
- **Site coordinates:** NASA NSSDCA (links per site in `expiry-date/data/sites.json`).
- **Imagery:** NASA SVS CGI Moon Kit (LROC WAC mosaic). **Sun:** NASA/SDO and the AIA, EVE, and HMI science
  teams. **Stars:** Yale Bright Star Catalogue.

## Method in short

1. **One frame.** Everything the page shows is in MOON_ME (mean Earth / polar axis), the frame of Horizons and
   of the usual lunar coordinates. The global LOLA raster is in MOON_PA; every lookup in it goes through the
   constant rotation of the NAIF kernel `moon_080317.tf` (67.92, 78.56, 0.30 arcsec about axes 3, 2, 1; up to
   875 m on the ground). `tools/check_frames.py` checks the direction against the LOLA 80 m polar model, which
   is in MOON_ME.
2. **Direction of Sun and Earth** from the Horizons sub-points, linear between the hours. The Earth is taken
   from the site itself (parallax up to 0.26 deg), the Sun from the Moon's centre.
3. **Horizon of a point:** 360 values, one per degree of azimuth. Rays every 0.25 deg along great circles,
   exact spherical geometry including curvature, observer 2 m above the ground; each value is the maximum over
   +-0.5 deg. From a terrain block the trace starts two source pixels out (0.95 km): closer ground is not
   resolved by the raster. Best ground first: 5 m site profile, LDEM64 block (474 m pixels, far field in 1 km
   steps to 300 km), global grid (7.6 km cells), smooth sphere.
4. **Visible:** the area of the Sun's or the Earth's disc above a straight horizon line at the azimuth of the
   disc centre. Sun radius 0.2666 deg, Earth radius from its distance. A body counts as in view from 50 %.
5. **Span metrics:** hourly samples over the time span; the moment a disc passes 50 % is interpolated between
   two samples. Longest darkness and longest DTE outage are the longest stretches below 50 %.
6. **Terrain view:** every grid point is placed in 3D on the sphere, so curvature is in the picture; heights are
   not exaggerated. The far field is not drawn but casts shadows. Light is switched off only below -4.6 deg of
   solar elevation, where the Sun would shine in under the edge of the far-field data.

## Checks

Run `node --test` (22 checks, Node 20 or newer, no packages) and, with the rasters present,
`python tools/check_frames.py`.

- Sky against JPL Horizons observer tables at three sites and three dates, Sun and Earth: within 0.1 deg
  (worst 0.0054 deg).
- Frame conversion: heights of LDEM64 against the LOLA 80 m polar model at 20,000 points between 82 and
  89.5 deg S: RMS 5.7 m with the conversion, 91 m without it, 177 m with the inverse.
- Same disc fractions as the Expiry Date calculation at a terrain site (difference below 0.0001).
- Horizon at Connecting ridge from the LDEM64 block against the 5 m profile: mean difference 0.32 deg, largest
  1.6 deg; over 2027 Earth in view 50.8 % against 50.8 %, Sun in view 91.0 % against 87.9 %.
- The earlier viewer's Horizons values for 2027 against the table used here, all 8,761 hours: Sun within
  0.068 deg, Earth within 0.062 deg.
- Not done: comparison of rendered shadows with dated LROC images or QuickMap illumination; frame rate on a
  range of graphics hardware.

## Assumptions and limits

- Results are **point values**. On a polar ridge a few hundred metres change the answer: at Connecting ridge
  the LDEM64 block gives 99 h of longest darkness in 2027, the 5 m profile 246 h. For such sites the 5 m
  profiles are the reference; an LDEM64 result there is an estimate, and the card says which ground it used.
- LDEM64 has 474 m pixels; a block samples it every 391 m. Ground closer than 0.95 km is taken as open.
- The far field reaches 300 km. Ground beyond that would have to stand more than 26 km above the site to
  reach the site's horizontal, which nothing on the Moon does; ground that only narrows a horizon lying below
  the horizontal (as seen from a summit) is missed beyond 300 km.
- The global maps of sunlight and Earth visibility use 7.6 km cells: small permanently shadowed craters and
  lit rims are not resolved.
- Sun and Earth are drawn three times their true angular size, in both views; all numbers use the true sizes.
- Earth in view is not ground-station availability. Nothing here says anything about temperature.
- No refraction (no atmosphere). Aberration (up to 0.006 deg) is not modelled.
- The 200 km squares are a browsing layer. They leave gaps towards the poles (0.12 % of the surface, both
  poles included), which is why terrain is cut around the marked point, not around a square.

## Rebuild the data

```
python tools/build_globe.py        data/globe/      (needs the LOLA raster, about 10 s)
python tools/build_terrain.py      data/terrain/    (needs the LOLA raster, about 15 s)
python tools/build_exposure.py     data/exposure/   (numpy only, about 3 min)
python tools/check_frames.py                        (needs both rasters)
node --test
```

The Horizons table and the 5 m site profiles are rebuilt with the scripts in `expiry-date/tools/`.

## Use of AI

The code, the data-preparation scripts and this text were written with AI assistance (Claude, Anthropic).
NASA data are resampled, averaged and repacked as described above, not otherwise changed. The results were
checked with the tests listed; assumptions marked as such are decisions of the team, not facts about the Moon.
