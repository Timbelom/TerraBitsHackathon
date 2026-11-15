# Expiry Date – compare Moon landing sites before the light runs out

*Every landing site has an expiry date.* A tool for the NASA Space Apps 2026 challenge **Lunar Landing Site Navigator**.

Pick up to three sites and a landing date. For each site a strip shows which launch delays (0–30 days) still leave enough
sunlight and Earth contact for the whole mission (green) and which do not (red). The label gives the first red day,
e.g. "survives 6 days of delay". The sky view shows Sun and Earth against the horizon, with the real terrain silhouette at the two south-pole sites.

## Run it

The page loads data files, so it cannot be opened by double-click.

- Windows: double-click `start.bat` (needs Python), then open http://localhost:8080/
- Any system: `python -m http.server 8080` in this folder, then open http://localhost:8080/
- GitHub Pages: publish this folder; it needs no server code.

The start date in the app (2028-07-07) is an example where the two south-pole sites differ (`tools/scan_dates.js`).
Landing dates from 2027-01-01 to 2066-11-02 work: the 60-day window must lie inside the Horizons data.

## What is in the folder

| Path | What |
| --- | --- |
| `index.html`, `app.js` | The interface (Compare view) |
| `core.js` | The computation, shared by browser and Node |
| `data/sky_2027_2066.bin` + `sky_meta.json` | Hourly sub-Earth and sub-solar point and Earth distance from JPL Horizons, 2027-2066 (7 MB) |
| `data/horizon_site01.json`, `horizon_site04.json` | Horizon profiles (360 azimuths: angle, obstacle distance, sigma) for the two south-pole sites |
| `data/sites.json` | Curated site list with a source link for every coordinate |
| `data/raw/` | Raw downloads (not in git) and `download_data.bat` that fetches them |
| `tools/` | Scripts that build the data files and check them |
| `tests/` | `node --test tests/core.test.js` (10 tests), `tests/ui_smoke.js` (needs jsdom) |
| `docs/validation_sky.md` | Comparison with Horizons at 18 points |

## Data and sources

- **Sky:** NASA JPL Horizons API (DE441), Moon target, sub-observer and sub-solar points, hourly, Mean-Earth/Polar-Axis frame. https://ssd.jpl.nasa.gov/horizons/
- **Terrain:** NASA PGDA LOLA products: 5 m site DEMs with height uncertainty for Site01 "Connecting ridge" and Site04 "Shackleton rim" (https://pgda.gsfc.nasa.gov/products/78), and the 80 m south-pole DEM 80-90 deg S for the far field (https://pgda.gsfc.nasa.gov/products/90). Cite Barker et al., 2023, Planetary Science Journal 4, 183.
- **Coordinates of other sites:** NASA NSSDCA, https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_sites.html (Apollo) and https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_artifact_impacts.html (others). These are landed positions.

## Method in short

1. **Direction of Sun and Earth** from the Horizons sub-points: elevation and azimuth at the site from the vector site → body. The Earth is at its real distance (parallax up to 0.26 deg); the Sun is at infinity. Discs: Sun 0.53 deg, Earth from its distance (about 1.9 deg).
2. **Horizon:** smooth 0 deg for sites without terrain. For the two terrain sites: rays every 0.25 deg from the target, exact spherical geometry including curvature, 5 m DEM near, 80 m DEM far (to 285 km); the profile is the maximum over each azimuth +-0.5 deg. Target point = highest point of the 5 m raster, at least 1 km from its edge, receiver 2 m above ground.
3. **Visibility** per hour: fraction of each disc above the horizon at its azimuth.
4. **Rule:** a landing day is green if, during the mission, the longest phase with less than 50 % of the Sun disc visible is at most D hours and the same for the Earth disc at most G hours. Presets: short lander 10 days, D = 6 h, G = 12 h; long stay 30 days, D = G = 48 h. D and G are **team assumptions**, adjustable in the app.
5. **Range at terrain sites:** the horizon is evaluated at -1, 0 and +1 sigma (LOLA height uncertainty of obstacle and target, divided by the distance of the obstacle).

## Checks

- Sky against Horizons observer tables: 3 sites (south pole, 45 N, equator) x 3 dates x Sun and Earth. Worst angular difference **0.0054 deg** (target 0.1 deg). `node tools/verify_sky.js`
- Terrain frame: with the file's polar-stereographic convention the Shoemaker crater floor lies at -3.9 km in the 80 m DEM (mirrored longitude: -1.4 km), and the lowest point near the pole sits at 119 deg E, the Shackleton floor.
- Step size: dense 5 m sampling instead of 5/10/40 m changes the horizon by at most 0.00014 deg (recorded in each horizon file).
- Not done yet: comparison of the terrain results with dated LROC images or QuickMap illumination.

## Assumptions and limits

- The terrain result is a **point value at one target point**, not a landing-ellipse value. Roughly 90 % of the 5 m pixels are interpolated.
- No error raster for the 80 m far field was loaded: an assumed 3 m is used there. Sigma uses a 100 m distance floor because errors of adjacent pixels are strongly correlated. Both are in `build_horizon.py` and in each horizon file.
- Sites without terrain data: smooth horizon, so a label is only an approximation; poleward of 80 deg (`POLAR_LAT` in `core.js`) only an upper bound without a day count.
- The disc fraction uses a straight horizon line at the azimuth of the disc centre. Hourly sampling. No refraction (no atmosphere). Aberration (<= 0.006 deg) and the Sun's parallax (0.0007 deg) are not modelled.
- Earth in view is not ground-station availability. Nothing here says anything about temperature.
- Horizons uses DE441, the LOLA products DE421; the difference is far below the 0.0054 deg measured above.

## Rebuild the data

```
data\raw\download_data.bat          (downloads about 380 MB)
python tools/build_sky.py           (numpy)
python tools/build_horizon.py       (numpy, rasterio)
node tools/verify_sky.js
node --test tests/core.test.js
```

## Use of AI

The code, the data-preparation scripts and this text were written with AI assistance (Claude, Anthropic). NASA data are repacked without change except float32 rounding. The results were checked with the tests listed above; the assumptions marked as team assumptions are decisions for the team, not facts about the Moon.
