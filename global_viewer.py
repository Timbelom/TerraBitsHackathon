import base64
import json
import math
import re
import urllib.parse
import urllib.request
import webbrowser
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.warp import transform

# ==============================================================================
# 1. CONFIGURATION & MISSION PARAMETERS (TIERED RESOLUTION)
# ==============================================================================
GLOBAL_TIF_CANDIDATES = [
    "LDEM64_PA_pixel_202405 copy.tif",
    "LDEM64_PA_pixel_202405.tif",
]
OUTPUT_HTML = "lunar_global_tiered_3d.html"

MOON_RADIUS_M = 1737400.0       # IAU Mean Lunar Radius in meters
vertical_exaggeration = 1.0     # 1.0 = true 1:1 physical proportions
TARGET_LAT_ROWS = 720           # LIGHTWEIGHT GLOBAL MODEL (720x1440 for fast global rendering)
TILES_PER_CUBE_EDGE = 20        # 6 * 20 * 20 = 2,400 overlapping 200x200 km tiles
TILE_SIZE_KM = 200.0            # Visible square extent: 200 km x 200 km
SHADOW_PAD_KM = 25.0            # +25 km on each side (250x250 km total shadow caster, clipped to 200x200 km)
TILE_GRID_RES = 512             # MAX-DETAIL HIGH-RES MODEL (Loaded ONLY upon clicking a 200x200 km tile)

lunar_geo_crs = "+proj=longlat +R=1737400 +no_defs"

# 1-Year JPL Horizons Simulation Window (8,760 hourly steps)
START_TIME_UTC = "2027-01-01 00:00"
STOP_TIME_UTC = "2028-01-01 00:00"
STEP_SIZE = "1h"


def ask_yes_no(prompt_text: str, default: bool = False) -> bool:
    hint = "[J/n]" if default else "[j/N]"
    while True:
        ans = input(f"{prompt_text} {hint}: ").strip().lower()
        if not ans:
            return default
        if ans in ("j", "ja", "y", "yes", "1"):
            return True
        if ans in ("n", "nein", "no", "0"):
            return False
        print("Bitte 'j' (Ja) oder 'n' (Nein) eingeben.")


# ==============================================================================
# 2. JPL HORIZONS API FETCHER & 3D MOON-FIXED VECTOR CONVERSION
# ==============================================================================
def fetch_jpl_horizons_ephemeris(
    target_id: str,
    lon_deg: float,
    lat_deg: float,
    alt_km: float,
    start_time: str,
    stop_time: str,
    step_size: str = "1h",
):
    lon_east = lon_deg % 360.0
    site_coord = f"{lon_east:.6f},{lat_deg:.6f},{alt_km:.4f}"

    params = {
        "format": "json",
        "COMMAND": f"'{target_id}'",
        "OBJ_DATA": "'NO'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'",
        "CENTER": "'coord@301'",
        "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": f"'{site_coord}'",
        "START_TIME": f"'{start_time}'",
        "STOP_TIME": f"'{stop_time}'",
        "STEP_SIZE": f"'{step_size}'",
        "QUANTITIES": "'4'",
        "CAL_FORMAT": "'CAL'",
        "TIME_DIGITS": "'MINUTES'",
        "ANG_FORMAT": "'DEG'",
        "CSV_FORMAT": "'YES'",
    }

    url = (
        "https://ssd.jpl.nasa.gov/api/horizons.api?"
        + urllib.parse.urlencode(params)
    )
    req = urllib.request.Request(
        url, headers={"User-Agent": "LunarGlobalTiered-JPL/3.0"}
    )

    with urllib.request.urlopen(req, timeout=60) as resp:
        payload = json.loads(resp.read().decode("utf-8"))

    if "error" in payload:
        raise RuntimeError(f"JPL Horizons API Error: {payload['error']}")

    raw_text = payload.get("result", "")
    match = re.search(r"\$\$SOE\s*(.*?)\s*\$\$EOE", raw_text, re.DOTALL)
    if not match:
        raise RuntimeError(
            f"Could not parse $$SOE/$$EOE block from JPL Horizons response:\n{raw_text[:600]}"
        )

    timestamps = []
    azimuths = []
    elevations = []

    for line in match.group(1).strip().splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 5:
            continue
        numeric_vals = []
        for token in parts[1:]:
            try:
                numeric_vals.append(float(token))
                if len(numeric_vals) == 2:
                    break
            except ValueError:
                continue

        if len(numeric_vals) == 2:
            timestamps.append(parts[0])
            azimuths.append(round(numeric_vals[0], 4))
            elevations.append(round(numeric_vals[1], 4))

    return timestamps, azimuths, elevations


def generate_analytical_fallback(
    lon_deg: float, lat_deg: float, start_str: str, hours: int = 8760
):
    dt0 = datetime.strptime(start_str, "%Y-%m-%d %H:%M").replace(
        tzinfo=timezone.utc
    )
    timestamps, sun_az, sun_el, earth_az, earth_el = [], [], [], [], []
    colat = 90.0 - abs(lat_deg)

    for h in range(hours):
        dt = dt0 + timedelta(hours=h)
        timestamps.append(dt.strftime("%Y-%b-%d %H:%M"))
        syn_phase = 2.0 * math.pi * (h / 708.734) + 1.2
        yr_phase = 2.0 * math.pi * (h / 8765.81) - 0.4
        anom_phase = 2.0 * math.pi * (h / 661.31)

        subsolar_lat = 1.543 * math.sin(yr_phase)
        az_s = (math.degrees(syn_phase) + lon_deg) % 360.0
        el_s = colat * math.cos(syn_phase) + subsolar_lat
        sun_az.append(round(az_s, 4))
        sun_el.append(round(el_s, 4))

        lib_lat = 6.68 * math.sin(2.0 * math.pi * (h / 653.07))
        lib_lon = 7.90 * math.sin(anom_phase)
        az_e = (
            360.0
            - lon_deg
            + lib_lon * math.sin(math.radians(abs(lat_deg)))
        ) % 360.0
        el_e = (
            colat * math.cos(math.radians(lon_deg - lib_lon)) + lib_lat
        )
        earth_az.append(round(az_e, 4))
        earth_el.append(round(el_e, 4))

    return timestamps, sun_az, sun_el, earth_az, earth_el


def az_el_to_moon_fixed_dirs(
    lat_deg: float, lon_deg: float, az_list: list, el_list: list
):
    lat = np.radians(lat_deg)
    lon = np.radians(lon_deg)
    az = np.radians(np.asarray(az_list, dtype=np.float64))
    el = np.radians(np.asarray(el_list, dtype=np.float64))

    e_vec = np.array([-np.sin(lon), np.cos(lon), 0.0])
    n_vec = np.array(
        [-np.sin(lat) * np.cos(lon), -np.sin(lat) * np.sin(lon), np.cos(lat)]
    )
    u_vec = np.array(
        [np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)]
    )

    c_el = np.cos(el)
    d_east = c_el * np.sin(az)
    d_north = c_el * np.cos(az)
    d_up = np.sin(el)

    xm = d_east * e_vec[0] + d_north * n_vec[0] + d_up * u_vec[0]
    ym = d_east * e_vec[1] + d_north * n_vec[1] + d_up * u_vec[1]
    zm = d_east * e_vec[2] + d_north * n_vec[2] + d_up * u_vec[2]

    dirs = np.column_stack([xm, ym, zm])
    norms = np.linalg.norm(dirs, axis=1, keepdims=True)
    return np.divide(dirs, np.maximum(norms, 1e-12))


def moon_fixed_to_threejs_list(dirs_moon: np.ndarray):
    three_dirs = np.column_stack([dirs_moon[:, 0], dirs_moon[:, 2], -dirs_moon[:, 1]])
    return np.round(three_dirs, 6).ravel().tolist()


def encode_u16_b64(arr: np.ndarray, vmin: float, vmax: float) -> str:
    span = max(1e-9, float(vmax - vmin))
    norm = np.clip((arr - vmin) / span, 0.0, 1.0)
    u16 = np.round(norm * 65535.0).astype("<u2")
    return base64.b64encode(u16.tobytes()).decode("ascii")


# ==============================================================================
# 3. GLOBAL ANNUAL SUNLIGHT & RADIO (DTE) EXPOSURE MAP COMPUTATION (OPTIONAL)
# ==============================================================================
def sample_grid_bilinear(
    grid: np.ndarray,
    lat_deg: np.ndarray,
    lon_deg: np.ndarray,
    lat_min: float,
    lat_max: float,
    lon_min: float,
    lon_max: float,
    is_full_globe: bool,
):
    rows, cols = grid.shape
    lat_span = max(1e-9, lat_max - lat_min)
    lon_span = max(1e-9, lon_max - lon_min)

    r_f = ((lat_max - np.clip(lat_deg, lat_min, lat_max)) / lat_span) * (rows - 1)
    r0 = np.clip(np.floor(r_f).astype(np.int32), 0, rows - 1)
    r1 = np.minimum(rows - 1, r0 + 1)
    fr = r_f - r0

    if is_full_globe:
        lon_wrap = ((lon_deg + 180.0) % 360.0) - 180.0
        c_f = ((lon_wrap + 180.0) / 360.0) * cols
        c0 = np.floor(c_f).astype(np.int32) % cols
        c1 = (c0 + 1) % cols
        fc = c_f - np.floor(c_f)
    else:
        c_f = ((np.clip(lon_deg, lon_min, lon_max) - lon_min) / lon_span) * (cols - 1)
        c0 = np.clip(np.floor(c_f).astype(np.int32), 0, cols - 1)
        c1 = np.minimum(cols - 1, c0 + 1)
        fc = c_f - c0

    v00 = grid[r0, c0]
    v10 = grid[r0, c1]
    v01 = grid[r1, c0]
    v11 = grid[r1, c1]
    return (v00 * (1.0 - fc) + v10 * fc) * (1.0 - fr) + (v01 * (1.0 - fc) + v11 * fc) * fr


def compute_global_exposure_maps(
    z_grid: np.ndarray,
    lats_1d: np.ndarray,
    lons_1d: np.ndarray,
    is_full_globe: bool,
    exaggeration: float,
    sun_dirs_moon: np.ndarray,
    earth_dirs_moon: np.ndarray,
):
    rows, cols = z_grid.shape
    lat_min, lat_max = float(np.min(lats_1d)), float(np.max(lats_1d))
    lon_min, lon_max = float(np.min(lons_1d)), float(np.max(lons_1d))

    comp_h = min(rows, 240)
    comp_w = min(cols, 480)
    c_lats = np.linspace(lat_max, lat_min, comp_h, dtype=np.float64)
    if is_full_globe:
        c_lons = -180.0 + (np.arange(comp_w, dtype=np.float64) / comp_w) * 360.0
    else:
        c_lons = np.linspace(lon_min, lon_max, comp_w, dtype=np.float64)

    lon_grid, lat_grid = np.meshgrid(c_lons, c_lats)
    z_comp = sample_grid_bilinear(
        z_grid, lat_grid, lon_grid, lat_min, lat_max, lon_min, lon_max, is_full_globe
    )

    lat_rad = np.radians(lat_grid)
    lon_rad = np.radians(lon_grid)
    cos_lat = np.cos(lat_rad)
    sin_lat = np.sin(lat_rad)
    cos_lon = np.cos(lon_rad)
    sin_lon = np.sin(lon_rad)

    ux = cos_lat * cos_lon
    uy = cos_lat * sin_lon
    uz = sin_lat

    ex = -sin_lon
    ey = cos_lon

    nx = -sin_lat * cos_lon
    ny = -sin_lat * sin_lon
    nz = cos_lat

    r0 = MOON_RADIUS_M + z_comp * exaggeration
    dip_rad = -np.arccos(np.clip(MOON_RADIUS_M / np.maximum(MOON_RADIUS_M, r0), 0.0, 1.0))
    base_horizon_deg = np.degrees(dip_rad).astype(np.float32)

    num_sectors = 36
    sector_deg = 360.0 / num_sectors
    horizon_deg = np.broadcast_to(base_horizon_deg[None, :, :], (num_sectors, comp_h, comp_w)).copy()

    psi_steps_rad = np.radians(np.linspace(0.5, 9.0, 18))
    cos_psis = np.cos(psi_steps_rad)
    sin_psis = np.sin(psi_steps_rad)

    for s in range(num_sectors):
        az_rad = math.radians(s * sector_deg)
        sin_a = math.sin(az_rad)
        cos_a = math.cos(az_rad)

        tx = sin_a * ex + cos_a * nx
        ty = sin_a * ey + cos_a * ny
        tz = cos_a * nz

        max_el_s = horizon_deg[s]
        for k in range(len(psi_steps_rad)):
            cp = cos_psis[k]
            sp = sin_psis[k]

            px = cp * ux + sp * tx
            py = cp * uy + sp * ty
            pz = cp * uz + sp * tz

            s_lat = np.degrees(np.arcsin(np.clip(pz, -1.0, 1.0)))
            s_lon = np.degrees(np.arctan2(py, px))

            z_sample = sample_grid_bilinear(
                z_grid, s_lat, s_lon, lat_min, lat_max, lon_min, lon_max, is_full_globe
            )
            rk = MOON_RADIUS_M + z_sample * exaggeration
            elev_deg = np.degrees(np.arctan2(rk * cp - r0, rk * sp)).astype(np.float32)
            np.maximum(max_el_s, elev_deg, out=max_el_s)

    sun_sub = sun_dirs_moon[::4].T
    earth_sub = earth_dirs_moon[::4].T

    sun_exp_comp = np.zeros((comp_h, comp_w), dtype=np.float32)
    radio_exp_comp = np.zeros((comp_h, comp_w), dtype=np.float32)

    sun_rad_deg = 0.2666
    earth_rad_deg = 0.95
    col_indices = np.arange(comp_w)[:, None]

    for r in range(comp_h):
        u_row = np.column_stack([ux[r], uy[r], uz[r]])
        e_row = np.column_stack([ex[r], ey[r], np.zeros(comp_w)])
        n_row = np.column_stack([nx[r], ny[r], nz[r]])

        s_east = e_row @ sun_sub
        s_north = n_row @ sun_sub
        s_up = np.clip(u_row @ sun_sub, -1.0, 1.0)
        s_el = np.degrees(np.arcsin(s_up))
        s_az = (np.degrees(np.arctan2(s_east, s_north)) + 360.0) % 360.0
        s_sec = (np.floor(s_az / sector_deg).astype(np.int32)) % num_sectors
        s_hor = horizon_deg[s_sec, r, col_indices]
        s_vis = np.clip((s_el - s_hor + sun_rad_deg) / (2.0 * sun_rad_deg), 0.0, 1.0)
        sun_exp_comp[r] = s_vis.mean(axis=1)

        e_east = e_row @ earth_sub
        e_north = n_row @ earth_sub
        e_up = np.clip(u_row @ earth_sub, -1.0, 1.0)
        e_el = np.degrees(np.arcsin(e_up))
        e_az = (np.degrees(np.arctan2(e_east, e_north)) + 360.0) % 360.0
        e_sec = (np.floor(e_az / sector_deg).astype(np.int32)) % num_sectors
        e_hor = horizon_deg[e_sec, r, col_indices]
        e_vis = np.clip((e_el - e_hor + earth_rad_deg) / (2.0 * earth_rad_deg), 0.0, 1.0)
        radio_exp_comp[r] = e_vis.mean(axis=1)

    full_lon_grid, full_lat_grid = np.meshgrid(lons_1d, lats_1d)
    sun_exp_full = sample_grid_bilinear(
        sun_exp_comp, full_lat_grid, full_lon_grid, lat_min, lat_max, lon_min, lon_max, is_full_globe
    )
    radio_exp_full = sample_grid_bilinear(
        radio_exp_comp, full_lat_grid, full_lon_grid, lat_min, lat_max, lon_min, lon_max, is_full_globe
    )

    return (
        np.clip(sun_exp_full, 0.0, 1.0).astype(np.float32),
        np.clip(radio_exp_full, 0.0, 1.0).astype(np.float32),
    )


# ==============================================================================
# 4. TERMINAL PROMPT & LOAD GLOBAL LUNAR DEM (LDEM64)
# ==============================================================================
load_exposure_maps = ask_yes_no(
    "Avg Sonnenlicht & Radio Exposure (2027) berechnen und laden?",
    default=False,
)

global_tif_path = next((p for p in GLOBAL_TIF_CANDIDATES if Path(p).exists()), GLOBAL_TIF_CANDIDATES[0])
total_steps_log = 3 if load_exposure_maps else 2
print(f"[1/{total_steps_log}] Loading Global Lunar GeoTIFF (Tiered Global Low-Res {TARGET_LAT_ROWS}x{TARGET_LAT_ROWS*2}): {global_tif_path} ...")

with rasterio.open(global_tif_path) as dataset:
    raw_h, raw_w = dataset.height, dataset.width
    aspect = raw_w / max(1, raw_h)
    target_rows = TARGET_LAT_ROWS
    target_cols = max(
        TARGET_LAT_ROWS, min(1440, int(round(TARGET_LAT_ROWS * aspect)))
    )

    g_z_grid = dataset.read(
        1,
        out_shape=(target_rows, target_cols),
        resampling=Resampling.bilinear,
    ).astype(np.float64)

    if dataset.nodata is not None:
        g_z_grid[np.isclose(g_z_grid, dataset.nodata)] = np.nan

    scale_factor = dataset.scales[0] if dataset.scales else 1.0
    offset_val = dataset.offsets[0] if dataset.offsets else 0.0
    if scale_factor is None:
        scale_factor = 1.0
    if offset_val is None:
        offset_val = 0.0

    if scale_factor != 1.0 or offset_val != 0.0:
        g_z_grid = g_z_grid * scale_factor + offset_val

    valid_vals = g_z_grid[np.isfinite(g_z_grid)]
    if valid_vals.size == 0:
        raise RuntimeError("Global GeoTIFF contains no valid elevation pixels.")

    median_val = float(np.median(valid_vals))
    max_abs_val = float(np.max(np.abs(valid_vals)))
    if median_val > 1_000_000.0:
        g_z_grid -= MOON_RADIUS_M
    elif max_abs_val < 30.0:
        g_z_grid *= 1000.0

    g_min_z = float(np.nanmin(g_z_grid))
    g_max_z = float(np.nanmax(g_z_grid))
    g_z_grid = np.where(np.isnan(g_z_grid), g_min_z, g_z_grid)

    col_step = raw_w / target_cols
    row_step = raw_h / target_rows
    col_centers = (np.arange(target_cols) + 0.5) * col_step
    row_centers = (np.arange(target_rows) + 0.5) * row_step

    x_src = dataset.transform.c + col_centers * dataset.transform.a
    y_src = dataset.transform.f + row_centers * dataset.transform.e

    src_crs = dataset.crs
    if src_crs is None:
        b = dataset.bounds
        if -180.5 <= b.left and b.right <= 360.5 and -90.5 <= b.bottom and b.top <= 90.5:
            lons_1d = x_src.copy()
            lats_1d = y_src.copy()
        else:
            x_mesh, y_mesh = np.meshgrid(x_src, y_src)
            lon_f, lat_f = transform(
                "+proj=eqc +R=1737400 +no_defs",
                lunar_geo_crs,
                x_mesh.ravel(),
                y_mesh.ravel(),
            )
            lons_1d = np.array(lon_f).reshape(g_z_grid.shape)[target_rows // 2, :]
            lats_1d = np.array(lat_f).reshape(g_z_grid.shape)[:, target_cols // 2]
    elif src_crs.is_geographic:
        lons_1d = x_src.copy()
        lats_1d = y_src.copy()
    else:
        x_mesh, y_mesh = np.meshgrid(x_src, y_src)
        lon_f, lat_f = transform(
            src_crs, lunar_geo_crs, x_mesh.ravel(), y_mesh.ravel()
        )
        lons_1d = np.array(lon_f).reshape(g_z_grid.shape)[target_rows // 2, :]
        lats_1d = np.array(lat_f).reshape(g_z_grid.shape)[:, target_cols // 2]

lons_norm = ((lons_1d + 180.0) % 360.0) - 180.0
lon_sort_idx = np.argsort(lons_norm)
lons_norm = lons_norm[lon_sort_idx]
g_z_grid = g_z_grid[:, lon_sort_idx]

if lats_1d[0] < lats_1d[-1]:
    lats_1d = lats_1d[::-1]
    g_z_grid = g_z_grid[::-1, :]

lat_min, lat_max = float(np.min(lats_1d)), float(np.max(lats_1d))
lon_min, lon_max = float(np.min(lons_norm)), float(np.max(lons_norm))
is_full_globe = (lon_max - lon_min) >= 355.0 and (lat_max - lat_min) >= 175.0

print(
    f"Global Low-Res Grid: {g_z_grid.shape[0]}x{g_z_grid.shape[1]} | "
    f"Elevation: {g_min_z:.1f} m to {g_max_z:.1f} m"
)


# ==============================================================================
# 5. QUERY JPL HORIZONS EPHEMERIS & OPTIONAL EXPOSURE MAPS
# ==============================================================================
print(f"[2/{total_steps_log}] Querying NASA JPL Horizons API ({START_TIME_UTC} to {STOP_TIME_UTC})...")
try:
    timestamps, sun_az, sun_el = fetch_jpl_horizons_ephemeris(
        target_id="10",
        lon_deg=0.0,
        lat_deg=0.0,
        alt_km=0.0,
        start_time=START_TIME_UTC,
        stop_time=STOP_TIME_UTC,
        step_size=STEP_SIZE,
    )
    _, earth_az, earth_el = fetch_jpl_horizons_ephemeris(
        target_id="399",
        lon_deg=0.0,
        lat_deg=0.0,
        alt_km=0.0,
        start_time=START_TIME_UTC,
        stop_time=STOP_TIME_UTC,
        step_size=STEP_SIZE,
    )
    ephem_source = "NASA JPL Horizons API (Live Ephemeris)"
except Exception as exc:
    print(f"Warning: JPL Horizons request failed ({exc}). Using analytical fallback.")
    timestamps, sun_az, sun_el, earth_az, earth_el = generate_analytical_fallback(
        0.0, 0.0, START_TIME_UTC, hours=8760
    )
    ephem_source = "Analytical Lunar Ephemeris (Offline Fallback)"

sun_dirs_moon = az_el_to_moon_fixed_dirs(0.0, 0.0, sun_az, sun_el)
earth_dirs_moon = az_el_to_moon_fixed_dirs(0.0, 0.0, earth_az, earth_el)

if load_exposure_maps:
    print(f"[3/{total_steps_log}] Computing global 2027 Average Sunlight & Radio (DTE) Exposure maps...")
    sun_exposure_grid, radio_exposure_grid = compute_global_exposure_maps(
        z_grid=g_z_grid,
        lats_1d=lats_1d,
        lons_1d=lons_norm,
        is_full_globe=is_full_globe,
        exaggeration=vertical_exaggeration,
        sun_dirs_moon=sun_dirs_moon,
        earth_dirs_moon=earth_dirs_moon,
    )
    sun_exp_b64 = encode_u16_b64(sun_exposure_grid, 0.0, 1.0)
    radio_exp_b64 = encode_u16_b64(radio_exposure_grid, 0.0, 1.0)
else:
    print("Avg Sonnenlicht & Radio Exposure übersprungen (im Web-Viewer deaktiviert).")
    sun_exp_b64 = ""
    radio_exp_b64 = ""

sun_dirs_xyz = moon_fixed_to_threejs_list(sun_dirs_moon)
earth_dirs_xyz = moon_fixed_to_threejs_list(earth_dirs_moon)


# ==============================================================================
# 6. PACKAGE PAYLOAD & GENERATE TIERED-DETAIL HTML VIEWER
# ==============================================================================
total_tiles_count = 6 * TILES_PER_CUBE_EDGE * TILES_PER_CUBE_EDGE

combined_payload = {
    "moon_radius_m": MOON_RADIUS_M,
    "exaggeration": vertical_exaggeration,
    "tiles_per_edge": TILES_PER_CUBE_EDGE,
    "tile_size_km": TILE_SIZE_KM,
    "shadow_pad_km": SHADOW_PAD_KM,
    "tile_grid_res": TILE_GRID_RES,
    "has_exposure_maps": bool(load_exposure_maps),
    "global": {
        "rows": int(g_z_grid.shape[0]),
        "cols": int(g_z_grid.shape[1]),
        "is_full_globe": bool(is_full_globe),
        "lat_min": round(lat_min, 6),
        "lat_max": round(lat_max, 6),
        "lon_min": round(lon_min, 6),
        "lon_max": round(lon_max, 6),
        "z_b64": encode_u16_b64(g_z_grid, g_min_z, g_max_z),
        "sun_exp_b64": sun_exp_b64,
        "radio_exp_b64": radio_exp_b64,
        "min_z": round(g_min_z, 2),
        "max_z": round(g_max_z, 2),
    },
    "ephemeris": {
        "source": ephem_source,
        "timestamps": timestamps,
        "sun_dirs": sun_dirs_xyz,
        "earth_dirs": earth_dirs_xyz,
    },
}

html_template = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Lunar Global Tiered 3D (Fast Low-Res Globe + Max-Detail {TILE_GRID_RES}px Tiles)</title>
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }}
  body {{ background: #07090e; color: #e6edf3; overflow: hidden; }}
  #canvas-container {{ width: 100vw; height: 100vh; display: block; }}

  #transition-veil {{
    position: fixed; inset: 0; pointer-events: none; z-index: 40;
    background: radial-gradient(circle at center, rgba(11, 15, 24, 0.72) 0%, rgba(7, 9, 14, 0.98) 100%);
    opacity: 0;
    display: flex; align-items: center; justify-content: center;
    transition: opacity 0.08s linear;
  }}
  #transition-label {{
    padding: 10px 18px; border-radius: 999px;
    background: rgba(15, 20, 30, 0.92); border: 1px solid rgba(255, 212, 59, 0.5);
    color: #ffd43b; font-size: 13px; font-weight: 700; letter-spacing: 0.4px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.65);
  }}

  #hud {{
    position: absolute; top: 16px; left: 16px; width: 358px;
    background: rgba(13, 17, 25, 0.90); backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 12px;
    padding: 15px; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.70);
    z-index: 10; max-height: calc(100vh - 150px); overflow-y: auto;
  }}

  .nav-action-btn {{
    width: 100%; padding: 9px 12px; margin-bottom: 11px;
    border-radius: 8px; font-size: 12.5px; font-weight: 700;
    cursor: pointer; transition: all 0.18s ease;
    display: flex; align-items: center; justify-content: center; gap: 7px;
  }}
  .nav-action-btn.back-global {{
    background: linear-gradient(135deg, #1f6feb 0%, #388bfd 100%);
    color: #ffffff; border: 1px solid rgba(121, 192, 255, 0.55);
    box-shadow: 0 4px 14px rgba(31, 111, 235, 0.42);
  }}
  .nav-action-btn.back-global:hover {{
    background: linear-gradient(135deg, #388bfd 0%, #58a6ff 100%);
    transform: translateY(-1px);
  }}
  .nav-action-btn.enter-detail {{
    background: linear-gradient(135deg, #d29922 0%, #e3b341 100%);
    color: #0d1117; border: 1px solid #ffd43b;
    box-shadow: 0 3px 12px rgba(210, 153, 34, 0.35);
    margin-top: 9px; margin-bottom: 0;
  }}
  .nav-action-btn.enter-detail:hover {{
    background: linear-gradient(135deg, #e3b341 0%, #ffd43b 100%);
    transform: translateY(-1px);
  }}

  h1 {{ font-size: 15px; font-weight: 700; margin-bottom: 3px; color: #ffffff; }}
  .subtitle {{ font-size: 11.5px; color: #8b949e; margin-bottom: 11px; }}

  .map-mode-grid {{
    display: grid; grid-template-columns: 1fr 1fr; gap: 5px;
    background: #161b22; border: 1px solid #30363d; border-radius: 9px;
    padding: 5px; margin-bottom: 11px; user-select: none;
  }}
  .mode-btn {{
    text-align: center; padding: 7px 6px; font-size: 11.5px; font-weight: 600;
    border-radius: 6px; transition: all 0.18s ease; color: #8b949e;
    cursor: pointer; border: 1px solid transparent;
  }}
  .mode-btn:hover:not(.disabled) {{ color: #e6edf3; background: rgba(255, 255, 255, 0.05); }}
  .mode-btn.disabled {{
    opacity: 0.36; cursor: not-allowed; pointer-events: none; text-decoration: line-through;
  }}
  .mode-btn.active.shadow-mode {{
    background: #d29922; color: #0d1117; box-shadow: 0 2px 8px rgba(210, 153, 34, 0.4);
  }}
  .mode-btn.active.height-mode {{
    background: #2f81f7; color: #ffffff; box-shadow: 0 2px 8px rgba(47, 129, 247, 0.4);
  }}
  .mode-btn.active.sunexp-mode {{
    background: #e8590c; color: #ffffff; box-shadow: 0 2px 8px rgba(232, 89, 12, 0.45);
  }}
  .mode-btn.active.radio-mode {{
    background: #0ca678; color: #ffffff; box-shadow: 0 2px 8px rgba(12, 166, 120, 0.45);
  }}

  .mode-info-banner {{
    background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 7px; padding: 7px 9px; font-size: 11px; color: #c9d1d9;
    line-height: 1.4; margin-bottom: 10px;
  }}

  .sub-toggle-row {{
    display: flex; align-items: center; justify-content: space-between;
    background: rgba(255, 255, 255, 0.04); border: 1px solid #30363d;
    border-radius: 8px; padding: 8px 10px; margin-bottom: 8px; cursor: pointer; user-select: none;
  }}
  .sub-toggle-label {{ font-size: 12px; font-weight: 600; color: #e6edf3; }}
  .switch-pill {{
    position: relative; width: 38px; height: 20px; background: #30363d;
    border-radius: 20px; transition: background 0.2s ease; flex-shrink: 0;
  }}
  .switch-pill::after {{
    content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
    background: #ffffff; border-radius: 50%; transition: transform 0.2s ease;
  }}
  .switch-pill.on {{ background: #2f81f7; }}
  .switch-pill.on::after {{ transform: translateX(18px); }}

  .control-group {{ margin-bottom: 12px; }}
  .control-header {{ display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px; }}
  .slider-bounds {{ display: flex; justify-content: space-between; font-size: 10.5px; color: #8b949e; margin-top: 2px; }}
  #hud input[type="range"] {{ width: 100%; accent-color: #2f81f7; cursor: pointer; }}

  .ephem-grid {{
    display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 10px;
  }}
  .ephem-box {{
    background: rgba(255, 255, 255, 0.035); border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 7px; padding: 7px 8px; font-size: 11px;
  }}
  .ephem-label {{ color: #8b949e; font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 2px; }}
  .ephem-val {{ color: #ffffff; font-weight: 700; font-variant-numeric: tabular-nums; }}

  .site-card {{
    background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px; padding: 10px; font-size: 12px;
  }}
  .site-header {{ display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }}
  .site-title {{ font-weight: 700; color: #ffd43b; }}
  .site-meta {{ color: #c9d1d9; line-height: 1.45; font-size: 11.5px; }}
  .site-hint {{ font-size: 10.5px; color: #8b949e; margin-top: 7px; line-height: 1.35; }}
  .badge-row {{ display: flex; flex-wrap: wrap; gap: 5px; margin-top: 7px; }}
  .status-badge {{
    display: inline-block; padding: 3px 7px; border-radius: 4px;
    font-weight: 700; font-size: 10.5px;
  }}
  .lit {{ background: rgba(46, 160, 67, 0.25); color: #56d364; border: 1px solid #2ea043; }}
  .partial {{ background: rgba(210, 153, 34, 0.25); color: #e3b341; border: 1px solid #d29922; }}
  .shadowed {{ background: rgba(248, 81, 73, 0.2); color: #ff7b72; border: 1px solid #f85149; }}
  .comms-ok {{ background: rgba(56, 139, 253, 0.22); color: #79c0ff; border: 1px solid #388bfd; }}

  .annual-stats {{
    margin-top: 9px; padding-top: 8px; border-top: 1px solid rgba(255, 255, 255, 0.1);
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; text-align: center;
  }}
  .stat-cell-val {{ font-size: 12px; font-weight: 700; color: #ffd43b; font-variant-numeric: tabular-nums; }}
  .stat-cell-lbl {{ font-size: 9.5px; color: #8b949e; line-height: 1.2; margin-top: 2px; }}

  #timeline-bar {{
    position: absolute; bottom: 16px; left: 16px; right: 132px;
    background: rgba(13, 17, 25, 0.92); backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.16); border-radius: 12px;
    padding: 11px 16px; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.7);
    z-index: 15;
  }}
  .tl-top {{
    display: flex; align-items: center; justify-content: space-between;
    gap: 10px; margin-bottom: 8px; flex-wrap: wrap;
  }}
  .tl-controls {{ display: flex; align-items: center; gap: 6px; }}
  .tl-btn {{
    background: #21262d; color: #e6edf3; border: 1px solid #30363d;
    border-radius: 6px; padding: 5px 10px; font-size: 12px; font-weight: 600;
    cursor: pointer; transition: all 0.15s ease;
  }}
  .tl-btn:hover {{ background: #30363d; border-color: #8b949e; }}
  .tl-btn.primary {{ background: #d29922; color: #0d1117; border-color: #e3b341; min-width: 82px; }}
  .tl-btn.primary:hover {{ background: #e3b341; }}
  .tl-select {{
    background: #161b22; color: #e6edf3; border: 1px solid #30363d;
    border-radius: 6px; padding: 5px 8px; font-size: 11.5px; cursor: pointer;
  }}
  .tl-clock {{
    font-size: 13px; font-weight: 700; color: #ffd43b;
    font-variant-numeric: tabular-nums; letter-spacing: 0.3px;
  }}
  .tl-source {{ font-size: 10.5px; color: #8b949e; }}

  .scrub-container {{ position: relative; width: 100%; height: 22px; display: flex; align-items: center; }}
  #power-strip {{
    position: absolute; left: 0; right: 0; height: 8px; border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.18); pointer-events: none;
  }}
  #time-slider {{
    position: relative; width: 100%; -webkit-appearance: none; appearance: none;
    background: transparent; cursor: pointer; z-index: 2; height: 22px;
  }}
  #time-slider::-webkit-slider-thumb {{
    -webkit-appearance: none; appearance: none; width: 14px; height: 18px;
    border-radius: 3px; background: #ffffff; border: 2px solid #0d1117;
    box-shadow: 0 0 8px rgba(255, 212, 59, 0.9); cursor: grab;
  }}
  #time-slider::-moz-range-thumb {{
    width: 14px; height: 18px; border-radius: 3px; background: #ffffff;
    border: 2px solid #0d1117; box-shadow: 0 0 8px rgba(255, 212, 59, 0.9); cursor: grab;
  }}
  .tl-months {{
    display: flex; justify-content: space-between; font-size: 10px; color: #8b949e;
    margin-top: 2px; padding: 0 2px;
  }}

  #legend {{
    position: absolute; top: 16px; right: 16px; bottom: 16px; width: 104px;
    background: rgba(13, 17, 25, 0.86); backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 10px;
    padding: 12px 10px; display: flex; flex-direction: column; align-items: center;
    z-index: 10; pointer-events: none;
  }}
  .legend-title {{
    font-size: 11.5px; font-weight: 600; color: #e6edf3; margin-bottom: 10px; text-align: center;
  }}
  .colorbar-wrap {{
    position: relative; flex: 1; width: 100%; display: flex; align-items: stretch; justify-content: flex-start;
    padding-left: 6px;
  }}
  .colorbar {{
    width: 18px; height: 100%; border-radius: 3px; border: 1px solid rgba(255,255,255,0.2);
    background: linear-gradient(to top, #440154, #3b528b, #21918c, #5ec962, #fde725);
  }}
  #colorbar-ticks {{
    position: relative; flex: 1; height: 100%; margin-left: 4px;
  }}
  .cb-tick {{
    position: absolute; left: 0; transform: translateY(50%);
    font-size: 10.5px; color: #c9d1d9; white-space: nowrap; font-variant-numeric: tabular-nums;
  }}
  .cb-tick::before {{
    content: ""; display: inline-block; width: 7px; height: 1px;
    background: #9da7b3; vertical-align: middle; margin-right: 4px;
  }}

  #tooltip {{
    position: absolute; pointer-events: none; display: none;
    background: rgba(13, 17, 23, 0.94); border: 1px solid rgba(255, 212, 59, 0.45);
    border-radius: 8px; padding: 9px 11px; font-size: 11.5px; line-height: 1.5;
    box-shadow: 0 8px 22px rgba(0, 0, 0, 0.65); z-index: 20; min-width: 260px;
    will-change: transform;
  }}
  .tt-divider {{
    border: 0; border-top: 1px solid rgba(255, 255, 255, 0.12); margin: 5px 0;
  }}
  .tt-lit {{ color: #56d364; font-weight: 700; }}
  .tt-partial {{ color: #e3b341; font-weight: 700; }}
  .tt-shadow {{ color: #ff7b72; font-weight: 700; }}
  .tt-radio {{ color: #00f5d4; font-weight: 700; }}
  .tt-cta {{ color: #ffd43b; font-weight: 700; }}
</style>
<script type="importmap">
{{
  "imports": {{
    "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
    "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/"
  }}
}}
</script>
</head>
<body>
<div id="canvas-container"></div>
<div id="transition-veil"><div id="transition-label">Lade Max-Detail 200×200 km Kachel ({TILE_GRID_RES}px)...</div></div>

<div id="hud">
  <button class="nav-action-btn back-global" id="back-to-global-btn" style="display: none;">
    ← Zurück zur Mondansicht
  </button>

  <h1 id="hud-title">Global Lunar Globe (Fast)</h1>
  <div class="subtitle" id="hud-subtitle">1:1 Metric Lunar Sphere • {total_tiles_count:,} × (200×200 km, {TILE_GRID_RES}px Max-Detail)</div>

  <div class="map-mode-grid" id="map-mode-selector">
    <div class="mode-btn active shadow-mode" data-mode="shadow">☀️ JPL Sun Shadows</div>
    <div class="mode-btn" data-mode="height">⛰️ Elevation Map</div>
    <div class="mode-btn" data-mode="sunexp" id="btn-mode-sunexp">🔆 Avg Sunlight Map</div>
    <div class="mode-btn" data-mode="radio" id="btn-mode-radio">📡 Radio Exposure</div>
  </div>

  <div class="mode-info-banner" id="mode-info-banner" style="display: none;"></div>

  <div class="sub-toggle-row" id="tilegrid-toggle-row" title="Ein-/Ausblenden der {total_tiles_count:,} überlappenden Quadrate">
    <span class="sub-toggle-label">200×200 km Quadrate ({total_tiles_count:,})</span>
    <div class="switch-pill on" id="tilegrid-switch-pill"></div>
  </div>

  <div class="sub-toggle-row" id="graticule-toggle-row" title="Toggle 30° latitude/longitude grid on the Moon">
    <span class="sub-toggle-label">Lat/Lon Graticule (30°)</span>
    <div class="switch-pill on" id="graticule-switch-pill"></div>
  </div>

  <div id="sun-controls">
    <div class="ephem-grid">
      <div class="ephem-box">
        <div class="ephem-label">☀️ Local Sun Az / El</div>
        <div class="ephem-val" id="sun-ephem-val">--° / --°</div>
      </div>
      <div class="ephem-box">
        <div class="ephem-label">🌍 Local Earth Az / El</div>
        <div class="ephem-val" id="earth-ephem-val">--° / --°</div>
      </div>
    </div>
  </div>

  <div id="height-controls" style="display: none;">
    <div class="sub-toggle-row" id="contour-toggle-row" title="Toggle topographic contour lines">
      <span class="sub-toggle-label">Surface Elevation Lines</span>
      <div class="switch-pill on" id="contour-switch-pill"></div>
    </div>

    <div class="control-group" id="contour-fineness-group">
      <div class="control-header">
        <span>Contour Interval</span>
        <span id="contour-interval-val">1,000 m</span>
      </div>
      <input type="range" id="fineness-slider" min="250" max="2500" step="250" value="1750" />
      <div class="slider-bounds">
        <span id="fineness-min-lbl">Coarse (2,500 m)</span>
        <span id="fineness-max-lbl">Fine (250 m)</span>
      </div>
    </div>
  </div>

  <div class="site-card">
    <div class="site-header">
      <div class="site-title" id="site-title">🧩 Quadrat #0001 (200×200 km)</div>
    </div>
    <div class="site-meta" id="site-meta">
      Zentrum: <b>--° S, --° E</b><br/>
      Höhe: <b>-- m</b>
    </div>
    <div class="badge-row">
      <div id="site-status" class="status-badge lit">☀️ CALCULATING...</div>
      <div id="earth-status" class="status-badge comms-ok">📡 EARTH LOS...</div>
    </div>
    <div class="annual-stats">
      <div>
        <div class="stat-cell-val" id="stat-sun-pct">--%</div>
        <div class="stat-cell-lbl">Annual<br/>Sunlight</div>
      </div>
      <div>
        <div class="stat-cell-val" id="stat-mid-val" style="color:#00f5d4;">--%</div>
        <div class="stat-cell-lbl" id="stat-mid-lbl">Annual<br/>Radio (DTE)</div>
      </div>
      <div>
        <div class="stat-cell-val" id="stat-max-eclipse">-- h</div>
        <div class="stat-cell-lbl">Longest<br/>Eclipse</div>
      </div>
    </div>

    <button class="nav-action-btn enter-detail" id="enter-tile-btn">
      🔍 Max-Detail ({TILE_GRID_RES}px) Quadrat in 3D öffnen
    </button>
    <div class="site-hint" id="site-hint">
      Klicke auf ein beliebiges <b>200×200 km Quadrat</b>, um das hochauflösende {TILE_GRID_RES}px-Terrain mit JPL-Schattenwurf zu öffnen.
    </div>
  </div>
</div>

<div id="timeline-bar">
  <div class="tl-top">
    <div class="tl-controls">
      <button class="tl-btn primary" id="play-btn">▶ Play</button>
      <button class="tl-btn" id="step-back-btn" title="Step back 1 hour">◀ -1h</button>
      <button class="tl-btn" id="step-fwd-btn" title="Step forward 1 hour">+1h ▶</button>
      <select class="tl-select" id="speed-select" title="Simulation playback speed">
        <option value="12">12 hrs / sec</option>
        <option value="24" selected>1 day / sec</option>
        <option value="72">3 days / sec</option>
        <option value="168">7 days / sec</option>
      </select>
    </div>
    <div class="tl-clock" id="utc-clock">2027-Jan-01 00:00 UTC</div>
    <div class="tl-source">{ephem_source}</div>
  </div>

  <div class="scrub-container">
    <canvas id="power-strip" height="8"></canvas>
    <input type="range" id="time-slider" min="0" max="{len(timestamps) - 1}" step="1" value="0" />
  </div>
  <div class="tl-months">
    <span>Jan</span><span>Feb</span><span>Mar</span><span>Apr</span><span>May</span><span>Jun</span>
    <span>Jul</span><span>Aug</span><span>Sep</span><span>Oct</span><span>Nov</span><span>Dec</span>
  </div>
</div>

<div id="legend">
  <div class="legend-title" id="legend-title">Elevation (m)</div>
  <div class="colorbar-wrap">
    <div class="colorbar" id="legend-colorbar"></div>
    <div id="colorbar-ticks"></div>
  </div>
</div>

<div id="tooltip"></div>

<script type="module">
import * as THREE from 'three';
import {{ OrbitControls }} from 'three/addons/controls/OrbitControls.js';

const DATA = {json.dumps(combined_payload, separators=(",", ":"))};
const GDATA = DATA.global;
const EPHEM = DATA.ephemeris;
const HAS_EXPOSURE_MAPS = Boolean(DATA.has_exposure_maps);
const TOTAL_STEPS = EPHEM.timestamps.length;
const SOLAR_CONSTANT_WM2 = 1361;
const SOLAR_ANGULAR_RADIUS_DEG = 0.2666;
const SOLAR_ANGULAR_RADIUS_RAD = THREE.MathUtils.degToRad(SOLAR_ANGULAR_RADIUS_DEG);

if (!HAS_EXPOSURE_MAPS) {{
  const btnSunExp = document.getElementById('btn-mode-sunexp');
  const btnRadio = document.getElementById('btn-mode-radio');
  btnSunExp.classList.add('disabled');
  btnRadio.classList.add('disabled');
  btnSunExp.title = 'Im Terminal deaktiviert';
  btnRadio.title = 'Im Terminal deaktiviert';
}}

function decodeU16Grid(b64, vMin, vMax) {{
  if (!b64) return null;
  const bin = atob(b64);
  const len = bin.length >> 1;
  const out = new Float32Array(len);
  const scale = (vMax - vMin) / 65535.0;
  for (let i = 0; i < len; i++) {{
    const lo = bin.charCodeAt(i * 2);
    const hi = bin.charCodeAt(i * 2 + 1);
    out[i] = vMin + ((hi << 8) | lo) * scale;
  }}
  return out;
}}

const G_Z_VALUES = decodeU16Grid(GDATA.z_b64, GDATA.min_z, GDATA.max_z);
const G_SUN_EXP_VALUES = HAS_EXPOSURE_MAPS ? decodeU16Grid(GDATA.sun_exp_b64, 0.0, 1.0) : null;
const G_RADIO_EXP_VALUES = HAS_EXPOSURE_MAPS ? decodeU16Grid(GDATA.radio_exp_b64, 0.0, 1.0) : null;
const SUN_DIRS = new Float32Array(EPHEM.sun_dirs);
const EARTH_DIRS = new Float32Array(EPHEM.earth_dirs);

const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07090e);

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.5, 8000);
const renderer = new THREE.WebGLRenderer({{
  antialias: true,
  powerPreference: 'high-performance',
  stencil: false
}});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.localClippingEnabled = true;
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;

const ambientLight = new THREE.AmbientLight(0x161d2b, 0.04);
scene.add(ambientLight);

const mapReliefLight = new THREE.DirectionalLight(0xffffff, 0.0);
camera.add(mapReliefLight);
scene.add(camera);

function makeMultiLineSprite(lines, {{ fontSize = 26, color = '#e6edf3', boldFirst = true, width = 360, height = 80, scaleW = 36 }} = {{}}) {{
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const lineHeight = fontSize * 1.25;
  const startY = height * 0.5 - ((lines.length - 1) * lineHeight) * 0.5;

  lines.forEach((line, idx) => {{
    ctx.font = `${{idx === 0 && boldFirst ? 'bold ' : ''}}${{fontSize}}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.fillStyle = idx === 0 ? color : '#9da7b3';
    ctx.fillText(line, width * 0.5, startY + idx * lineHeight);
  }});

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({{ map: tex, transparent: true, depthTest: false }});
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(scaleW, scaleW * (height / width), 1);
  sprite.renderOrder = 5;
  return sprite;
}}

function sampleStops(t, stops) {{
  t = Math.max(0, Math.min(1, t));
  const idx = t * (stops.length - 1);
  const i = Math.floor(idx);
  const f = idx - i;
  const c0 = stops[i];
  const c1 = stops[Math.min(i + 1, stops.length - 1)];
  return [
    c0[0] + (c1[0] - c0[0]) * f,
    c0[1] + (c1[1] - c0[1]) * f,
    c0[2] + (c1[2] - c0[2]) * f
  ];
}}

const VIRIDIS_STOPS = [
  [0.267, 0.005, 0.329],
  [0.230, 0.322, 0.545],
  [0.128, 0.567, 0.551],
  [0.369, 0.789, 0.383],
  [0.993, 0.906, 0.144]
];

const SUN_EXP_STOPS = [
  [0.035, 0.045, 0.095],
  [0.260, 0.065, 0.340],
  [0.680, 0.150, 0.240],
  [0.945, 0.450, 0.090],
  [0.995, 0.820, 0.180],
  [1.000, 0.985, 0.840]
];

const RADIO_EXP_STOPS = [
  [0.040, 0.050, 0.095],
  [0.240, 0.120, 0.480],
  [0.110, 0.440, 0.640],
  [0.080, 0.760, 0.740],
  [0.480, 0.970, 0.920]
];

function computeNiceElevationTicks(minVal, maxVal, targetCount = 6) {{
  const rawStep = Math.max(1, (maxVal - minVal) / Math.max(1, targetCount));
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  let niceStep;
  if (norm <= 1.2) niceStep = 1 * mag;
  else if (norm <= 2.5) niceStep = 2 * mag;
  else if (norm <= 5.5) niceStep = 5 * mag;
  else niceStep = 10 * mag;

  const firstTick = Math.ceil(minVal / niceStep) * niceStep;
  const ticks = [];
  for (let v = firstTick; v <= maxVal; v += niceStep) {{
    ticks.push(Math.round(v));
  }}
  return ticks;
}}

const stripCanvas = document.getElementById('power-strip');
stripCanvas.width = 1200;
const stripCtx = stripCanvas.getContext('2d');

function drawPowerStrip(hourlyLitArr) {{
  for (let px = 0; px < stripCanvas.width; px++) {{
    const sIdx = Math.floor((px / stripCanvas.width) * TOTAL_STEPS);
    const eIdx = Math.max(sIdx + 1, Math.floor(((px + 1) / stripCanvas.width) * TOTAL_STEPS));
    let litSum = 0;
    for (let k = sIdx; k < eIdx; k++) litSum += hourlyLitArr[k];
    const frac = litSum / (eIdx - sIdx);
    if (frac > 0.75) stripCtx.fillStyle = '#2ea043';
    else if (frac > 0.15) stripCtx.fillStyle = '#d29922';
    else stripCtx.fillStyle = '#302026';
    stripCtx.fillRect(px, 0, 1, 8);
  }}
}}

const R_MOON_M = DATA.moon_radius_m;
const R_MOON_KM = R_MOON_M / 1000.0;
const G_ROWS = GDATA.rows;
const G_COLS = GDATA.cols;
const G_LAT_SPAN = GDATA.lat_max - GDATA.lat_min;
const G_LON_SPAN = GDATA.lon_max - GDATA.lon_min;

function sampleGlobalGridAtLatLon(gridArr, latDeg, lonDeg) {{
  if (!gridArr) return 0.0;
  const clampedLat = THREE.MathUtils.clamp(latDeg, GDATA.lat_min, GDATA.lat_max);
  const rF = ((GDATA.lat_max - clampedLat) / Math.max(1e-9, G_LAT_SPAN)) * (G_ROWS - 1);
  const r0 = Math.min(G_ROWS - 1, Math.max(0, rF | 0));
  const r1 = Math.min(G_ROWS - 1, r0 + 1);
  const fr = rF - r0;

  let cF;
  if (GDATA.is_full_globe) {{
    const normLon = ((lonDeg + 180.0) % 360.0 + 360.0) % 360.0 - 180.0;
    cF = ((normLon + 180.0) / 360.0) * G_COLS;
  }} else {{
    const clampedLon = THREE.MathUtils.clamp(lonDeg, GDATA.lon_min, GDATA.lon_max);
    cF = ((clampedLon - GDATA.lon_min) / Math.max(1e-9, G_LON_SPAN)) * (G_COLS - 1);
  }}

  const c0 = ((cF | 0) % G_COLS + G_COLS) % G_COLS;
  const c1 = GDATA.is_full_globe ? (c0 + 1) % G_COLS : Math.min(G_COLS - 1, c0 + 1);
  const fc = cF - Math.floor(cF);

  const row0 = r0 * G_COLS;
  const row1 = r1 * G_COLS;
  return (gridArr[row0 + c0] * (1 - fc) + gridArr[row0 + c1] * fc) * (1 - fr) +
         (gridArr[row1 + c0] * (1 - fc) + gridArr[row1 + c1] * fc) * fr;
}}

function getElevationMetersAtLatLon(latDeg, lonDeg) {{
  return sampleGlobalGridAtLatLon(G_Z_VALUES, latDeg, lonDeg);
}}

function moonUnitToLatLon(u) {{
  const latDeg = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(u.z, -1, 1)));
  const lonDeg = THREE.MathUtils.radToDeg(Math.atan2(u.y, u.x));
  return {{ latDeg, lonDeg }};
}}

function moonUnitToThreeVec(u, radius) {{
  return new THREE.Vector3(u.x * radius, u.z * radius, -u.y * radius);
}}

function getLocalMoonBasis(upMoon) {{
  const up = upMoon.clone().normalize();
  let east, north;
  if (Math.abs(up.z) < 0.999999) {{
    east = new THREE.Vector3(-up.y, up.x, 0).normalize();
    north = new THREE.Vector3().crossVectors(up, east).normalize();
  }} else if (up.z < 0) {{
    east = new THREE.Vector3(0, 1, 0);
    north = new THREE.Vector3(1, 0, 0);
  }} else {{
    east = new THREE.Vector3(0, 1, 0);
    north = new THREE.Vector3(-1, 0, 0);
  }}
  return {{ east, north, up }};
}}

function tileKmToMoonUnit(basis, xKm, yKm) {{
  const rho = Math.hypot(xKm, yKm);
  const chi = rho / R_MOON_KM;
  const cc = Math.cos(chi);
  const sc = rho > 1e-9 ? Math.sin(chi) / rho : 1.0 / R_MOON_KM;
  return new THREE.Vector3(
    cc * basis.up.x + sc * (xKm * basis.east.x + yKm * basis.north.x),
    cc * basis.up.y + sc * (xKm * basis.east.y + yKm * basis.north.y),
    cc * basis.up.z + sc * (xKm * basis.east.z + yKm * basis.north.z)
  ).normalize();
}}

function moonUnitToTileKm(basis, u) {{
  const dot = THREE.MathUtils.clamp(u.dot(basis.up), -1, 1);
  if (dot <= 0) return null;
  const chi = Math.acos(dot);
  const rho = R_MOON_KM * chi;
  const px = u.dot(basis.east);
  const py = u.dot(basis.north);
  const pl = Math.hypot(px, py);
  if (pl < 1e-12) return [0, 0];
  return [(px / pl) * rho, (py / pl) * rho];
}}

const LUNAR_TILES = (() => {{
  const N = DATA.tiles_per_edge;
  const faces = [
    [new THREE.Vector3(1, 0, 0),  new THREE.Vector3(0, 1, 0),  new THREE.Vector3(0, 0, 1)],
    [new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1)],
    [new THREE.Vector3(0, 1, 0),  new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1)],
    [new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0),  new THREE.Vector3(0, 0, 1)],
    [new THREE.Vector3(0, 0, 1),  new THREE.Vector3(0, 1, 0),  new THREE.Vector3(-1, 0, 0)],
    [new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0),  new THREE.Vector3(1, 0, 0)],
  ];

  const tiles = [];
  let idx = 0;
  for (const [normal, axU, axV] of faces) {{
    for (let r = 0; r < N; r++) {{
      const v = -1.0 + 2.0 * (r + 0.5) / N;
      for (let c = 0; c < N; c++) {{
        const u = -1.0 + 2.0 * (c + 0.5) / N;
        const centerMoon = normal.clone().addScaledVector(axU, u).addScaledVector(axV, v).normalize();
        const basis = getLocalMoonBasis(centerMoon);
        const {{ latDeg, lonDeg }} = moonUnitToLatLon(centerMoon);
        const centerElevM = getElevationMetersAtLatLon(latDeg, lonDeg);
        tiles.push({{
          idx,
          idLabel: `#${{String(idx + 1).padStart(4, '0')}}`,
          centerMoon,
          basis,
          lat: latDeg,
          lon: lonDeg,
          centerElevM,
          sunExp: HAS_EXPOSURE_MAPS ? sampleGlobalGridAtLatLon(G_SUN_EXP_VALUES, latDeg, lonDeg) : 0,
          radioExp: HAS_EXPOSURE_MAPS ? sampleGlobalGridAtLatLon(G_RADIO_EXP_VALUES, latDeg, lonDeg) : 0,
        }});
        idx++;
      }}
    }}
  }}
  return tiles;
}})();


// ==============================================================================
// VIEW 1: GLOBAL LOW-RES 3D LUNAR SPHERE + 2,400 SQUARES
// ==============================================================================
const GlobalView = (() => {{
  const group = new THREE.Group();
  scene.add(group);

  const SCALE = 0.0001;
  const R_MOON_W = R_MOON_M * SCALE;
  const MAX_R_W = (R_MOON_M + GDATA.max_z * DATA.exaggeration) * SCALE;

  function latLonToWorldVec(latDeg, lonDeg, radiusW) {{
    const lat = THREE.MathUtils.degToRad(latDeg);
    const lon = THREE.MathUtils.degToRad(lonDeg);
    const cLat = Math.cos(lat);
    return new THREE.Vector3(
      radiusW * cLat * Math.cos(lon),
      radiusW * Math.sin(lat),
      -radiusW * cLat * Math.sin(lon)
    );
  }}

  const starCount = 2200;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {{
    const u = Math.random();
    const v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    const rStar = 3600;
    starPos[i * 3] = rStar * Math.sin(phi) * Math.cos(theta);
    starPos[i * 3 + 1] = rStar * Math.cos(phi);
    starPos[i * 3 + 2] = rStar * Math.sin(phi) * Math.sin(theta);
  }}
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  group.add(new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({{ color: 0xc9d1d9, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.75 }})
  ));

  const rows = G_ROWS;
  const cols = G_COLS;
  const meshCols = GDATA.is_full_globe ? cols + 1 : cols;
  const numVerts = rows * meshCols;

  const positions = new Float32Array(numVerts * 3);
  const heightColors = new Float32Array(numVerts * 3);
  const sunExpColors = HAS_EXPOSURE_MAPS ? new Float32Array(numVerts * 3) : null;
  const radioExpColors = HAS_EXPOSURE_MAPS ? new Float32Array(numVerts * 3) : null;
  const zRange = Math.max(1, GDATA.max_z - GDATA.min_z);

  for (let r = 0; r < rows; r++) {{
    const latDeg = rows > 1 ? GDATA.lat_max - (r / (rows - 1)) * G_LAT_SPAN : GDATA.lat_max;
    const latRad = THREE.MathUtils.degToRad(latDeg);
    const cosLat = Math.cos(latRad);
    const sinLat = Math.sin(latRad);

    for (let mc = 0; mc < meshCols; mc++) {{
      const srcCol = mc % cols;
      const lonDeg = GDATA.is_full_globe
        ? -180.0 + (mc / cols) * 360.0
        : (cols > 1 ? GDATA.lon_min + (mc / (cols - 1)) * G_LON_SPAN : GDATA.lon_min);
      const lonRad = THREE.MathUtils.degToRad(lonDeg);

      const gridIdx = r * cols + srcCol;
      const zVal = G_Z_VALUES[gridIdx];
      const radiusW = (R_MOON_M + zVal * DATA.exaggeration) * SCALE;

      const vIdx = r * meshCols + mc;
      const b3 = vIdx * 3;
      positions[b3] = radiusW * cosLat * Math.cos(lonRad);
      positions[b3 + 1] = radiusW * sinLat;
      positions[b3 + 2] = -radiusW * cosLat * Math.sin(lonRad);

      const hc = sampleStops((zVal - GDATA.min_z) / zRange, VIRIDIS_STOPS);
      heightColors[b3] = hc[0]; heightColors[b3 + 1] = hc[1]; heightColors[b3 + 2] = hc[2];

      if (HAS_EXPOSURE_MAPS) {{
        const sc = sampleStops(G_SUN_EXP_VALUES[gridIdx], SUN_EXP_STOPS);
        sunExpColors[b3] = sc[0]; sunExpColors[b3 + 1] = sc[1]; sunExpColors[b3 + 2] = sc[2];

        const rc = sampleStops(G_RADIO_EXP_VALUES[gridIdx], RADIO_EXP_STOPS);
        radioExpColors[b3] = rc[0]; radioExpColors[b3 + 1] = rc[1]; radioExpColors[b3 + 2] = rc[2];
      }}
    }}
  }}

  const indices = new Uint32Array((rows - 1) * (meshCols - 1) * 6);
  let iPtr = 0;
  for (let r = 0; r < rows - 1; r++) {{
    for (let c = 0; c < meshCols - 1; c++) {{
      const a = r * meshCols + c;
      const b = (r + 1) * meshCols + c;
      const d = r * meshCols + (c + 1);
      const e = (r + 1) * meshCols + (c + 1);
      indices[iPtr++] = a; indices[iPtr++] = b; indices[iPtr++] = d;
      indices[iPtr++] = b; indices[iPtr++] = e; indices[iPtr++] = d;
    }}
  }}

  const colorAttr = new THREE.BufferAttribute(new Float32Array(heightColors), 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', colorAttr);
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();

  if (GDATA.is_full_globe) {{
    const normAttr = geometry.attributes.normal.array;
    for (let r = 0; r < rows; r++) {{
      const i0 = (r * meshCols) * 3;
      const i1 = (r * meshCols + cols) * 3;
      const nx = normAttr[i0] + normAttr[i1];
      const ny = normAttr[i0 + 1] + normAttr[i1 + 1];
      const nz = normAttr[i0 + 2] + normAttr[i1 + 2];
      const len = Math.hypot(nx, ny, nz) || 1;
      normAttr[i0] = normAttr[i1] = nx / len;
      normAttr[i0 + 1] = normAttr[i1 + 1] = ny / len;
      normAttr[i0 + 2] = normAttr[i1 + 2] = nz / len;
    }}
    geometry.attributes.normal.needsUpdate = true;
  }}

  const shadowMaterial = new THREE.MeshStandardMaterial({{
    color: 0xc2c6cc,
    roughness: 0.96,
    metalness: 0.0
  }});

  const dataMapMaterial = new THREE.MeshStandardMaterial({{
    vertexColors: true,
    roughness: 0.95,
    metalness: 0.0,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1
  }});

  const terrainMesh = new THREE.Mesh(geometry, shadowMaterial);
  terrainMesh.castShadow = true;
  terrainMesh.receiveShadow = true;
  group.add(terrainMesh);

  let showTileGrid = true;
  const halfTileKm = DATA.tile_size_km * 0.5;
  const edgeSegs = 4;

  function buildTileBorderPts(tile, liftW) {{
    const pts = new Float32Array(4 * edgeSegs * 6);
    let ptr = 0;
    const pushSeg = (x0, y0, x1, y1) => {{
      for (let i = 0; i < edgeSegs; i++) {{
        const t0 = i / edgeSegs;
        const t1 = (i + 1) / edgeSegs;
        const u0 = tileKmToMoonUnit(tile.basis, x0 + (x1 - x0) * t0, y0 + (y1 - y0) * t0);
        const u1 = tileKmToMoonUnit(tile.basis, x0 + (x1 - x0) * t1, y0 + (y1 - y0) * t1);
        const ll0 = moonUnitToLatLon(u0);
        const ll1 = moonUnitToLatLon(u1);
        const r0 = (R_MOON_M + getElevationMetersAtLatLon(ll0.latDeg, ll0.lonDeg) * DATA.exaggeration) * SCALE + liftW;
        const r1 = (R_MOON_M + getElevationMetersAtLatLon(ll1.latDeg, ll1.lonDeg) * DATA.exaggeration) * SCALE + liftW;
        const p0 = moonUnitToThreeVec(u0, r0);
        const p1 = moonUnitToThreeVec(u1, r1);
        pts[ptr++] = p0.x; pts[ptr++] = p0.y; pts[ptr++] = p0.z;
        pts[ptr++] = p1.x; pts[ptr++] = p1.y; pts[ptr++] = p1.z;
      }}
    }};
    pushSeg(-halfTileKm, -halfTileKm,  halfTileKm, -halfTileKm);
    pushSeg( halfTileKm, -halfTileKm,  halfTileKm,  halfTileKm);
    pushSeg( halfTileKm,  halfTileKm, -halfTileKm,  halfTileKm);
    pushSeg(-halfTileKm,  halfTileKm, -halfTileKm, -halfTileKm);
    return pts;
  }}

  const allTilePts = new Float32Array(LUNAR_TILES.length * 96);
  for (let i = 0; i < LUNAR_TILES.length; i++) {{
    const pts = buildTileBorderPts(LUNAR_TILES[i], 0.16);
    LUNAR_TILES[i].hoverPts = buildTileBorderPts(LUNAR_TILES[i], 0.34);
    allTilePts.set(pts, i * 96);
  }}

  const tileGridGeo = new THREE.BufferGeometry();
  tileGridGeo.setAttribute('position', new THREE.BufferAttribute(allTilePts, 3));
  const tileGridLines = new THREE.LineSegments(
    tileGridGeo,
    new THREE.LineBasicMaterial({{ color: 0x79c0ff, transparent: true, opacity: 0.28 }})
  );
  group.add(tileGridLines);

  const hoverTileGeo = new THREE.BufferGeometry();
  hoverTileGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(96), 3));
  const hoverTileLines = new THREE.LineSegments(
    hoverTileGeo,
    new THREE.LineBasicMaterial({{ color: 0xffd43b, transparent: true, opacity: 1.0 }})
  );
  hoverTileLines.visible = false;
  group.add(hoverTileLines);

  const selectedTileGeo = new THREE.BufferGeometry();
  selectedTileGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(96), 3));
  const selectedTileLines = new THREE.LineSegments(
    selectedTileGeo,
    new THREE.LineBasicMaterial({{ color: 0x00f5d4, transparent: true, opacity: 0.95 }})
  );
  group.add(selectedTileLines);

  let hoveredTileIdx = -1;
  function setHoveredTile(tileIdx) {{
    if (tileIdx === hoveredTileIdx) return;
    hoveredTileIdx = tileIdx;
    if (tileIdx >= 0) {{
      hoverTileGeo.attributes.position.array.set(LUNAR_TILES[tileIdx].hoverPts);
      hoverTileGeo.attributes.position.needsUpdate = true;
      hoverTileLines.visible = true;
    }} else {{
      hoverTileLines.visible = false;
    }}
  }}

  const degPerRow = G_LAT_SPAN / Math.max(1, rows - 1);
  const degPerCol = GDATA.is_full_globe ? (360.0 / cols) : (G_LON_SPAN / Math.max(1, cols - 1));
  const angularStepDeg = Math.min(degPerRow, degPerCol) * 0.5;
  const worldMarchStep = THREE.MathUtils.degToRad(angularStepDeg) * R_MOON_W;

  function worldVecToLatLonElev(pt) {{
    const r = pt.length();
    const latDeg = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(pt.y / Math.max(1e-9, r), -1, 1)));
    const lonDeg = THREE.MathUtils.radToDeg(Math.atan2(-pt.z, pt.x));
    const elevM = getElevationMetersAtLatLon(latDeg, lonDeg);
    return {{ latDeg, lonDeg, elevM, surfaceR: (R_MOON_M + elevM * DATA.exaggeration) * SCALE }};
  }}

  function getSmoothSphereNormalAt(latDeg, lonDeg, targetVec) {{
    const eps = angularStepDeg * 0.9;
    const latN = Math.min(89.95, latDeg + eps);
    const latS = Math.max(-89.95, latDeg - eps);
    const cosLat = Math.max(0.05, Math.cos(THREE.MathUtils.degToRad(latDeg)));
    const lonEps = eps / cosLat;

    const rN = (R_MOON_M + getElevationMetersAtLatLon(latN, lonDeg) * DATA.exaggeration) * SCALE;
    const rS = (R_MOON_M + getElevationMetersAtLatLon(latS, lonDeg) * DATA.exaggeration) * SCALE;
    const rE = (R_MOON_M + getElevationMetersAtLatLon(latDeg, lonDeg + lonEps) * DATA.exaggeration) * SCALE;
    const rW = (R_MOON_M + getElevationMetersAtLatLon(latDeg, lonDeg - lonEps) * DATA.exaggeration) * SCALE;

    const pN = latLonToWorldVec(latN, lonDeg, rN);
    const pS = latLonToWorldVec(latS, lonDeg, rS);
    const pE = latLonToWorldVec(latDeg, lonDeg + lonEps, rE);
    const pW = latLonToWorldVec(latDeg, lonDeg - lonEps, rW);

    return targetVec.crossVectors(pE.sub(pW), pN.sub(pS)).normalize();
  }}

  const _rayOrigin = new THREE.Vector3();
  const _rayDir = new THREE.Vector3();
  const _tmpPt = new THREE.Vector3();

  function raycastLunarSphere(ndcX, ndcY, outPoint, outNormal, outInfo) {{
    _rayOrigin.setFromMatrixPosition(camera.matrixWorld);
    _rayDir.set(ndcX, ndcY, 0.5).unproject(camera).sub(_rayOrigin).normalize();

    const b = _rayOrigin.dot(_rayDir);
    const c = _rayOrigin.lengthSq() - MAX_R_W * MAX_R_W;
    const disc = b * b - c;
    if (disc < 0) return false;

    const sqrtDisc = Math.sqrt(disc);
    const tMin = Math.max(0.0, -b - sqrtDisc);
    const tMax = -b + sqrtDisc;
    if (tMax < tMin) return false;

    let prevT = tMin;
    for (let t = tMin; t <= tMax; t += worldMarchStep) {{
      _tmpPt.copy(_rayOrigin).addScaledVector(_rayDir, t);
      const info = worldVecToLatLonElev(_tmpPt);
      if (_tmpPt.length() <= info.surfaceR) {{
        let lo = prevT;
        let hi = t;
        for (let k = 0; k < 7; k++) {{
          const mid = (lo + hi) * 0.5;
          _tmpPt.copy(_rayOrigin).addScaledVector(_rayDir, mid);
          const midInfo = worldVecToLatLonElev(_tmpPt);
          if (_tmpPt.length() <= midInfo.surfaceR) hi = mid;
          else lo = mid;
        }}
        const hitT = (lo + hi) * 0.5;
        _tmpPt.copy(_rayOrigin).addScaledVector(_rayDir, hitT);
        const hitInfo = worldVecToLatLonElev(_tmpPt);
        outPoint.copy(latLonToWorldVec(hitInfo.latDeg, hitInfo.lonDeg, hitInfo.surfaceR));
        getSmoothSphereNormalAt(hitInfo.latDeg, hitInfo.lonDeg, outNormal);
        if (outInfo) Object.assign(outInfo, hitInfo);
        return true;
      }}
      prevT = t;
    }}
    return false;
  }}

  function findTileIndexAtWorldPoint(worldPt) {{
    const len = worldPt.length() || 1;
    const moonU = new THREE.Vector3(worldPt.x / len, -worldPt.z / len, worldPt.y / len);
    let bestIdx = -1;
    let bestDistSq = Infinity;

    for (let i = 0; i < LUNAR_TILES.length; i++) {{
      const t = LUNAR_TILES[i];
      if (moonU.dot(t.centerMoon) < 0.990) continue;
      const xy = moonUnitToTileKm(t.basis, moonU);
      if (xy && Math.abs(xy[0]) <= halfTileKm && Math.abs(xy[1]) <= halfTileKm) {{
        const d2 = xy[0] * xy[0] + xy[1] * xy[1];
        if (d2 < bestDistSq) {{
          bestDistSq = d2;
          bestIdx = i;
        }}
      }}
    }}
    return bestIdx;
  }}

  let showGraticule = true;
  const graticuleGroup = new THREE.Group();
  group.add(graticuleGroup);

  (function buildSphereGraticule() {{
    const regularPts = [];
    const majorPts = [];
    const lift = 0.14;

    for (let lat = -60; lat <= 60; lat += 30) {{
      const targetArr = lat === 0 ? majorPts : regularPts;
      for (let lon = -180; lon < 180; lon += 2) {{
        const r0 = (R_MOON_M + getElevationMetersAtLatLon(lat, lon) * DATA.exaggeration) * SCALE + lift;
        const r1 = (R_MOON_M + getElevationMetersAtLatLon(lat, lon + 2) * DATA.exaggeration) * SCALE + lift;
        const p0 = latLonToWorldVec(lat, lon, r0);
        const p1 = latLonToWorldVec(lat, lon + 2, r1);
        targetArr.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
      }}
    }}

    for (let lon = -180; lon < 180; lon += 30) {{
      const targetArr = lon === 0 ? majorPts : regularPts;
      for (let lat = -90; lat < 90; lat += 2) {{
        const r0 = (R_MOON_M + getElevationMetersAtLatLon(lat, lon) * DATA.exaggeration) * SCALE + lift;
        const r1 = (R_MOON_M + getElevationMetersAtLatLon(lat + 2, lon) * DATA.exaggeration) * SCALE + lift;
        const p0 = latLonToWorldVec(lat, lon, r0);
        const p1 = latLonToWorldVec(lat + 2, lon, r1);
        targetArr.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
      }}
    }}

    const regGeo = new THREE.BufferGeometry();
    regGeo.setAttribute('position', new THREE.Float32BufferAttribute(regularPts, 3));
    graticuleGroup.add(new THREE.LineSegments(
      regGeo,
      new THREE.LineBasicMaterial({{ color: 0x6e8bb8, transparent: true, opacity: 0.20 }})
    ));

    const majGeo = new THREE.BufferGeometry();
    majGeo.setAttribute('position', new THREE.Float32BufferAttribute(majorPts, 3));
    graticuleGroup.add(new THREE.LineSegments(
      majGeo,
      new THREE.LineBasicMaterial({{ color: 0x58a6ff, transparent: true, opacity: 0.42 }})
    ));
  }})();

  let showSurfaceContours = true;
  let currentContourInterval = 1000;
  const surfaceContoursMesh = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({{ vertexColors: true, transparent: true, opacity: 0.75 }})
  );
  surfaceContoursMesh.visible = false;
  group.add(surfaceContoursMesh);

  function rebuildSurfaceContours(intervalMeters) {{
    const firstIso = Math.ceil(GDATA.min_z / intervalMeters) * intervalMeters;
    const levels = [];
    for (let z = firstIso; z <= GDATA.max_z; z += intervalMeters) {{
      levels.push(Math.round(z * 1000) / 1000);
    }}

    const segPositions = [];
    const segColors = [];
    const lift = 0.08;

    function traceSphereTriangle(i0, h0, i1, h1, i2, h2, isoZ, targetR, cr, cg, cb) {{
      let count = 0;
      let p0x = 0, p0y = 0, p0z = 0;
      let p1x = 0, p1y = 0, p1z = 0;

      const interpAndProject = (idxA, hA, idxB, hB) => {{
        const d = hB - hA;
        const t = Math.abs(d) < 1e-9 ? 0.5 : (isoZ - hA) / d;
        const vx = positions[idxA * 3] + t * (positions[idxB * 3] - positions[idxA * 3]);
        const vy = positions[idxA * 3 + 1] + t * (positions[idxB * 3 + 1] - positions[idxA * 3 + 1]);
        const vz = positions[idxA * 3 + 2] + t * (positions[idxB * 3 + 2] - positions[idxA * 3 + 2]);
        const len = Math.hypot(vx, vy, vz) || 1;
        const s = targetR / len;
        return [vx * s, vy * s, vz * s];
      }};

      if ((h0 < isoZ && h1 >= isoZ) || (h1 < isoZ && h0 >= isoZ)) {{
        [p0x, p0y, p0z] = interpAndProject(i0, h0, i1, h1);
        count = 1;
      }}
      if ((h1 < isoZ && h2 >= isoZ) || (h2 < isoZ && h1 >= isoZ)) {{
        const p = interpAndProject(i1, h1, i2, h2);
        if (count === 0) {{ [p0x, p0y, p0z] = p; }} else {{ [p1x, p1y, p1z] = p; }}
        count++;
      }}
      if (count < 2 && ((h2 < isoZ && h0 >= isoZ) || (h0 < isoZ && h2 >= isoZ))) {{
        [p1x, p1y, p1z] = interpAndProject(i2, h2, i0, h0);
        count++;
      }}

      if (count === 2) {{
        segPositions.push(p0x, p0y, p0z, p1x, p1y, p1z);
        segColors.push(cr, cg, cb, cr, cg, cb);
      }}
    }}

    for (let r = 0; r < rows - 1; r++) {{
      const rowOff0 = r * cols;
      const rowOff1 = (r + 1) * cols;
      const vRow0 = r * meshCols;
      const vRow1 = (r + 1) * meshCols;

      for (let c = 0; c < meshCols - 1; c++) {{
        const sc0 = c % cols;
        const sc1 = (c + 1) % cols;
        const h00 = G_Z_VALUES[rowOff0 + sc0];
        const h10 = G_Z_VALUES[rowOff0 + sc1];
        const h01 = G_Z_VALUES[rowOff1 + sc0];
        const h11 = G_Z_VALUES[rowOff1 + sc1];

        const qMin = Math.min(h00, h10, h01, h11);
        const qMax = Math.max(h00, h10, h01, h11);
        if (qMax - qMin < 1e-6) continue;

        const v00 = vRow0 + c;
        const v10 = vRow0 + c + 1;
        const v01 = vRow1 + c;
        const v11 = vRow1 + c + 1;

        for (let i = 0; i < levels.length; i++) {{
          const isoZ = levels[i];
          if (isoZ < qMin || isoZ > qMax) continue;

          const targetR = (R_MOON_M + isoZ * DATA.exaggeration) * SCALE + lift;
          const frac = (isoZ - GDATA.min_z) / zRange;
          const isMajor = Math.abs(isoZ % (intervalMeters * 4)) < 1e-3;

          let cr, cg, cb;
          if (frac < 0.25) {{
            cr = isMajor ? 0.96 : 0.78;
            cg = isMajor ? 0.98 : 0.84;
            cb = isMajor ? 1.00 : 0.92;
          }} else {{
            cr = isMajor ? 0.02 : 0.06;
            cg = isMajor ? 0.03 : 0.08;
            cb = isMajor ? 0.05 : 0.12;
          }}

          traceSphereTriangle(v00, h00, v01, h01, v10, h10, isoZ, targetR, cr, cg, cb);
          traceSphereTriangle(v01, h01, v11, h11, v10, h10, isoZ, targetR, cr, cg, cb);
        }}
      }}
    }}

    const newGeo = new THREE.BufferGeometry();
    newGeo.setAttribute('position', new THREE.Float32BufferAttribute(segPositions, 3));
    newGeo.setAttribute('color', new THREE.Float32BufferAttribute(segColors, 3));
    surfaceContoursMesh.geometry.dispose();
    surfaceContoursMesh.geometry = newGeo;
    return levels.length;
  }}
  rebuildSurfaceContours(currentContourInterval);

  const sunLight = new THREE.DirectionalLight(0xfff8e7, 3.3);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 4096;
  sunLight.shadow.mapSize.height = 4096;
  sunLight.shadow.bias = -0.00025;
  sunLight.shadow.normalBias = 0.03;

  const shadowBounds = MAX_R_W * 1.03;
  sunLight.shadow.camera.left = -shadowBounds;
  sunLight.shadow.camera.right = shadowBounds;
  sunLight.shadow.camera.top = shadowBounds;
  sunLight.shadow.camera.bottom = -shadowBounds;
  sunLight.shadow.camera.near = R_MOON_W * 0.4;
  sunLight.shadow.camera.far = R_MOON_W * 3.8;
  sunLight.shadow.camera.updateProjectionMatrix();
  group.add(sunLight);
  group.add(sunLight.target);

  const skyRadius = R_MOON_W * 1.85;
  const sunSkyPositions = new Float32Array(TOTAL_STEPS * 3);
  const earthSkyPositions = new Float32Array(TOTAL_STEPS * 3);
  for (let i = 0; i < TOTAL_STEPS; i++) {{
    const b = i * 3;
    sunSkyPositions[b] = SUN_DIRS[b] * skyRadius;
    sunSkyPositions[b + 1] = SUN_DIRS[b + 1] * skyRadius;
    sunSkyPositions[b + 2] = SUN_DIRS[b + 2] * skyRadius;
    earthSkyPositions[b] = EARTH_DIRS[b] * skyRadius;
    earthSkyPositions[b + 1] = EARTH_DIRS[b + 1] * skyRadius;
    earthSkyPositions[b + 2] = EARTH_DIRS[b + 2] * skyRadius;
  }}

  const sunMarker = new THREE.Group();
  const sunCore = new THREE.Mesh(new THREE.SphereGeometry(5.5, 24, 24), new THREE.MeshBasicMaterial({{ color: 0xffd43b }}));
  const sunHalo = new THREE.Mesh(new THREE.SphereGeometry(9.2, 24, 24), new THREE.MeshBasicMaterial({{ color: 0xffb703, transparent: true, opacity: 0.25 }}));
  const sunTag = makeMultiLineSprite(['SUN (JPL)'], {{ fontSize: 22, color: '#ffd43b', width: 220, height: 60, scaleW: 24 }});
  sunTag.position.y = 14.0;
  sunMarker.add(sunCore, sunHalo, sunTag);
  group.add(sunMarker);

  const sunBeamGeo = new THREE.BufferGeometry();
  const sunBeamArr = new Float32Array(6);
  sunBeamGeo.setAttribute('position', new THREE.BufferAttribute(sunBeamArr, 3));
  const sunBeam = new THREE.Line(
    sunBeamGeo,
    new THREE.LineDashedMaterial({{ color: 0xffd43b, dashSize: 5, gapSize: 3, transparent: true, opacity: 0.45 }})
  );
  group.add(sunBeam);

  const earthMarker = new THREE.Group();
  const earthCore = new THREE.Mesh(new THREE.SphereGeometry(4.2, 20, 20), new THREE.MeshBasicMaterial({{ color: 0x4dabf7 }}));
  const earthTag = makeMultiLineSprite(['EARTH (JPL)'], {{ fontSize: 20, color: '#74c0fc', width: 240, height: 60, scaleW: 26 }});
  earthTag.position.y = 11.5;
  earthMarker.add(earthCore, earthTag);
  group.add(earthMarker);

  const earthBeamGeo = new THREE.BufferGeometry();
  const earthBeamArr = new Float32Array(6);
  earthBeamGeo.setAttribute('position', new THREE.BufferAttribute(earthBeamArr, 3));
  const earthBeam = new THREE.Line(
    earthBeamGeo,
    new THREE.LineDashedMaterial({{ color: 0x4dabf7, dashSize: 4, gapSize: 4, transparent: true, opacity: 0.35 }})
  );
  group.add(earthBeam);

  const _zAxis = new THREE.Vector3(0, 0, 1);
  const subSolarDot = new THREE.Mesh(
    new THREE.RingGeometry(1.6, 2.7, 24),
    new THREE.MeshBasicMaterial({{ color: 0xffd43b, side: THREE.DoubleSide }})
  );
  group.add(subSolarDot);

  const subEarthDot = new THREE.Mesh(
    new THREE.RingGeometry(1.8, 3.0, 24),
    new THREE.MeshBasicMaterial({{ color: 0x00f5d4, side: THREE.DoubleSide }})
  );
  group.add(subEarthDot);

  const annualPathPts = [];
  for (let i = 0; i < TOTAL_STEPS; i += 4) {{
    annualPathPts.push(new THREE.Vector3(sunSkyPositions[i * 3], sunSkyPositions[i * 3 + 1], sunSkyPositions[i * 3 + 2]));
  }}
  const annualSunTrail = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(annualPathPts),
    new THREE.LineBasicMaterial({{ color: 0xffb703, transparent: true, opacity: 0.16 }})
  );
  group.add(annualSunTrail);

  const LUNAR_DAY_HOURS = 709;
  const activeDayGeo = new THREE.BufferGeometry();
  activeDayGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LUNAR_DAY_HOURS * 3), 3));
  const activeDayTrail = new THREE.Line(
    activeDayGeo,
    new THREE.LineBasicMaterial({{ color: 0xffd43b, transparent: true, opacity: 0.72 }})
  );
  group.add(activeDayTrail);

  const earthPathPts = [];
  for (let i = 0; i < TOTAL_STEPS; i += 4) {{
    earthPathPts.push(new THREE.Vector3(earthSkyPositions[i * 3], earthSkyPositions[i * 3 + 1], earthSkyPositions[i * 3 + 2]));
  }}
  const earthTrail = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(earthPathPts),
    new THREE.LineBasicMaterial({{ color: 0x4dabf7, transparent: true, opacity: 0.35 }})
  );
  group.add(earthTrail);

  let selectedTileIdx = 0;
  const siteOrigin = new THREE.Vector3();
  const siteUpDir = new THREE.Vector3();
  const siteEastDir = new THREE.Vector3();
  const siteNorthDir = new THREE.Vector3();
  const horizonProfile = new Float32Array(360);
  const hourlySunLit = new Uint8Array(TOTAL_STEPS);
  let statsSummary = {{ sunPct: '0%', radioPct: '0%', maxEclipse: '0 h' }};

  function computeLocalAzEl(dirVec, eastVec, northVec, upVec) {{
    const e = dirVec.dot(eastVec);
    const n = dirVec.dot(northVec);
    const u = THREE.MathUtils.clamp(dirVec.dot(upVec), -1, 1);
    return {{
      azDeg: (THREE.MathUtils.radToDeg(Math.atan2(e, n)) + 360.0) % 360.0,
      elDeg: THREE.MathUtils.radToDeg(Math.asin(u))
    }};
  }}

  function getHorizonAngleAtAz(azDeg) {{
    const norm = ((azDeg % 360) + 360) % 360;
    const i0 = norm | 0;
    const i1 = (i0 + 1) % 360;
    const f = norm - i0;
    return horizonProfile[i0] * (1 - f) + horizonProfile[i1] * f;
  }}

  const DISK_OFFSETS_DEG = [[0, 0]];
  for (let k = 0; k < 6; k++) {{
    const ang = (k / 6) * Math.PI * 2;
    const r = SOLAR_ANGULAR_RADIUS_DEG * 0.78;
    DISK_OFFSETS_DEG.push([Math.cos(ang) * r, Math.sin(ang) * r]);
  }}

  function computeSiteSolarDiskFraction(sAz, sEl) {{
    if (sEl <= -SOLAR_ANGULAR_RADIUS_DEG) return 0.0;
    let visibleSamples = 0;
    for (let i = 0; i < 7; i++) {{
      if ((sEl + DISK_OFFSETS_DEG[i][1]) > getHorizonAngleAtAz(sAz + DISK_OFFSETS_DEG[i][0])) {{
        visibleSamples++;
      }}
    }}
    return visibleSamples / 7;
  }}

  const _dirTmp = new THREE.Vector3();
  const _rayTmp = new THREE.Vector3();

  function setSelectedTile(tileIdx) {{
    selectedTileIdx = tileIdx;
    const tile = LUNAR_TILES[tileIdx];

    selectedTileGeo.attributes.position.array.set(tile.hoverPts);
    selectedTileGeo.attributes.position.needsUpdate = true;

    const surfR = (R_MOON_M + tile.centerElevM * DATA.exaggeration) * SCALE;
    siteOrigin.copy(latLonToWorldVec(tile.lat, tile.lon, surfR + 0.05));
    siteUpDir.copy(siteOrigin).normalize();

    const lonRad = THREE.MathUtils.degToRad(tile.lon);
    const latRad = THREE.MathUtils.degToRad(tile.lat);
    siteEastDir.set(-Math.sin(lonRad), 0, -Math.cos(lonRad)).normalize();
    siteNorthDir.set(
      -Math.sin(latRad) * Math.cos(lonRad),
      Math.cos(latRad),
      Math.sin(latRad) * Math.sin(lonRad)
    ).normalize();

    sunBeamArr[3] = siteOrigin.x; sunBeamArr[4] = siteOrigin.y; sunBeamArr[5] = siteOrigin.z;
    earthBeamArr[3] = siteOrigin.x; earthBeamArr[4] = siteOrigin.y; earthBeamArr[5] = siteOrigin.z;

    const maxCheckDist = R_MOON_W * 0.45;
    const stepDist = worldMarchStep * 0.85;
    const numSteps = Math.floor(maxCheckDist / stepDist);

    for (let deg = 0; deg < 360; deg++) {{
      const azRad = THREE.MathUtils.degToRad(deg);
      const horizDirX = Math.sin(azRad) * siteEastDir.x + Math.cos(azRad) * siteNorthDir.x;
      const horizDirY = Math.sin(azRad) * siteEastDir.y + Math.cos(azRad) * siteNorthDir.y;
      const horizDirZ = Math.sin(azRad) * siteEastDir.z + Math.cos(azRad) * siteNorthDir.z;

      let maxAngleDeg = -90.0;
      const r0 = siteOrigin.length();

      for (let s = 2; s <= numSteps; s++) {{
        const d = s * stepDist;
        _rayTmp.set(siteOrigin.x + horizDirX * d, siteOrigin.y + horizDirY * d, siteOrigin.z + horizDirZ * d);
        const rSample = _rayTmp.length();
        const sLat = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(_rayTmp.y / rSample, -1, 1)));
        const sLon = THREE.MathUtils.radToDeg(Math.atan2(-_rayTmp.z, _rayTmp.x));
        const terrainR = (R_MOON_M + getElevationMetersAtLatLon(sLat, sLon) * DATA.exaggeration) * SCALE;

        const cosPsi = THREE.MathUtils.clamp(_rayTmp.dot(siteOrigin) / (rSample * r0), -1, 1);
        const sinPsi = Math.sqrt(Math.max(0, 1 - cosPsi * cosPsi));
        const elevDeg = THREE.MathUtils.radToDeg(Math.atan2(terrainR * cosPsi - r0, terrainR * sinPsi));
        if (elevDeg > maxAngleDeg) maxAngleDeg = elevDeg;
      }}
      horizonProfile[deg] = maxAngleDeg;
    }}

    let sunlitHours = 0;
    let radioHours = 0;
    let currentEclipseStreak = 0;
    let longestEclipseHours = 0;

    for (let i = 0; i < TOTAL_STEPS; i++) {{
      const b = i * 3;
      _dirTmp.set(SUN_DIRS[b], SUN_DIRS[b + 1], SUN_DIRS[b + 2]);
      const {{ azDeg, elDeg }} = computeLocalAzEl(_dirTmp, siteEastDir, siteNorthDir, siteUpDir);
      const isLit = (elDeg + SOLAR_ANGULAR_RADIUS_DEG) > getHorizonAngleAtAz(azDeg) ? 1 : 0;
      hourlySunLit[i] = isLit;
      if (isLit) {{
        sunlitHours++;
        currentEclipseStreak = 0;
      }} else {{
        currentEclipseStreak++;
        if (currentEclipseStreak > longestEclipseHours) longestEclipseHours = currentEclipseStreak;
      }}

      _dirTmp.set(EARTH_DIRS[b], EARTH_DIRS[b + 1], EARTH_DIRS[b + 2]);
      const eLocal = computeLocalAzEl(_dirTmp, siteEastDir, siteNorthDir, siteUpDir);
      if ((eLocal.elDeg + 0.95) > getHorizonAngleAtAz(eLocal.azDeg)) radioHours++;
    }}

    statsSummary = {{
      sunPct: `${{((sunlitHours / TOTAL_STEPS) * 100).toFixed(1)}}%`,
      radioPct: `${{((radioHours / TOTAL_STEPS) * 100).toFixed(1)}}%`,
      maxEclipse: `${{longestEclipseHours}} h`
    }};
  }}

  const defaultSouthIdx = LUNAR_TILES.reduce(
    (best, t, i) => (t.lat < LUNAR_TILES[best].lat ? i : best),
    0
  );
  setSelectedTile(defaultSouthIdx);

  let mapMode = 'shadow';

  function setMapMode(mode) {{
    if (!HAS_EXPOSURE_MAPS && (mode === 'sunexp' || mode === 'radio')) {{
      mode = 'shadow';
    }}
    mapMode = mode;
    if (mode === 'shadow') {{
      terrainMesh.material = shadowMaterial;
      terrainMesh.castShadow = true;
      terrainMesh.receiveShadow = true;
      sunLight.castShadow = true;
      sunLight.intensity = 3.3;
      ambientLight.intensity = 0.04;
      mapReliefLight.intensity = 0.0;

      sunMarker.visible = true;
      sunBeam.visible = true;
      earthMarker.visible = true;
      earthBeam.visible = true;
      subSolarDot.visible = true;
      subEarthDot.visible = false;
      annualSunTrail.visible = true;
      activeDayTrail.visible = true;
      earthTrail.visible = true;
      surfaceContoursMesh.visible = false;
    }} else {{
      if (mode === 'height') colorAttr.array.set(heightColors);
      else if (mode === 'sunexp' && sunExpColors) colorAttr.array.set(sunExpColors);
      else if (mode === 'radio' && radioExpColors) colorAttr.array.set(radioExpColors);
      colorAttr.needsUpdate = true;

      terrainMesh.material = dataMapMaterial;
      terrainMesh.castShadow = false;
      terrainMesh.receiveShadow = false;
      sunLight.castShadow = false;
      sunLight.intensity = 0.0;
      ambientLight.intensity = 1.95;
      mapReliefLight.intensity = 0.72;

      sunMarker.visible = false;
      sunBeam.visible = false;
      earthMarker.visible = (mode === 'radio');
      earthBeam.visible = (mode === 'radio');
      subSolarDot.visible = false;
      subEarthDot.visible = (mode === 'radio');
      annualSunTrail.visible = false;
      activeDayTrail.visible = false;
      earthTrail.visible = (mode === 'radio');
      surfaceContoursMesh.visible = (mode === 'height') && showSurfaceContours;
    }}
  }}

  const _sunVec = new THREE.Vector3();
  const _earthVec = new THREE.Vector3();

  function applyStep(idx) {{
    const baseIdx = idx * 3;
    const sx = sunSkyPositions[baseIdx];
    const sy = sunSkyPositions[baseIdx + 1];
    const sz = sunSkyPositions[baseIdx + 2];

    sunMarker.position.set(sx, sy, sz);
    sunLight.position.set(sx * 1.15, sy * 1.15, sz * 1.15);

    _sunVec.set(SUN_DIRS[baseIdx], SUN_DIRS[baseIdx + 1], SUN_DIRS[baseIdx + 2]).normalize();
    _earthVec.set(EARTH_DIRS[baseIdx], EARTH_DIRS[baseIdx + 1], EARTH_DIRS[baseIdx + 2]).normalize();

    const ssInfo = worldVecToLatLonElev(_sunVec);
    subSolarDot.position.copy(latLonToWorldVec(ssInfo.latDeg, ssInfo.lonDeg, ssInfo.surfaceR + 0.25));
    subSolarDot.quaternion.setFromUnitVectors(_zAxis, _sunVec);

    const seInfo = worldVecToLatLonElev(_earthVec);
    subEarthDot.position.copy(latLonToWorldVec(seInfo.latDeg, seInfo.lonDeg, seInfo.surfaceR + 0.28));
    subEarthDot.quaternion.setFromUnitVectors(_zAxis, _earthVec);

    if (mapMode === 'shadow' && group.visible) {{
      sunLight.intensity = 3.3;
      renderer.shadowMap.needsUpdate = true;
    }}

    sunBeamArr[0] = sx; sunBeamArr[1] = sy; sunBeamArr[2] = sz;
    sunBeamGeo.attributes.position.needsUpdate = true;
    sunBeam.computeLineDistances();

    const ex = earthSkyPositions[baseIdx];
    const ey = earthSkyPositions[baseIdx + 1];
    const ez = earthSkyPositions[baseIdx + 2];
    earthMarker.position.set(ex, ey, ez);

    earthBeamArr[0] = ex; earthBeamArr[1] = ey; earthBeamArr[2] = ez;
    earthBeamGeo.attributes.position.needsUpdate = true;
    earthBeam.computeLineDistances();

    const halfWindow = LUNAR_DAY_HOURS >> 1;
    const startW = Math.max(0, idx - halfWindow);
    const endW = Math.min(TOTAL_STEPS - 1, startW + LUNAR_DAY_HOURS - 1);
    const count = endW - startW + 1;
    const trailArr = activeDayGeo.attributes.position.array;
    trailArr.set(sunSkyPositions.subarray(startW * 3, (endW + 1) * 3), 0);
    if (count < LUNAR_DAY_HOURS) {{
      const lx = sunSkyPositions[endW * 3];
      const ly = sunSkyPositions[endW * 3 + 1];
      const lz = sunSkyPositions[endW * 3 + 2];
      for (let k = count; k < LUNAR_DAY_HOURS; k++) {{
        trailArr[k * 3] = lx; trailArr[k * 3 + 1] = ly; trailArr[k * 3 + 2] = lz;
      }}
    }}
    activeDayGeo.attributes.position.needsUpdate = true;

    const localSun = computeLocalAzEl(_sunVec, siteEastDir, siteNorthDir, siteUpDir);
    const localEarth = computeLocalAzEl(_earthVec, siteEastDir, siteNorthDir, siteUpDir);
    const siteDiskPct = Math.round(computeSiteSolarDiskFraction(localSun.azDeg, localSun.elDeg) * 100);
    const dteClear = localEarth.elDeg > getHorizonAngleAtAz(localEarth.azDeg);

    return {{
      localSun,
      localEarth,
      siteDiskPct,
      dteClear,
      tile: LUNAR_TILES[selectedTileIdx],
      statsSummary
    }};
  }}

  const _sunDir = new THREE.Vector3();
  const _upRef = new THREE.Vector3();
  const _tangentU = new THREE.Vector3();
  const _tangentV = new THREE.Vector3();
  const _sampleDir = new THREE.Vector3();
  const _radialUp = new THREE.Vector3();

  function evaluateSurfaceIllumination(worldPt, smoothNormal) {{
    _sunDir.copy(sunLight.position).normalize();
    _radialUp.copy(worldPt).normalize();

    const slopeDeg = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(smoothNormal.dot(_radialUp), -1, 1)));
    const cosIncidence = smoothNormal.dot(_sunDir);
    const incidenceDeg = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(cosIncidence, -1, 1)));
    const sunElevDeg = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(_radialUp.dot(_sunDir), -1, 1)));

    let unblocked = 0;
    if (_radialUp.dot(_sunDir) > -SOLAR_ANGULAR_RADIUS_RAD) {{
      if (Math.abs(_sunDir.y) < 0.99) _upRef.set(0, 1, 0);
      else _upRef.set(1, 0, 0);
      _tangentU.crossVectors(_upRef, _sunDir).normalize();
      _tangentV.crossVectors(_sunDir, _tangentU).normalize();

      const ox = worldPt.x + smoothNormal.x * 0.12;
      const oy = worldPt.y + smoothNormal.y * 0.12;
      const oz = worldPt.z + smoothNormal.z * 0.12;

      for (let i = 0; i < 7; i++) {{
        _sampleDir.copy(_sunDir);
        if (i > 0) {{
          const angle = ((i - 1) / 6) * Math.PI * 2;
          const offset = SOLAR_ANGULAR_RADIUS_RAD * 0.78;
          _sampleDir.addScaledVector(_tangentU, Math.cos(angle) * offset).addScaledVector(_tangentV, Math.sin(angle) * offset).normalize();
        }}
        if (_radialUp.dot(_sampleDir) <= 0 || smoothNormal.dot(_sampleDir) <= 0) continue;
        if (!isSphereTerrainOccluded(ox, oy, oz, _sampleDir.x, _sampleDir.y, _sampleDir.z)) unblocked++;
      }}
    }}

    const diskVisibleFrac = unblocked / 7;
    const geometricFactor = Math.max(0, cosIncidence);
    const effectiveIllum = diskVisibleFrac === 0 ? 0.0 : Math.max(geometricFactor * diskVisibleFrac, geometricFactor * diskVisibleFrac * 0.85);
    const illumPct = THREE.MathUtils.clamp(effectiveIllum * 100, 0, 100);
    const diskPct = Math.round(diskVisibleFrac * 100);
    const fluxWm2 = Math.round(SOLAR_CONSTANT_WM2 * effectiveIllum);

    let statusHtml;
    if (sunElevDeg <= -SOLAR_ANGULAR_RADIUS_DEG) statusHtml = '<span class="tt-shadow">🌑 Lunar Night (Below Horizon)</span>';
    else if (cosIncidence <= 0) statusHtml = '<span class="tt-shadow">🌑 Shadowed (Slope Faces Away)</span>';
    else if (diskPct === 0) statusHtml = '<span class="tt-shadow">🌑 Umbra Shadow (Blocked by Terrain)</span>';
    else if (diskPct < 100) statusHtml = `<span class="tt-partial">🌗 Penumbra (${{diskPct}}% Sun Disk)</span>`;
    else statusHtml = '<span class="tt-lit">☀️ Full Direct Sunlight</span>';

    return {{ statusHtml, illumPct, diskPct, fluxWm2, incidenceDeg, slopeDeg, sunElevDeg }};
  }}

  return {{
    group,
    R_MOON_W,
    siteOrigin,
    siteUpDir,
    latLonToWorldVec,
    getMapMode: () => mapMode,
    setMapMode,
    getShowTileGrid: () => showTileGrid,
    setShowTileGrid: (v) => {{ showTileGrid = v; tileGridLines.visible = v; }},
    getShowGraticule: () => showGraticule,
    setShowGraticule: (v) => {{ showGraticule = v; graticuleGroup.visible = v; }},
    getShowContours: () => showSurfaceContours,
    setShowContours: (v) => {{ showSurfaceContours = v; surfaceContoursMesh.visible = (mapMode === 'height') && v; }},
    getContourInterval: () => currentContourInterval,
    setContourInterval: (iv) => {{ currentContourInterval = iv; return rebuildSurfaceContours(iv); }},
    hourlySunLit,
    setSelectedTile,
    getSelectedTileIdx: () => selectedTileIdx,
    getSelectedTile: () => LUNAR_TILES[selectedTileIdx],
    setHoveredTile,
    applyStep,
    raycastLunarSphere,
    findTileIndexAtWorldPoint,
    evaluateSurfaceIllumination,
    sampleSunExp: (lat, lon) => sampleGlobalGridAtLatLon(G_SUN_EXP_VALUES, lat, lon),
    sampleRadioExp: (lat, lon) => sampleGlobalGridAtLatLon(G_RADIO_EXP_VALUES, lat, lon),
    disableShadows: () => {{ sunLight.castShadow = false; }}
  }};
}})();


// ==============================================================================
// VIEW 2: MAX-DETAIL {TILE_GRID_RES}px TILE VIEW (+25 KM SHADOW BUFFER)
// ==============================================================================
const TileDetailView = (() => {{
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  const RES = DATA.tile_grid_res;                  // {TILE_GRID_RES} (Max Detail)
  const VIS_SIZE_KM = DATA.tile_size_km;          // 200 km visible square
  const VIS_HALF_KM = VIS_SIZE_KM * 0.5;          // 100 km visible half-width
  const PAD_KM = DATA.shadow_pad_km;              // 25 km shadow margin per side
  const FULL_SIZE_KM = VIS_SIZE_KM + 2.0 * PAD_KM;// 250 km total shadow caster
  const FULL_HALF_KM = FULL_SIZE_KM * 0.5;        // 125 km total mesh half-width
  const NUM_VERTS = RES * RES;

  const Z_KM = new Float32Array(NUM_VERTS);
  const SUN_EXP_ARR = HAS_EXPOSURE_MAPS ? new Float32Array(NUM_VERTS) : null;
  const RADIO_EXP_ARR = HAS_EXPOSURE_MAPS ? new Float32Array(NUM_VERTS) : null;
  const LATS_ARR = new Float32Array(NUM_VERTS);
  const LONS_ARR = new Float32Array(NUM_VERTS);

  const positions = new Float32Array(NUM_VERTS * 3);
  const heightColors = new Float32Array(NUM_VERTS * 3);
  const sunExpColors = HAS_EXPOSURE_MAPS ? new Float32Array(NUM_VERTS * 3) : null;
  const radioExpColors = HAS_EXPOSURE_MAPS ? new Float32Array(NUM_VERTS * 3) : null;

  const indices = new Uint32Array((RES - 1) * (RES - 1) * 6);
  let iPtr = 0;
  for (let r = 0; r < RES - 1; r++) {{
    for (let c = 0; c < RES - 1; c++) {{
      const a = r * RES + c;
      const b = (r + 1) * RES + c;
      const d = r * RES + (c + 1);
      const e = (r + 1) * RES + (c + 1);
      indices[iPtr++] = a; indices[iPtr++] = b; indices[iPtr++] = d;
      indices[iPtr++] = b; indices[iPtr++] = e; indices[iPtr++] = d;
    }}
  }}

  const colorAttr = new THREE.BufferAttribute(new Float32Array(heightColors), 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', colorAttr);
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));

  const tileClipPlanes = [
    new THREE.Plane(new THREE.Vector3( 1, 0,  0), VIS_HALF_KM),
    new THREE.Plane(new THREE.Vector3(-1, 0,  0), VIS_HALF_KM),
    new THREE.Plane(new THREE.Vector3( 0, 0,  1), VIS_HALF_KM),
    new THREE.Plane(new THREE.Vector3( 0, 0, -1), VIS_HALF_KM),
  ];

  const shadowMaterial = new THREE.MeshStandardMaterial({{
    color: 0xc2c6cc,
    roughness: 0.95,
    metalness: 0.0,
    clippingPlanes: tileClipPlanes,
    clipShadows: false
  }});

  const dataMapMaterial = new THREE.MeshStandardMaterial({{
    vertexColors: true,
    roughness: 0.95,
    metalness: 0.0,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
    clippingPlanes: tileClipPlanes,
    clipShadows: false
  }});

  const terrainMesh = new THREE.Mesh(geometry, shadowMaterial);
  terrainMesh.castShadow = true;
  terrainMesh.receiveShadow = true;
  group.add(terrainMesh);

  let currentTile = LUNAR_TILES[0];
  let tileMinZ = -2000;
  let tileMaxZ = 2000;
  let minWorldY = -2.0;
  let maxWorldY = 2.0;
  let centerWorldY = 0.0;

  const defaultCamPos = new THREE.Vector3(165, 130, 195);
  const approachCamPos = new THREE.Vector3(240, 250, 280);

  const tileSunDirs = new Float32Array(TOTAL_STEPS * 3);
  const tileEarthDirs = new Float32Array(TOTAL_STEPS * 3);
  const horizonProfile = new Float32Array(360);
  const hourlySunLit = new Uint8Array(TOTAL_STEPS);
  let statsSummary = {{ sunPct: '0%', radioPct: '0%', maxEclipse: '0 h' }};

  let showSurfaceContours = true;
  let currentContourInterval = 250;
  const surfaceContoursMesh = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({{
      vertexColors: true,
      transparent: true,
      opacity: 0.78,
      clippingPlanes: tileClipPlanes
    }})
  );
  surfaceContoursMesh.visible = false;
  group.add(surfaceContoursMesh);

  function rebuildSurfaceContours(intervalMeters) {{
    const minM = tileMinZ;
    const maxM = tileMaxZ;
    const zRangeM = Math.max(1, maxM - minM);
    const firstIso = Math.ceil(minM / intervalMeters) * intervalMeters;
    const levels = [];
    for (let z = firstIso; z <= maxM; z += intervalMeters) {{
      levels.push(Math.round(z * 1000) / 1000);
    }}

    const segPositions = [];
    const segColors = [];
    const lift = 0.14;

    function traceTri(i0, h0, i1, h1, i2, h2, isoZ, cr, cg, cb) {{
      let count = 0;
      let p0x = 0, p0y = 0, p0z = 0;
      let p1x = 0, p1y = 0, p1z = 0;

      const interp = (a, ha, b, hb) => {{
        const d = hb - ha;
        const t = Math.abs(d) < 1e-9 ? 0.5 : (isoZ - ha) / d;
        return [
          positions[a * 3] + t * (positions[b * 3] - positions[a * 3]),
          positions[a * 3 + 1] + t * (positions[b * 3 + 1] - positions[a * 3 + 1]) + lift,
          positions[a * 3 + 2] + t * (positions[b * 3 + 2] - positions[a * 3 + 2]),
        ];
      }};

      if ((h0 < isoZ && h1 >= isoZ) || (h1 < isoZ && h0 >= isoZ)) {{
        [p0x, p0y, p0z] = interp(i0, h0, i1, h1);
        count = 1;
      }}
      if ((h1 < isoZ && h2 >= isoZ) || (h2 < isoZ && h1 >= isoZ)) {{
        const p = interp(i1, h1, i2, h2);
        if (count === 0) {{ [p0x, p0y, p0z] = p; }} else {{ [p1x, p1y, p1z] = p; }}
        count++;
      }}
      if (count < 2 && ((h2 < isoZ && h0 >= isoZ) || (h0 < isoZ && h2 >= isoZ))) {{
        [p1x, p1y, p1z] = interp(i2, h2, i0, h0);
        count++;
      }}
      if (count === 2) {{
        segPositions.push(p0x, p0y, p0z, p1x, p1y, p1z);
        segColors.push(cr, cg, cb, cr, cg, cb);
      }}
    }}

    for (let r = 0; r < RES - 1; r++) {{
      const row0 = r * RES;
      const row1 = (r + 1) * RES;
      for (let c = 0; c < RES - 1; c++) {{
        const i00 = row0 + c, i10 = row0 + c + 1;
        const i01 = row1 + c, i11 = row1 + c + 1;
        const h00 = Z_KM[i00] * 1000.0;
        const h10 = Z_KM[i10] * 1000.0;
        const h01 = Z_KM[i01] * 1000.0;
        const h11 = Z_KM[i11] * 1000.0;

        const qMin = Math.min(h00, h10, h01, h11);
        const qMax = Math.max(h00, h10, h01, h11);
        if (qMax - qMin < 1e-6) continue;

        for (let l = 0; l < levels.length; l++) {{
          const isoZ = levels[l];
          if (isoZ < qMin || isoZ > qMax) continue;
          const frac = (isoZ - minM) / zRangeM;
          const isMajor = Math.abs(isoZ % (intervalMeters * 5)) < 1e-3;
          let cr, cg, cb;
          if (frac < 0.25) {{
            cr = isMajor ? 0.96 : 0.78;
            cg = isMajor ? 0.98 : 0.84;
            cb = isMajor ? 1.00 : 0.92;
          }} else {{
            cr = isMajor ? 0.02 : 0.06;
            cg = isMajor ? 0.03 : 0.08;
            cb = isMajor ? 0.05 : 0.12;
          }}
          traceTri(i00, h00, i01, h01, i10, h10, isoZ, cr, cg, cb);
          traceTri(i01, h01, i11, h11, i10, h10, isoZ, cr, cg, cb);
        }}
      }}
    }}

    const newGeo = new THREE.BufferGeometry();
    newGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segPositions), 3));
    newGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(segColors), 3));
    surfaceContoursMesh.geometry.dispose();
    surfaceContoursMesh.geometry = newGeo;
    return levels.length;
  }}

  const scaleGroup = new THREE.Group();
  group.add(scaleGroup);

  const baseY = -12.0;
  const kmTicks = [-100, -50, 0, 50, 100];

  const floorLinePos = [
    -VIS_HALF_KM, baseY, -VIS_HALF_KM,  VIS_HALF_KM, baseY, -VIS_HALF_KM,
     VIS_HALF_KM, baseY, -VIS_HALF_KM,  VIS_HALF_KM, baseY,  VIS_HALF_KM,
     VIS_HALF_KM, baseY,  VIS_HALF_KM, -VIS_HALF_KM, baseY,  VIS_HALF_KM,
    -VIS_HALF_KM, baseY,  VIS_HALF_KM, -VIS_HALF_KM, baseY, -VIS_HALF_KM,
  ];
  kmTicks.forEach((v) => {{
    floorLinePos.push(v, baseY, -VIS_HALF_KM, v, baseY, VIS_HALF_KM);
    floorLinePos.push(-VIS_HALF_KM, baseY, v, VIS_HALF_KM, baseY, v);
  }});
  const floorGeo = new THREE.BufferGeometry();
  floorGeo.setAttribute('position', new THREE.Float32BufferAttribute(floorLinePos, 3));
  scaleGroup.add(new THREE.LineSegments(
    floorGeo,
    new THREE.LineBasicMaterial({{ color: 0x4b648a, transparent: true, opacity: 0.68 }})
  ));

  const xTickSprites = kmTicks.map((v) => {{
    const sp = makeMultiLineSprite([`${{v >= 0 ? '+' : ''}}${{v}} km`], {{ fontSize: 24, scaleW: 32 }});
    scaleGroup.add(sp);
    return {{ sp, wx: v }};
  }});
  const xAxisTitle = makeMultiLineSprite(['Ost / West (200 km)'], {{
    fontSize: 26, color: '#ffffff', width: 420, height: 70, scaleW: 48
  }});
  scaleGroup.add(xAxisTitle);

  const zTickSprites = kmTicks.map((v) => {{
    const sp = makeMultiLineSprite([`${{-v >= 0 ? '+' : ''}}${{-v}} km`], {{ fontSize: 24, scaleW: 32 }});
    scaleGroup.add(sp);
    return {{ sp, wz: v }};
  }});
  const zAxisTitle = makeMultiLineSprite(['Nord / Süd (200 km)'], {{
    fontSize: 26, color: '#ffffff', width: 420, height: 70, scaleW: 48
  }});
  scaleGroup.add(zAxisTitle);

  const centerPinGroup = new THREE.Group();
  const cHead = new THREE.Mesh(new THREE.OctahedronGeometry(2.2, 0), new THREE.MeshBasicMaterial({{ color: 0x00f5d4 }}));
  cHead.position.y = 4.6;
  const cStem = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 4.6, 8), new THREE.MeshBasicMaterial({{ color: 0x00f5d4 }}));
  cStem.position.y = 2.3;
  centerPinGroup.add(cHead, cStem);
  group.add(centerPinGroup);

  function updateScaleOrientation() {{
    const signX = camera.position.x >= 0 ? 1 : -1;
    const signZ = camera.position.z >= 0 ? 1 : -1;
    xTickSprites.forEach(({{ sp, wx }}) => sp.position.set(wx, baseY - 2.2, signZ * (VIS_HALF_KM + 12)));
    xAxisTitle.position.set(0, baseY - 4.5, signZ * (VIS_HALF_KM + 26));
    zTickSprites.forEach(({{ sp, wz }}) => sp.position.set(signX * (VIS_HALF_KM + 12), baseY - 2.2, wz));
    zAxisTitle.position.set(signX * (VIS_HALF_KM + 26), baseY - 4.5, 0);
  }}
  updateScaleOrientation();

  const crosshairGroup = new THREE.Group();
  crosshairGroup.visible = false;
  group.add(crosshairGroup);

  const armSegments = 16;
  const armHalfLen = 4.5;
  const crossMat = new THREE.LineBasicMaterial({{ color: 0x00f5d4, depthTest: true }});
  const lineXGeo = new THREE.BufferGeometry();
  lineXGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((armSegments + 1) * 3), 3));
  const lineZGeo = new THREE.BufferGeometry();
  lineZGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((armSegments + 1) * 3), 3));
  const centerRing = new THREE.Mesh(
    new THREE.RingGeometry(0.75, 1.15, 24),
    new THREE.MeshBasicMaterial({{ color: 0x00f5d4, side: THREE.DoubleSide }})
  );
  centerRing.rotation.x = -Math.PI / 2;
  crosshairGroup.add(new THREE.Line(lineXGeo, crossMat), new THREE.Line(lineZGeo, crossMat), centerRing);

  function getWorldHeightAt(wx, wz) {{
    const cF = THREE.MathUtils.clamp(((wx + FULL_HALF_KM) / FULL_SIZE_KM) * (RES - 1), 0, RES - 1);
    const rF = THREE.MathUtils.clamp(((wz + FULL_HALF_KM) / FULL_SIZE_KM) * (RES - 1), 0, RES - 1);
    const c0 = cF | 0, c1 = Math.min(RES - 1, c0 + 1);
    const r0 = rF | 0, r1 = Math.min(RES - 1, r0 + 1);
    const fc = cF - c0, fr = rF - r0;
    const h00 = positions[(r0 * RES + c0) * 3 + 1];
    const h10 = positions[(r0 * RES + c1) * 3 + 1];
    const h01 = positions[(r1 * RES + c0) * 3 + 1];
    const h11 = positions[(r1 * RES + c1) * 3 + 1];
    return (h00 * (1 - fc) + h10 * fc) * (1 - fr) + (h01 * (1 - fc) + h11 * fc) * fr;
  }}

  const normalEps = (FULL_SIZE_KM / (RES - 1)) * 0.5;
  function getSmoothNormalAt(wx, wz, targetVec) {{
    const hL = getWorldHeightAt(Math.max(-FULL_HALF_KM, wx - normalEps), wz);
    const hR = getWorldHeightAt(Math.min(FULL_HALF_KM, wx + normalEps), wz);
    const hD = getWorldHeightAt(wx, Math.max(-FULL_HALF_KM, wz - normalEps));
    const hU = getWorldHeightAt(wx, Math.min(FULL_HALF_KM, wz + normalEps));
    return targetVec.set(-(hR - hL), 2.0 * normalEps, -(hU - hD)).normalize();
  }}

  const _upVec = new THREE.Vector3(0, 0, 1);
  function updateCrosshairGeometry(wx, wy, wz, normal) {{
    const posX = lineXGeo.attributes.position.array;
    const posZ = lineZGeo.attributes.position.array;
    const lift = 0.22;
    for (let i = 0; i <= armSegments; i++) {{
      const offset = -armHalfLen + (i / armSegments) * (armHalfLen * 2);
      const sx = THREE.MathUtils.clamp(wx + offset, -VIS_HALF_KM, VIS_HALF_KM);
      posX[i * 3] = sx; posX[i * 3 + 1] = getWorldHeightAt(sx, wz) + lift; posX[i * 3 + 2] = wz;
      const sz = THREE.MathUtils.clamp(wz + offset, -VIS_HALF_KM, VIS_HALF_KM);
      posZ[i * 3] = wx; posZ[i * 3 + 1] = getWorldHeightAt(wx, sz) + lift; posZ[i * 3 + 2] = sz;
    }}
    lineXGeo.attributes.position.needsUpdate = true;
    lineZGeo.attributes.position.needsUpdate = true;
    centerRing.position.set(wx, wy + lift * 1.2, wz);
    if (normal) centerRing.quaternion.setFromUnitVectors(_upVec, normal);
    crosshairGroup.visible = true;
  }}

  const sunLight = new THREE.DirectionalLight(0xfff8e7, 3.2);
  sunLight.castShadow = false;
  sunLight.shadow.mapSize.width = 4096;
  sunLight.shadow.mapSize.height = 4096;
  sunLight.shadow.bias = -0.00025;
  sunLight.shadow.normalBias = 0.08;
  group.add(sunLight);
  group.add(sunLight.target);

  const _aabbCorners = [
    new THREE.Vector3(-FULL_HALF_KM, -15, -FULL_HALF_KM),
    new THREE.Vector3( FULL_HALF_KM, -15, -FULL_HALF_KM),
    new THREE.Vector3(-FULL_HALF_KM,  15, -FULL_HALF_KM),
    new THREE.Vector3( FULL_HALF_KM,  15, -FULL_HALF_KM),
    new THREE.Vector3(-FULL_HALF_KM, -15,  FULL_HALF_KM),
    new THREE.Vector3( FULL_HALF_KM, -15,  FULL_HALF_KM),
    new THREE.Vector3(-FULL_HALF_KM,  15,  FULL_HALF_KM),
    new THREE.Vector3( FULL_HALF_KM,  15,  FULL_HALF_KM),
  ];
  const _cornerTmp = new THREE.Vector3();

  function fitShadowFrustumToTerrain() {{
    sunLight.updateMatrixWorld();
    sunLight.target.updateMatrixWorld();

    const shadowCam = sunLight.shadow.camera;
    shadowCam.position.copy(sunLight.position);
    shadowCam.up.set(0, 1, 0);
    shadowCam.lookAt(sunLight.target.position);
    shadowCam.updateMatrixWorld();

    const viewMat = shadowCam.matrixWorldInverse;
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    for (let i = 0; i < 8; i++) {{
      _cornerTmp.copy(_aabbCorners[i]).applyMatrix4(viewMat);
      if (_cornerTmp.x < minX) minX = _cornerTmp.x;
      if (_cornerTmp.x > maxX) maxX = _cornerTmp.x;
      if (_cornerTmp.y < minY) minY = _cornerTmp.y;
      if (_cornerTmp.y > maxY) maxY = _cornerTmp.y;
      if (_cornerTmp.z < minZ) minZ = _cornerTmp.z;
      if (_cornerTmp.z > maxZ) maxZ = _cornerTmp.z;
    }}

    const padX = (maxX - minX) * 0.03 + 2.0;
    const padY = (maxY - minY) * 0.03 + 2.0;
    shadowCam.left = minX - padX;
    shadowCam.right = maxX + padX;
    shadowCam.bottom = minY - padY;
    shadowCam.top = maxY + padY;
    shadowCam.near = Math.max(1.0, -maxZ - 5.0);
    shadowCam.far = Math.max(shadowCam.near + 10.0, -minZ + 5.0);
    shadowCam.updateProjectionMatrix();
  }}

  const skyRadius = 155.0;
  const sunSkyPositions = new Float32Array(TOTAL_STEPS * 3);
  const earthSkyPositions = new Float32Array(TOTAL_STEPS * 3);

  const sunMarker = new THREE.Group();
  sunMarker.add(
    new THREE.Mesh(new THREE.SphereGeometry(4.5, 24, 24), new THREE.MeshBasicMaterial({{ color: 0xffd43b }})),
    new THREE.Mesh(new THREE.SphereGeometry(7.5, 24, 24), new THREE.MeshBasicMaterial({{ color: 0xffb703, transparent: true, opacity: 0.25 }}))
  );
  const sunTag = makeMultiLineSprite(['SUN'], {{ fontSize: 22, color: '#ffd43b', width: 160, height: 60, scaleW: 18 }});
  sunTag.position.y = 11.0;
  sunMarker.add(sunTag);
  group.add(sunMarker);

  const sunBeamGeo = new THREE.BufferGeometry();
  const sunBeamArr = new Float32Array(6);
  sunBeamGeo.setAttribute('position', new THREE.BufferAttribute(sunBeamArr, 3));
  const sunBeam = new THREE.Line(
    sunBeamGeo,
    new THREE.LineDashedMaterial({{ color: 0xffd43b, dashSize: 4, gapSize: 3, transparent: true, opacity: 0.45 }})
  );
  group.add(sunBeam);

  const earthMarker = new THREE.Group();
  earthMarker.add(new THREE.Mesh(new THREE.SphereGeometry(3.4, 20, 20), new THREE.MeshBasicMaterial({{ color: 0x4dabf7 }})));
  const earthTag = makeMultiLineSprite(['EARTH'], {{ fontSize: 20, color: '#74c0fc', width: 180, height: 60, scaleW: 20 }});
  earthTag.position.y = 9.0;
  earthMarker.add(earthTag);
  group.add(earthMarker);

  const earthBeamGeo = new THREE.BufferGeometry();
  const earthBeamArr = new Float32Array(6);
  earthBeamGeo.setAttribute('position', new THREE.BufferAttribute(earthBeamArr, 3));
  const earthBeam = new THREE.Line(
    earthBeamGeo,
    new THREE.LineDashedMaterial({{ color: 0x4dabf7, dashSize: 3.5, gapSize: 3.5, transparent: true, opacity: 0.35 }})
  );
  group.add(earthBeam);

  const annualSunGeo = new THREE.BufferGeometry();
  const annualPtsCount = Math.ceil(TOTAL_STEPS / 3);
  annualSunGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(annualPtsCount * 3), 3));
  const annualSunTrail = new THREE.Line(
    annualSunGeo,
    new THREE.LineBasicMaterial({{ color: 0xffb703, transparent: true, opacity: 0.16 }})
  );
  group.add(annualSunTrail);

  const LUNAR_DAY_HOURS = 709;
  const activeDayGeo = new THREE.BufferGeometry();
  activeDayGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LUNAR_DAY_HOURS * 3), 3));
  const activeDayTrail = new THREE.Line(
    activeDayGeo,
    new THREE.LineBasicMaterial({{ color: 0xffd43b, transparent: true, opacity: 0.72 }})
  );
  group.add(activeDayTrail);

  const earthTrailGeo = new THREE.BufferGeometry();
  const earthPtsCount = Math.ceil(TOTAL_STEPS / 4);
  earthTrailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(earthPtsCount * 3), 3));
  const earthTrail = new THREE.Line(
    earthTrailGeo,
    new THREE.LineBasicMaterial({{ color: 0x4dabf7, transparent: true, opacity: 0.35 }})
  );
  group.add(earthTrail);

  function loadTile(tile) {{
    currentTile = tile;
    const basis = tile.basis;
    const r0Km = R_MOON_KM + (tile.centerElevM * DATA.exaggeration) / 1000.0;
    const p0Moon = basis.up.clone().multiplyScalar(r0Km);

    let localMinZ = Infinity;
    let localMaxZ = -Infinity;

    for (let r = 0; r < RES; r++) {{
      const yKm = FULL_HALF_KM - (r / (RES - 1)) * FULL_SIZE_KM;
      for (let c = 0; c < RES; c++) {{
        const xKm = -FULL_HALF_KM + (c / (RES - 1)) * FULL_SIZE_KM;
        const idx = r * RES + c;
        const u = tileKmToMoonUnit(basis, xKm, yKm);
        const {{ latDeg, lonDeg }} = moonUnitToLatLon(u);
        const zM = getElevationMetersAtLatLon(latDeg, lonDeg);

        Z_KM[idx] = zM / 1000.0;
        LATS_ARR[idx] = latDeg;
        LONS_ARR[idx] = lonDeg;

        if (HAS_EXPOSURE_MAPS) {{
          SUN_EXP_ARR[idx] = sampleGlobalGridAtLatLon(G_SUN_EXP_VALUES, latDeg, lonDeg);
          RADIO_EXP_ARR[idx] = sampleGlobalGridAtLatLon(G_RADIO_EXP_VALUES, latDeg, lonDeg);
        }}

        if (Math.abs(xKm) <= VIS_HALF_KM && Math.abs(yKm) <= VIS_HALF_KM) {{
          if (zM < localMinZ) localMinZ = zM;
          if (zM > localMaxZ) localMaxZ = zM;
        }}

        const rKm = R_MOON_KM + (zM * DATA.exaggeration) / 1000.0;
        const dx = u.x * rKm - p0Moon.x;
        const dy = u.y * rKm - p0Moon.y;
        const dz = u.z * rKm - p0Moon.z;

        const wx = dx * basis.east.x + dy * basis.east.y + dz * basis.east.z;
        const wy = dx * basis.up.x + dy * basis.up.y + dz * basis.up.z;
        const wz = -(dx * basis.north.x + dy * basis.north.y + dz * basis.north.z);

        positions[idx * 3] = wx;
        positions[idx * 3 + 1] = wy;
        positions[idx * 3 + 2] = wz;
      }}
    }}

    tileMinZ = localMinZ;
    tileMaxZ = localMaxZ;
    const zSpan = Math.max(1.0, tileMaxZ - tileMinZ);

    minWorldY = Infinity;
    maxWorldY = -Infinity;
    for (let i = 0; i < NUM_VERTS; i++) {{
      const wy = positions[i * 3 + 1];
      if (wy < minWorldY) minWorldY = wy;
      if (wy > maxWorldY) maxWorldY = wy;

      const hc = sampleStops((Z_KM[i] * 1000.0 - tileMinZ) / zSpan, VIRIDIS_STOPS);
      heightColors[i * 3] = hc[0]; heightColors[i * 3 + 1] = hc[1]; heightColors[i * 3 + 2] = hc[2];

      if (HAS_EXPOSURE_MAPS) {{
        const sc = sampleStops(SUN_EXP_ARR[i], SUN_EXP_STOPS);
        sunExpColors[i * 3] = sc[0]; sunExpColors[i * 3 + 1] = sc[1]; sunExpColors[i * 3 + 2] = sc[2];

        const rc = sampleStops(RADIO_EXP_ARR[i], RADIO_EXP_STOPS);
        radioExpColors[i * 3] = rc[0]; radioExpColors[i * 3 + 1] = rc[1]; radioExpColors[i * 3 + 2] = rc[2];
      }}
    }}

    geometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals();

    centerWorldY = getWorldHeightAt(0, 0);
    centerPinGroup.position.set(0, centerWorldY, 0);
    sunBeamArr[3] = 0; sunBeamArr[4] = centerWorldY + 0.1; sunBeamArr[5] = 0;
    earthBeamArr[3] = 0; earthBeamArr[4] = centerWorldY + 0.1; earthBeamArr[5] = 0;

    const annualArr = annualSunGeo.attributes.position.array;
    const earthArr = earthTrailGeo.attributes.position.array;
    let aPtr = 0, ePtr = 0;

    for (let i = 0; i < TOTAL_STEPS; i++) {{
      const b = i * 3;
      const sxM = SUN_DIRS[b], syM = -SUN_DIRS[b + 2], szM = SUN_DIRS[b + 1];
      const sEast = sxM * basis.east.x + syM * basis.east.y + szM * basis.east.z;
      const sNorth = sxM * basis.north.x + syM * basis.north.y + szM * basis.north.z;
      const sUp = sxM * basis.up.x + syM * basis.up.y + szM * basis.up.z;

      tileSunDirs[b] = sEast;
      tileSunDirs[b + 1] = sUp;
      tileSunDirs[b + 2] = -sNorth;
      sunSkyPositions[b] = sEast * skyRadius;
      sunSkyPositions[b + 1] = sUp * skyRadius;
      sunSkyPositions[b + 2] = -sNorth * skyRadius;

      const exM = EARTH_DIRS[b], eyM = -EARTH_DIRS[b + 2], ezM = EARTH_DIRS[b + 1];
      const eEast = exM * basis.east.x + eyM * basis.east.y + ezM * basis.east.z;
      const eNorth = exM * basis.north.x + eyM * basis.north.y + ezM * basis.north.z;
      const eUp = exM * basis.up.x + eyM * basis.up.y + szM * basis.up.z;

      tileEarthDirs[b] = eEast;
      tileEarthDirs[b + 1] = eUp;
      tileEarthDirs[b + 2] = -eNorth;
      earthSkyPositions[b] = eEast * skyRadius;
      earthSkyPositions[b + 1] = eUp * skyRadius;
      earthSkyPositions[b + 2] = -eNorth * skyRadius;

      if (i % 3 === 0 && aPtr < annualArr.length) {{
        annualArr[aPtr++] = sunSkyPositions[b];
        annualArr[aPtr++] = sunSkyPositions[b + 1];
        annualArr[aPtr++] = sunSkyPositions[b + 2];
      }}
      if (i % 4 === 0 && ePtr < earthArr.length) {{
        earthArr[ePtr++] = earthSkyPositions[b];
        earthArr[ePtr++] = earthSkyPositions[b + 1];
        earthArr[ePtr++] = earthSkyPositions[b + 2];
      }}
    }}
    annualSunGeo.attributes.position.needsUpdate = true;
    earthTrailGeo.attributes.position.needsUpdate = true;

    const stepDist = 0.5;
    const maxSteps = Math.floor(FULL_HALF_KM / stepDist);
    for (let deg = 0; deg < 360; deg++) {{
      const azRad = THREE.MathUtils.degToRad(deg);
      const dx = Math.sin(azRad);
      const dz = -Math.cos(azRad);
      let maxAng = -90.0;
      for (let s = 2; s <= maxSteps; s++) {{
        const d = s * stepDist;
        const wx = dx * d;
        const wz = dz * d;
        if (Math.abs(wx) > FULL_HALF_KM || Math.abs(wz) > FULL_HALF_KM) break;
        const wy = getWorldHeightAt(wx, wz);
        const ang = THREE.MathUtils.radToDeg(Math.atan2(wy - centerWorldY, d));
        if (ang > maxAng) maxAng = ang;
      }}
      horizonProfile[deg] = maxAng;
    }}

    let sunlitHours = 0;
    let radioHours = 0;
    let currentEclipseStreak = 0;
    let longestEclipseHours = 0;

    for (let i = 0; i < TOTAL_STEPS; i++) {{
      const b = i * 3;
      const sAz = (THREE.MathUtils.radToDeg(Math.atan2(tileSunDirs[b], -tileSunDirs[b + 2])) + 360) % 360;
      const sEl = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(tileSunDirs[b + 1], -1, 1)));
      const isLit = (sEl + SOLAR_ANGULAR_RADIUS_DEG) > getHorizonAngleAtAz(sAz) ? 1 : 0;
      hourlySunLit[i] = isLit;
      if (isLit) {{
        sunlitHours++;
        currentEclipseStreak = 0;
      }} else {{
        currentEclipseStreak++;
        if (currentEclipseStreak > longestEclipseHours) longestEclipseHours = currentEclipseStreak;
      }}

      const eAz = (THREE.MathUtils.radToDeg(Math.atan2(tileEarthDirs[b], -tileEarthDirs[b + 2])) + 360) % 360;
      const eEl = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(tileEarthDirs[b + 1], -1, 1)));
      if ((eEl + 0.95) > getHorizonAngleAtAz(eAz)) radioHours++;
    }}

    statsSummary = {{
      sunPct: `${{((sunlitHours / TOTAL_STEPS) * 100).toFixed(1)}}%`,
      radioPct: `${{((radioHours / TOTAL_STEPS) * 100).toFixed(1)}}%`,
      maxEclipse: `${{longestEclipseHours}} h`
    }};

    rebuildSurfaceContours(currentContourInterval);
  }}

  function getHorizonAngleAtAz(azDeg) {{
    const norm = ((azDeg % 360) + 360) % 360;
    const i0 = norm | 0;
    const i1 = (i0 + 1) % 360;
    const f = norm - i0;
    return horizonProfile[i0] * (1 - f) + horizonProfile[i1] * f;
  }}

  const DISK_OFFSETS_DEG = [[0, 0]];
  for (let k = 0; k < 6; k++) {{
    const ang = (k / 6) * Math.PI * 2;
    const r = SOLAR_ANGULAR_RADIUS_DEG * 0.78;
    DISK_OFFSETS_DEG.push([Math.cos(ang) * r, Math.sin(ang) * r]);
  }}

  function computeSiteSolarDiskFraction(sAz, sEl) {{
    if (sEl <= -SOLAR_ANGULAR_RADIUS_DEG) return 0.0;
    let visibleSamples = 0;
    for (let i = 0; i < 7; i++) {{
      if ((sEl + DISK_OFFSETS_DEG[i][1]) > getHorizonAngleAtAz(sAz + DISK_OFFSETS_DEG[i][0])) {{
        visibleSamples++;
      }}
    }}
    return visibleSamples / 7;
  }}

  const gridMarchStep = (FULL_SIZE_KM / (RES - 1)) * 0.45;
  function isTerrainOccluded(ox, oy, oz, dx, dy, dz, maxDist) {{
    for (let t = gridMarchStep; t < maxDist; t += gridMarchStep) {{
      const px = ox + dx * t;
      const pz = oz + dz * t;
      if (px < -FULL_HALF_KM || px > FULL_HALF_KM || pz < -FULL_HALF_KM || pz > FULL_HALF_KM) return false;
      const py = oy + dy * t;
      if (dy >= 0 && py > maxWorldY) return false;
      if (py <= getWorldHeightAt(px, pz)) return true;
    }}
    return false;
  }}

  const _rayOrigin = new THREE.Vector3();
  const _rayDir = new THREE.Vector3();
  function raycastTerrainGrid(ndcX, ndcY, outPoint, outNormal) {{
    _rayOrigin.setFromMatrixPosition(camera.matrixWorld);
    _rayDir.set(ndcX, ndcY, 0.5).unproject(camera).sub(_rayOrigin).normalize();

    const boxMinY = minWorldY - 2.0;
    const boxMaxY = maxWorldY + 2.0;
    let tMin = 0.0;
    let tMax = 5000.0;

    const invX = 1.0 / _rayDir.x;
    const tx1 = (-VIS_HALF_KM - _rayOrigin.x) * invX;
    const tx2 = (VIS_HALF_KM - _rayOrigin.x) * invX;
    tMin = Math.max(tMin, Math.min(tx1, tx2));
    tMax = Math.min(tMax, Math.max(tx1, tx2));

    const invY = 1.0 / _rayDir.y;
    const ty1 = (boxMinY - _rayOrigin.y) * invY;
    const ty2 = (boxMaxY - _rayOrigin.y) * invY;
    tMin = Math.max(tMin, Math.min(ty1, ty2));
    tMax = Math.min(tMax, Math.max(ty1, ty2));

    const invZ = 1.0 / _rayDir.z;
    const tz1 = (-VIS_HALF_KM - _rayOrigin.z) * invZ;
    const tz2 = (VIS_HALF_KM - _rayOrigin.z) * invZ;
    tMin = Math.max(tMin, Math.min(tz1, tz2));
    tMax = Math.min(tMax, Math.max(tz1, tz2));

    if (tMax < tMin) return false;

    let prevT = tMin;
    for (let t = tMin; t <= tMax; t += gridMarchStep) {{
      const px = _rayOrigin.x + _rayDir.x * t;
      const py = _rayOrigin.y + _rayDir.y * t;
      const pz = _rayOrigin.z + _rayDir.z * t;
      if (px >= -VIS_HALF_KM && px <= VIS_HALF_KM && pz >= -VIS_HALF_KM && pz <= VIS_HALF_KM) {{
        const h = getWorldHeightAt(px, pz);
        if (py <= h) {{
          let lo = prevT, hi = t;
          for (let k = 0; k < 6; k++) {{
            const mid = (lo + hi) * 0.5;
            if ((_rayOrigin.y + _rayDir.y * mid) <= getWorldHeightAt(_rayOrigin.x + _rayDir.x * mid, _rayOrigin.z + _rayDir.z * mid)) hi = mid;
            else lo = mid;
          }}
          const hitT = (lo + hi) * 0.5;
          const hx = THREE.MathUtils.clamp(_rayOrigin.x + _rayDir.x * hitT, -VIS_HALF_KM, VIS_HALF_KM);
          const hz = THREE.MathUtils.clamp(_rayOrigin.z + _rayDir.z * hitT, -VIS_HALF_KM, VIS_HALF_KM);
          const hy = getWorldHeightAt(hx, hz);
          outPoint.set(hx, hy, hz);
          getSmoothNormalAt(hx, hz, outNormal);
          return true;
        }}
      }}
      prevT = t;
    }}
    return false;
  }}

  let mapMode = 'shadow';
  let currentTwilightFactor = 1.0;

  function setMapMode(mode) {{
    if (!HAS_EXPOSURE_MAPS && (mode === 'sunexp' || mode === 'radio')) {{
      mode = 'shadow';
    }}
    mapMode = mode;
    if (mode === 'shadow') {{
      terrainMesh.material = shadowMaterial;
      terrainMesh.castShadow = true;
      terrainMesh.receiveShadow = true;
      sunLight.castShadow = group.visible;
      ambientLight.intensity = 0.08;
      mapReliefLight.intensity = 0.0;

      sunMarker.visible = true;
      sunBeam.visible = true;
      earthMarker.visible = true;
      earthBeam.visible = true;
      annualSunTrail.visible = true;
      activeDayTrail.visible = true;
      earthTrail.visible = true;
      surfaceContoursMesh.visible = false;
    }} else {{
      if (mode === 'height') colorAttr.array.set(heightColors);
      else if (mode === 'sunexp' && sunExpColors) colorAttr.array.set(sunExpColors);
      else if (mode === 'radio' && radioExpColors) colorAttr.array.set(radioExpColors);
      colorAttr.needsUpdate = true;

      terrainMesh.material = dataMapMaterial;
      terrainMesh.castShadow = false;
      terrainMesh.receiveShadow = false;
      sunLight.castShadow = false;
      sunLight.intensity = 0.0;
      ambientLight.intensity = 1.95;
      mapReliefLight.intensity = 0.72;

      sunMarker.visible = false;
      sunBeam.visible = false;
      earthMarker.visible = (mode === 'radio');
      earthBeam.visible = (mode === 'radio');
      annualSunTrail.visible = false;
      activeDayTrail.visible = false;
      earthTrail.visible = (mode === 'radio');
      surfaceContoursMesh.visible = (mode === 'height') && showSurfaceContours;
    }}
  }}

  function applyStep(idx) {{
    const baseIdx = idx * 3;
    const sx = sunSkyPositions[baseIdx];
    const sy = sunSkyPositions[baseIdx + 1];
    const sz = sunSkyPositions[baseIdx + 2];

    const sAz = (THREE.MathUtils.radToDeg(Math.atan2(tileSunDirs[baseIdx], -tileSunDirs[baseIdx + 2])) + 360) % 360;
    const sEl = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(tileSunDirs[baseIdx + 1], -1, 1)));
    const eAz = (THREE.MathUtils.radToDeg(Math.atan2(tileEarthDirs[baseIdx], -tileEarthDirs[baseIdx + 2])) + 360) % 360;
    const eEl = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(tileEarthDirs[baseIdx + 1], -1, 1)));

    sunMarker.position.set(sx, sy, sz);
    sunLight.position.set(sx * 1.6, sy * 1.6, sz * 1.6);

    currentTwilightFactor = THREE.MathUtils.smoothstep(sEl, -2.5, 1.5);
    if (mapMode === 'shadow' && group.visible) {{
      ambientLight.intensity = 0.08;
      sunLight.intensity = currentTwilightFactor * 3.2;
      sunLight.castShadow = true;
      fitShadowFrustumToTerrain();
      renderer.shadowMap.needsUpdate = true;
    }}

    sunBeamArr[0] = sx; sunBeamArr[1] = sy; sunBeamArr[2] = sz;
    sunBeamGeo.attributes.position.needsUpdate = true;
    sunBeam.computeLineDistances();

    const ex = earthSkyPositions[baseIdx];
    const ey = earthSkyPositions[baseIdx + 1];
    const ez = earthSkyPositions[baseIdx + 2];
    earthMarker.position.set(ex, ey, ez);

    earthBeamArr[0] = ex; earthBeamArr[1] = ey; earthBeamArr[2] = ez;
    earthBeamGeo.attributes.position.needsUpdate = true;
    earthBeam.computeLineDistances();

    const halfWindow = LUNAR_DAY_HOURS >> 1;
    const startW = Math.max(0, idx - halfWindow);
    const endW = Math.min(TOTAL_STEPS - 1, startW + LUNAR_DAY_HOURS - 1);
    const count = endW - startW + 1;
    const trailArr = activeDayGeo.attributes.position.array;
    trailArr.set(sunSkyPositions.subarray(startW * 3, (endW + 1) * 3), 0);
    if (count < LUNAR_DAY_HOURS) {{
      const lx = sunSkyPositions[endW * 3];
      const ly = sunSkyPositions[endW * 3 + 1];
      const lz = sunSkyPositions[endW * 3 + 2];
      for (let k = count; k < LUNAR_DAY_HOURS; k++) {{
        trailArr[k * 3] = lx; trailArr[k * 3 + 1] = ly; trailArr[k * 3 + 2] = lz;
      }}
    }}
    activeDayGeo.attributes.position.needsUpdate = true;

    const siteDiskPct = Math.round(computeSiteSolarDiskFraction(sAz, sEl) * 100);
    const dteClear = eEl > getHorizonAngleAtAz(eAz);

    return {{ sAz, sEl, eAz, eEl, siteDiskPct, dteClear, statsSummary }};
  }}

  const _sunDir = new THREE.Vector3();
  const _upRef = new THREE.Vector3();
  const _tangentU = new THREE.Vector3();
  const _tangentV = new THREE.Vector3();
  const _sampleDir = new THREE.Vector3();

  function evaluateSurfaceIllumination(worldPt, smoothNormal) {{
    _sunDir.copy(sunLight.position).normalize();
    const slopeDeg = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(smoothNormal.y, -1, 1)));
    const cosIncidence = smoothNormal.dot(_sunDir);
    const incidenceDeg = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(cosIncidence, -1, 1)));

    let unblocked = 0;
    if (_sunDir.y > -SOLAR_ANGULAR_RADIUS_RAD) {{
      if (Math.abs(_sunDir.y) < 0.99) _upRef.set(0, 1, 0);
      else _upRef.set(1, 0, 0);
      _tangentU.crossVectors(_upRef, _sunDir).normalize();
      _tangentV.crossVectors(_sunDir, _tangentU).normalize();

      const ox = worldPt.x + smoothNormal.x * 0.25;
      const oy = worldPt.y + smoothNormal.y * 0.25;
      const oz = worldPt.z + smoothNormal.z * 0.25;
      const maxRayDist = FULL_SIZE_KM * 1.45;

      for (let i = 0; i < 7; i++) {{
        _sampleDir.copy(_sunDir);
        if (i > 0) {{
          const angle = ((i - 1) / 6) * Math.PI * 2;
          const offset = SOLAR_ANGULAR_RADIUS_RAD * 0.78;
          _sampleDir.addScaledVector(_tangentU, Math.cos(angle) * offset).addScaledVector(_tangentV, Math.sin(angle) * offset).normalize();
        }}
        if (_sampleDir.y <= 0 || smoothNormal.dot(_sampleDir) <= 0) continue;
        if (!isTerrainOccluded(ox, oy, oz, _sampleDir.x, _sampleDir.y, _sampleDir.z, maxRayDist)) unblocked++;
      }}
    }}

    const diskVisibleFrac = unblocked / 7;
    const geometricFactor = Math.max(0, cosIncidence);
    const renderedBrightness = geometricFactor * diskVisibleFrac * currentTwilightFactor;
    const effectiveIllum = diskVisibleFrac === 0
      ? 0.0
      : Math.max(renderedBrightness, geometricFactor * diskVisibleFrac * 0.85);

    const illumPct = THREE.MathUtils.clamp(effectiveIllum * 100, 0, 100);
    const diskPct = Math.round(diskVisibleFrac * 100);
    const fluxWm2 = Math.round(SOLAR_CONSTANT_WM2 * effectiveIllum);

    let statusHtml;
    if (_sunDir.y <= -SOLAR_ANGULAR_RADIUS_DEG) statusHtml = '<span class="tt-shadow">🌑 Below Horizon (Lunar Night)</span>';
    else if (cosIncidence <= 0) statusHtml = '<span class="tt-shadow">🌑 Shadowed (Slope Faces Away)</span>';
    else if (diskPct === 0) statusHtml = '<span class="tt-shadow">🌑 Umbra Shadow (Blocked by Terrain)</span>';
    else if (diskPct < 100) statusHtml = `<span class="tt-partial">🌗 Penumbra (${{diskPct}}% Sun Disk)</span>`;
    else statusHtml = '<span class="tt-lit">☀️ Full Direct Sunlight</span>';

    return {{ statusHtml, illumPct, diskPct, fluxWm2, incidenceDeg, slopeDeg }};
  }}

  function getPointCoords(worldPt) {{
    const cIdx = THREE.MathUtils.clamp(Math.round(((worldPt.x + FULL_HALF_KM) / FULL_SIZE_KM) * (RES - 1)), 0, RES - 1);
    const rIdx = THREE.MathUtils.clamp(Math.round(((worldPt.z + FULL_HALF_KM) / FULL_SIZE_KM) * (RES - 1)), 0, RES - 1);
    const idx = rIdx * RES + cIdx;
    return {{
      xKm: worldPt.x,
      yKm: -worldPt.z,
      elevM: Z_KM[idx] * 1000.0,
      lat: LATS_ARR[idx],
      lon: LONS_ARR[idx],
      sunExp: HAS_EXPOSURE_MAPS ? SUN_EXP_ARR[idx] : 0,
      radioExp: HAS_EXPOSURE_MAPS ? RADIO_EXP_ARR[idx] : 0
    }};
  }}

  return {{
    group,
    SIZE_KM: VIS_SIZE_KM,
    defaultCamPos,
    approachCamPos,
    loadTile,
    getTile: () => currentTile,
    getMinZ: () => tileMinZ,
    getMaxZ: () => tileMaxZ,
    getMapMode: () => mapMode,
    setMapMode,
    getShowContours: () => showSurfaceContours,
    setShowContours: (v) => {{ showSurfaceContours = v; surfaceContoursMesh.visible = (mapMode === 'height') && v; }},
    getContourInterval: () => currentContourInterval,
    setContourInterval: (iv) => {{ currentContourInterval = iv; return rebuildSurfaceContours(iv); }},
    hourlySunLit,
    applyStep,
    raycastTerrainGrid,
    updateCrosshairGeometry,
    hideCrosshair: () => {{ crosshairGroup.visible = false; }},
    evaluateSurfaceIllumination,
    getPointCoords,
    updateScaleOrientation,
    disableShadows: () => {{ sunLight.castShadow = false; }}
  }};
}})();


// ==============================================================================
// APP CONTROLLER & TRANSITIONS
// ==============================================================================
let viewScope = 'global';
let currentStepFloat = 0;
let isPlaying = false;
let playbackHoursPerSec = 24;
let lastMouseClient = null;

const transition = {{
  active: false,
  direction: 'toTile',
  elapsed: 0,
  duration: 1.35,
  midpointSwitched: false,
  targetTileIdx: 0,
  startCamPos: new THREE.Vector3(),
  startTarget: new THREE.Vector3(),
  midGlobalCamPos: new THREE.Vector3(),
  midGlobalTarget: new THREE.Vector3(),
  savedGlobalCamPos: new THREE.Vector3(),
  savedGlobalTarget: new THREE.Vector3()
}};

const transitionVeil = document.getElementById('transition-veil');
const transitionLabel = document.getElementById('transition-label');

const initGlobalCamDir = GlobalView.latLonToWorldVec(-48.0, 20.0, 1.0);
camera.position.copy(initGlobalCamDir).multiplyScalar(GlobalView.R_MOON_W * 2.95);
controls.target.set(0, 0, 0);
controls.minDistance = GlobalView.R_MOON_W * 1.05;
controls.maxDistance = GlobalView.R_MOON_W * 6.5;

const backToGlobalBtn = document.getElementById('back-to-global-btn');
const enterTileBtn = document.getElementById('enter-tile-btn');
const hudTitleEl = document.getElementById('hud-title');
const hudSubtitleEl = document.getElementById('hud-subtitle');
const modeBannerEl = document.getElementById('mode-info-banner');
const tileGridToggleRow = document.getElementById('tilegrid-toggle-row');
const graticuleToggleRow = document.getElementById('graticule-toggle-row');
const sunControlsEl = document.getElementById('sun-controls');
const heightControlsEl = document.getElementById('height-controls');
const contourSwitchPill = document.getElementById('contour-switch-pill');
const finenessGroup = document.getElementById('contour-fineness-group');
const finenessSlider = document.getElementById('fineness-slider');
const contourValEl = document.getElementById('contour-interval-val');
const finenessMinLbl = document.getElementById('fineness-min-lbl');
const finenessMaxLbl = document.getElementById('fineness-max-lbl');

const siteTitleEl = document.getElementById('site-title');
const siteMetaEl = document.getElementById('site-meta');
const siteHintEl = document.getElementById('site-hint');
const sunBadge = document.getElementById('site-status');
const earthBadge = document.getElementById('earth-status');
const statSunPctEl = document.getElementById('stat-sun-pct');
const statMidValEl = document.getElementById('stat-mid-val');
const statMidLblEl = document.getElementById('stat-mid-lbl');
const statMaxEclipseEl = document.getElementById('stat-max-eclipse');

const timeSlider = document.getElementById('time-slider');
const playBtn = document.getElementById('play-btn');
const utcClockEl = document.getElementById('utc-clock');
const sunEphemEl = document.getElementById('sun-ephem-val');
const earthEphemEl = document.getElementById('earth-ephem-val');
const tooltip = document.getElementById('tooltip');

const legendTitleEl = document.getElementById('legend-title');
const legendColorbarEl = document.getElementById('legend-colorbar');
const cbTicksContainer = document.getElementById('colorbar-ticks');

function updateLegend(scope, mode) {{
  cbTicksContainer.innerHTML = '';
  if (mode === 'sunexp' && HAS_EXPOSURE_MAPS) {{
    legendTitleEl.textContent = 'Avg Sunlight';
    legendColorbarEl.style.background = 'linear-gradient(to top, #090b18, #421157, #ad263d, #f17317, #fed12e, #fffbd6)';
    [0, 20, 40, 60, 80, 100].forEach((pct) => {{
      const el = document.createElement('div');
      el.className = 'cb-tick';
      el.style.bottom = `${{pct}}%`;
      el.textContent = `${{pct}}%`;
      cbTicksContainer.appendChild(el);
    }});
  }} else if (mode === 'radio' && HAS_EXPOSURE_MAPS) {{
    legendTitleEl.textContent = 'Radio (DTE)';
    legendColorbarEl.style.background = 'linear-gradient(to top, #0a0d18, #3d1f7a, #1c70a3, #14c2bd, #7af7eb)';
    [0, 25, 50, 75, 100].forEach((pct) => {{
      const el = document.createElement('div');
      el.className = 'cb-tick';
      el.style.bottom = `${{pct}}%`;
      el.textContent = `${{pct}}%`;
      cbTicksContainer.appendChild(el);
    }});
  }} else {{
    const minZ = scope === 'global' ? GDATA.min_z : TileDetailView.getMinZ();
    const maxZ = scope === 'global' ? GDATA.max_z : TileDetailView.getMaxZ();
    const zRange = Math.max(1, maxZ - minZ);
    legendTitleEl.textContent = 'Elevation (m)';
    legendColorbarEl.style.background = 'linear-gradient(to top, #440154, #3b528b, #21918c, #5ec962, #fde725)';
    const ticks = computeNiceElevationTicks(minZ, maxZ, 6);
    ticks.forEach((val) => {{
      const pct = ((val - minZ) / zRange) * 100;
      if (pct >= 2 && pct <= 98) {{
        const el = document.createElement('div');
        el.className = 'cb-tick';
        el.style.bottom = `${{pct}}%`;
        el.textContent = `${{val.toLocaleString()}} m`;
        cbTicksContainer.appendChild(el);
      }}
    }});
  }}
}}

function syncHUDForScope() {{
  const activeMode = viewScope === 'global' ? GlobalView.getMapMode() : TileDetailView.getMapMode();

  document.querySelectorAll('#map-mode-selector .mode-btn').forEach((btn) => {{
    btn.classList.remove('active', 'shadow-mode', 'height-mode', 'sunexp-mode', 'radio-mode');
    if (btn.dataset.mode === activeMode) btn.classList.add('active', `${{activeMode}}-mode`);
  }});

  if (activeMode === 'sunexp' && HAS_EXPOSURE_MAPS) {{
    modeBannerEl.style.display = 'block';
    modeBannerEl.innerHTML = '<b>2027 Annual Solar Exposure (0–100%):</b><br/>0% = PSRs &bull; &gt;85% = Peaks of Eternal Light.';
  }} else if (activeMode === 'radio' && HAS_EXPOSURE_MAPS) {{
    modeBannerEl.style.display = 'block';
    modeBannerEl.innerHTML = '<b>2027 Direct-to-Earth (DTE) Radio Exposure:</b><br/>100% = Continuous Earth LOS &bull; 0% = Far Side.';
  }} else {{
    modeBannerEl.style.display = 'none';
  }}

  sunControlsEl.style.display = (activeMode === 'shadow') ? 'block' : 'none';
  heightControlsEl.style.display = (activeMode === 'height') ? 'block' : 'none';

  if (viewScope === 'global') {{
    backToGlobalBtn.style.display = 'none';
    enterTileBtn.style.display = 'flex';
    tileGridToggleRow.style.display = 'flex';
    graticuleToggleRow.style.display = 'flex';
    hudTitleEl.textContent = 'Global Lunar Globe (Fast)';
    hudSubtitleEl.textContent = `1:1 Metric Lunar Sphere • ${{LUNAR_TILES.length.toLocaleString()}} × (200×200 km, {TILE_GRID_RES}px Max-Detail)`;

    const showC = GlobalView.getShowContours();
    contourSwitchPill.classList.toggle('on', showC);
    finenessGroup.style.opacity = showC ? '1' : '0.45';
    finenessSlider.disabled = !showC;
    finenessSlider.min = '250';
    finenessSlider.max = '2500';
    finenessSlider.step = '250';
    const iv = GlobalView.getContourInterval();
    finenessSlider.value = String(2750 - iv);
    finenessMinLbl.textContent = 'Coarse (2,500 m)';
    finenessMaxLbl.textContent = 'Fine (250 m)';
    contourValEl.textContent = `${{iv.toLocaleString()}} m`;

    const tile = GlobalView.getSelectedTile();
    const latDir = tile.lat >= 0 ? 'N' : 'S';
    const lonDir = tile.lon >= 0 ? 'E' : 'W';
    siteTitleEl.textContent = `🧩 Quadrat ${{tile.idLabel}} (200×200 km)`;
    siteMetaEl.innerHTML = `
      Zentrum: <b>${{Math.abs(tile.lat).toFixed(2)}}° ${{latDir}}, ${{Math.abs(tile.lon).toFixed(2)}}° ${{lonDir}}</b><br/>
      Höhe (Zentrum): <b>${{tile.centerElevM.toLocaleString(undefined, {{ minimumFractionDigits: 1, maximumFractionDigits: 1 }})}} m</b>
    `;
    statMidLblEl.innerHTML = 'Annual<br/>Radio (DTE)';
    statMidValEl.style.color = '#00f5d4';
    siteHintEl.innerHTML = 'Klicke auf ein beliebiges Quadrat, um das hochauflösende {TILE_GRID_RES}px-Terrain in 3D zu öffnen.';

    drawPowerStrip(GlobalView.hourlySunLit);
    updateLegend('global', activeMode);
  }} else {{
    backToGlobalBtn.style.display = 'flex';
    enterTileBtn.style.display = 'none';
    tileGridToggleRow.style.display = 'none';
    graticuleToggleRow.style.display = 'none';

    const tile = TileDetailView.getTile();
    const latDir = tile.lat >= 0 ? 'N' : 'S';
    const lonDir = tile.lon >= 0 ? 'E' : 'W';
    hudTitleEl.textContent = `Quadrat ${{tile.idLabel}} — Max-Detail 3D`;
    hudSubtitleEl.textContent = `Zentrum: ${{Math.abs(tile.lat).toFixed(2)}}° ${{latDir}}, ${{Math.abs(tile.lon).toFixed(2)}}° ${{lonDir}} • {TILE_GRID_RES}×{TILE_GRID_RES} Grid`;

    const showC = TileDetailView.getShowContours();
    contourSwitchPill.classList.toggle('on', showC);
    finenessGroup.style.opacity = showC ? '1' : '0.45';
    finenessSlider.disabled = !showC;
    finenessSlider.min = '50';
    finenessSlider.max = '1000';
    finenessSlider.step = '50';
    const iv = TileDetailView.getContourInterval();
    finenessSlider.value = String(1050 - iv);
    finenessMinLbl.textContent = 'Coarse (1,000 m)';
    finenessMaxLbl.textContent = 'Fine (50 m)';
    contourValEl.textContent = `${{iv}} m`;

    siteTitleEl.textContent = `🧩 Quadrat ${{tile.idLabel}} (200×200 km)`;
    siteMetaEl.innerHTML = `
      Zentrum: <b>${{Math.abs(tile.lat).toFixed(2)}}° ${{latDir}}, ${{Math.abs(tile.lon).toFixed(2)}}° ${{lonDir}}</b><br/>
      Höhenbereich: <b>${{TileDetailView.getMinZ().toFixed(0)}} m bis ${{TileDetailView.getMaxZ().toFixed(0)}} m</b>
    `;
    statMidLblEl.innerHTML = 'Annual<br/>Radio (DTE)';
    statMidValEl.style.color = '#00f5d4';
    siteHintEl.innerHTML = 'Maximal detailgetreues {TILE_GRID_RES}px-Mesh mit 250×250 km Schatten-Puffer.';

    drawPowerStrip(TileDetailView.hourlySunLit);
    updateLegend('tile', activeMode);
  }}
}}

function applyEphemerisStep(stepIdx) {{
  const idx = THREE.MathUtils.clamp(Math.round(stepIdx), 0, TOTAL_STEPS - 1);
  currentStepFloat = idx;
  timeSlider.value = idx;
  utcClockEl.textContent = `${{EPHEM.timestamps[idx]}} UTC`;

  if (viewScope === 'global') {{
    const res = GlobalView.applyStep(idx);
    sunEphemEl.textContent = `${{res.localSun.azDeg.toFixed(1)}}° / ${{res.localSun.elDeg.toFixed(2)}}°`;
    earthEphemEl.textContent = `${{res.localEarth.azDeg.toFixed(1)}}° / ${{res.localEarth.elDeg.toFixed(2)}}°`;

    if (res.localSun.elDeg <= -SOLAR_ANGULAR_RADIUS_DEG) {{
      sunBadge.className = 'status-badge shadowed';
      sunBadge.textContent = '🌑 LUNAR NIGHT';
    }} else if (res.siteDiskPct === 0) {{
      sunBadge.className = 'status-badge shadowed';
      sunBadge.textContent = '🌑 IN SHADOW';
    }} else if (res.siteDiskPct < 100) {{
      sunBadge.className = 'status-badge partial';
      sunBadge.textContent = `🌗 PARTIAL (${{res.siteDiskPct}}%)`;
    }} else {{
      sunBadge.className = 'status-badge lit';
      sunBadge.textContent = '☀️ SOLAR ON (100%)';
    }}

    if (res.dteClear) {{
      earthBadge.className = 'status-badge comms-ok';
      earthBadge.textContent = '📡 DTE CLEAR';
    }} else {{
      earthBadge.className = 'status-badge shadowed';
      earthBadge.textContent = '📵 DTE BLOCKED';
    }}

    statSunPctEl.textContent = res.statsSummary.sunPct;
    statMidValEl.textContent = res.statsSummary.radioPct;
    statMaxEclipseEl.textContent = res.statsSummary.maxEclipse;
  }} else {{
    const res = TileDetailView.applyStep(idx);
    sunEphemEl.textContent = `${{res.sAz.toFixed(1)}}° / ${{res.sEl.toFixed(2)}}°`;
    earthEphemEl.textContent = `${{res.eAz.toFixed(1)}}° / ${{res.eEl.toFixed(2)}}°`;

    if (res.sEl <= -SOLAR_ANGULAR_RADIUS_DEG) {{
      sunBadge.className = 'status-badge shadowed';
      sunBadge.textContent = '🌑 LUNAR NIGHT';
    }} else if (res.siteDiskPct === 0) {{
      sunBadge.className = 'status-badge shadowed';
      sunBadge.textContent = '🌑 IN SHADOW';
    }} else if (res.siteDiskPct < 100) {{
      sunBadge.className = 'status-badge partial';
      sunBadge.textContent = `🌗 PARTIAL (${{res.siteDiskPct}}%)`;
    }} else {{
      sunBadge.className = 'status-badge lit';
      sunBadge.textContent = '☀️ SOLAR ON (100%)';
    }}

    if (res.dteClear) {{
      earthBadge.className = 'status-badge comms-ok';
      earthBadge.textContent = '📡 DTE CLEAR';
    }} else {{
      earthBadge.className = 'status-badge shadowed';
      earthBadge.textContent = '📵 DTE BLOCKED';
    }}

    statSunPctEl.textContent = res.statsSummary.sunPct;
    statMidValEl.textContent = res.statsSummary.radioPct;
    statMaxEclipseEl.textContent = res.statsSummary.maxEclipse;
  }}

  if (lastMouseClient && !transition.active) {{
    updateHoverCrosshair(lastMouseClient.x, lastMouseClient.y);
  }}
}}

function easeInCubic(t) {{ return t * t * t; }}
function easeOutCubic(t) {{ return 1 - Math.pow(1 - t, 3); }}

function activateTileScope(tileIdx) {{
  const tile = LUNAR_TILES[tileIdx];
  TileDetailView.loadTile(tile);
  TileDetailView.setMapMode(GlobalView.getMapMode());

  viewScope = 'tile';
  GlobalView.disableShadows();
  GlobalView.group.visible = false;
  GlobalView.setHoveredTile(-1);

  TileDetailView.group.visible = true;
  TileDetailView.setMapMode(TileDetailView.getMapMode());

  controls.minDistance = 20.0;
  controls.maxDistance = 650.0;
  controls.target.set(0, 0, 0);

  syncHUDForScope();
  applyEphemerisStep(Math.round(currentStepFloat));
  TileDetailView.updateScaleOrientation();
}}

function activateGlobalScope() {{
  viewScope = 'global';
  TileDetailView.disableShadows();
  TileDetailView.group.visible = false;
  TileDetailView.hideCrosshair();

  GlobalView.group.visible = true;
  GlobalView.setMapMode(TileDetailView.getMapMode());

  controls.minDistance = GlobalView.R_MOON_W * 1.05;
  controls.maxDistance = GlobalView.R_MOON_W * 6.5;

  syncHUDForScope();
  applyEphemerisStep(Math.round(currentStepFloat));
}}

function startTransitionToTile(tileIdx) {{
  if (transition.active || viewScope === 'tile') return;

  GlobalView.setSelectedTile(tileIdx);
  const tile = LUNAR_TILES[tileIdx];
  const latDir = tile.lat >= 0 ? 'N' : 'S';
  const lonDir = tile.lon >= 0 ? 'E' : 'W';

  tooltip.style.display = 'none';
  GlobalView.setHoveredTile(-1);

  transition.active = true;
  transition.direction = 'toTile';
  transition.elapsed = 0;
  transition.duration = 1.35;
  transition.midpointSwitched = false;
  transition.targetTileIdx = tileIdx;

  transition.savedGlobalCamPos.copy(camera.position);
  transition.savedGlobalTarget.copy(controls.target);
  transition.startCamPos.copy(camera.position);
  transition.startTarget.copy(controls.target);

  const surfPt = GlobalView.siteOrigin.clone();
  const surfNorm = GlobalView.siteUpDir.clone();
  const sideRef = Math.abs(surfNorm.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const tangent = new THREE.Vector3().crossVectors(sideRef, surfNorm).normalize();

  transition.midGlobalTarget.copy(surfPt);
  transition.midGlobalCamPos.copy(surfPt)
    .addScaledVector(surfNorm, GlobalView.R_MOON_W * 0.22)
    .addScaledVector(tangent, GlobalView.R_MOON_W * 0.12);

  transitionLabel.textContent = `Lade Max-Detail Quadrat ${{tile.idLabel}} (${{Math.abs(tile.lat).toFixed(1)}}° ${{latDir}}, ${{Math.abs(tile.lon).toFixed(1)}}° ${{lonDir}})...`;
  controls.enabled = false;
}}

function startTransitionToGlobal() {{
  if (transition.active || viewScope === 'global') return;

  tooltip.style.display = 'none';
  TileDetailView.hideCrosshair();

  transition.active = true;
  transition.direction = 'toGlobal';
  transition.elapsed = 0;
  transition.duration = 1.30;
  transition.midpointSwitched = false;

  transition.startCamPos.copy(camera.position);
  transition.startTarget.copy(controls.target);

  const surfPt = GlobalView.siteOrigin.clone();
  const surfNorm = GlobalView.siteUpDir.clone();
  const sideRef = Math.abs(surfNorm.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const tangent = new THREE.Vector3().crossVectors(sideRef, surfNorm).normalize();

  transition.midGlobalTarget.copy(surfPt);
  transition.midGlobalCamPos.copy(surfPt)
    .addScaledVector(surfNorm, GlobalView.R_MOON_W * 0.22)
    .addScaledVector(tangent, GlobalView.R_MOON_W * 0.12);

  transitionLabel.textContent = 'Zurück zur globalen Mondansicht...';
  controls.enabled = false;
}}

function updateTransition(dtSec) {{
  if (!transition.active) return;

  transition.elapsed += dtSec;
  const rawT = Math.min(1.0, transition.elapsed / transition.duration);

  if (transition.direction === 'toTile') {{
    const split = 0.55;
    if (rawT < split) {{
      const u = easeInCubic(rawT / split);
      camera.position.lerpVectors(transition.startCamPos, transition.midGlobalCamPos, u);
      controls.target.lerpVectors(transition.startTarget, transition.midGlobalTarget, u);
      camera.lookAt(controls.target);

      const veilAlpha = THREE.MathUtils.smoothstep(rawT, 0.36, split);
      transitionVeil.style.opacity = veilAlpha.toFixed(3);
    }} else {{
      if (!transition.midpointSwitched) {{
        transition.midpointSwitched = true;
        activateTileScope(transition.targetTileIdx);
      }}
      const u = easeOutCubic((rawT - split) / (1.0 - split));
      camera.position.lerpVectors(TileDetailView.approachCamPos, TileDetailView.defaultCamPos, u);
      controls.target.set(0, 0, 0);
      camera.lookAt(0, 0, 0);
      TileDetailView.updateScaleOrientation();

      const veilAlpha = 1.0 - THREE.MathUtils.smoothstep(rawT, split, split + 0.18);
      transitionVeil.style.opacity = veilAlpha.toFixed(3);
    }}
  }} else {{
    const split = 0.45;
    if (rawT < split) {{
      const u = easeInCubic(rawT / split);
      camera.position.lerpVectors(transition.startCamPos, TileDetailView.approachCamPos, u);
      controls.target.lerpVectors(transition.startTarget, new THREE.Vector3(0, 0, 0), u);
      camera.lookAt(controls.target);
      TileDetailView.updateScaleOrientation();

      const veilAlpha = THREE.MathUtils.smoothstep(rawT, 0.26, split);
      transitionVeil.style.opacity = veilAlpha.toFixed(3);
    }} else {{
      if (!transition.midpointSwitched) {{
        transition.midpointSwitched = true;
        activateGlobalScope();
      }}
      const u = easeOutCubic((rawT - split) / (1.0 - split));
      camera.position.lerpVectors(transition.midGlobalCamPos, transition.savedGlobalCamPos, u);
      controls.target.lerpVectors(transition.midGlobalTarget, transition.savedGlobalTarget, u);
      camera.lookAt(controls.target);

      const veilAlpha = 1.0 - THREE.MathUtils.smoothstep(rawT, split, split + 0.18);
      transitionVeil.style.opacity = veilAlpha.toFixed(3);
    }}
  }}

  if (rawT >= 1.0) {{
    transition.active = false;
    transitionVeil.style.opacity = '0';
    controls.enabled = true;
    controls.update();
  }}
}}

syncHUDForScope();
applyEphemerisStep(0);

enterTileBtn.addEventListener('click', () => startTransitionToTile(GlobalView.getSelectedTileIdx()));
backToGlobalBtn.addEventListener('click', () => startTransitionToGlobal());

window.addEventListener('keydown', (e) => {{
  if (e.key === 'Escape' && viewScope === 'tile' && !transition.active) {{
    startTransitionToGlobal();
  }}
}});

document.querySelectorAll('#map-mode-selector .mode-btn').forEach((btn) => {{
  btn.addEventListener('click', () => {{
    if (btn.classList.contains('disabled')) return;
    if (viewScope === 'global') {{
      GlobalView.setMapMode(btn.dataset.mode);
    }} else {{
      TileDetailView.setMapMode(btn.dataset.mode);
    }}
    syncHUDForScope();
    applyEphemerisStep(Math.round(currentStepFloat));
  }});
}});

tileGridToggleRow.addEventListener('click', () => {{
  const next = !GlobalView.getShowTileGrid();
  GlobalView.setShowTileGrid(next);
  document.getElementById('tilegrid-switch-pill').classList.toggle('on', next);
}});

graticuleToggleRow.addEventListener('click', () => {{
  const next = !GlobalView.getShowGraticule();
  GlobalView.setShowGraticule(next);
  document.getElementById('graticule-switch-pill').classList.toggle('on', next);
}});

document.getElementById('contour-toggle-row').addEventListener('click', () => {{
  if (viewScope === 'global') {{
    GlobalView.setShowContours(!GlobalView.getShowContours());
  }} else {{
    TileDetailView.setShowContours(!TileDetailView.getShowContours());
  }}
  syncHUDForScope();
}});

finenessSlider.addEventListener('input', (e) => {{
  const rawVal = parseInt(e.target.value, 10);
  if (viewScope === 'global') {{
    const iv = 2750 - rawVal;
    const lines = GlobalView.setContourInterval(iv);
    contourValEl.textContent = `${{iv.toLocaleString()}} m (${{lines}} lines)`;
  }} else {{
    const iv = 1050 - rawVal;
    const lines = TileDetailView.setContourInterval(iv);
    contourValEl.textContent = `${{iv}} m (${{lines}} lines)`;
  }}
}});

playBtn.addEventListener('click', () => {{
  isPlaying = !isPlaying;
  playBtn.textContent = isPlaying ? '⏸ Pause' : '▶ Play';
}});

document.getElementById('step-back-btn').addEventListener('click', () => {{
  isPlaying = false;
  playBtn.textContent = '▶ Play';
  applyEphemerisStep(Math.max(0, Math.round(currentStepFloat) - 1));
}});

document.getElementById('step-fwd-btn').addEventListener('click', () => {{
  isPlaying = false;
  playBtn.textContent = '▶ Play';
  applyEphemerisStep(Math.min(TOTAL_STEPS - 1, Math.round(currentStepFloat) + 1));
}});

document.getElementById('speed-select').addEventListener('change', (e) => {{
  playbackHoursPerSec = parseFloat(e.target.value);
}});

timeSlider.addEventListener('input', (e) => {{
  isPlaying = false;
  playBtn.textContent = '▶ Play';
  applyEphemerisStep(parseInt(e.target.value, 10));
}});

const _hitPoint = new THREE.Vector3();
const _hitNormal = new THREE.Vector3();
const _hitInfo = {{ latDeg: 0, lonDeg: 0, elevM: 0, surfaceR: 0 }};

function updateHoverCrosshair(clientX, clientY) {{
  if (transition.active) return;
  const ndcX = (clientX / window.innerWidth) * 2 - 1;
  const ndcY = -(clientY / window.innerHeight) * 2 + 1;

  if (viewScope === 'global') {{
    const hitGlobe = GlobalView.raycastLunarSphere(ndcX, ndcY, _hitPoint, _hitNormal, _hitInfo);

    if (hitGlobe) {{
      const tileIdx = GlobalView.findTileIndexAtWorldPoint(_hitPoint);
      GlobalView.setHoveredTile(tileIdx);
      renderer.domElement.style.cursor = tileIdx >= 0 ? 'pointer' : 'crosshair';

      const latDir = _hitInfo.latDeg >= 0 ? 'N' : 'S';
      const lonDir = _hitInfo.lonDeg >= 0 ? 'E' : 'W';
      const gMode = GlobalView.getMapMode();

      let html = '';
      if (tileIdx >= 0) {{
        const t = LUNAR_TILES[tileIdx];
        const tLatDir = t.lat >= 0 ? 'N' : 'S';
        const tLonDir = t.lon >= 0 ? 'E' : 'W';
        html += `<b>🧩 Quadrat ${{t.idLabel}} (200×200 km)</b><br/>` +
                `<b>Zentrum:</b> ${{Math.abs(t.lat).toFixed(2)}}° ${{tLatDir}}, ${{Math.abs(t.lon).toFixed(2)}}° ${{tLonDir}}<br/>`;
      }}

      html += `
        <b>Cursor:</b> ${{Math.abs(_hitInfo.latDeg).toFixed(2)}}° ${{latDir}}, ${{Math.abs(_hitInfo.lonDeg).toFixed(2)}}° ${{lonDir}} • <b>Höhe:</b> ${{_hitInfo.elevM.toFixed(0)}} m
      `;

      if (gMode === 'shadow') {{
        const illum = GlobalView.evaluateSurfaceIllumination(_hitPoint, _hitNormal);
        html += `
          <hr class="tt-divider"/>
          <b>Status:</b> ${{illum.statusHtml}}<br/>
          <b>Illumination:</b> ${{illum.illumPct.toFixed(1)}}% (${{illum.fluxWm2}} W/m²) • <b>Sun Disk:</b> ${{illum.diskPct}}%
        `;
      }} else if (gMode === 'sunexp' && HAS_EXPOSURE_MAPS) {{
        const sunPct = GlobalView.sampleSunExp(_hitInfo.latDeg, _hitInfo.lonDeg) * 100.0;
        const sunHrs = Math.round((sunPct / 100.0) * TOTAL_STEPS);
        html += `
          <hr class="tt-divider"/>
          <b>Avg Sunlight (2027):</b> <span class="tt-lit">${{sunPct.toFixed(1)}}%</span> (${{sunHrs.toLocaleString()}} h/yr)
        `;
      }} else if (gMode === 'radio' && HAS_EXPOSURE_MAPS) {{
        const radPct = GlobalView.sampleRadioExp(_hitInfo.latDeg, _hitInfo.lonDeg) * 100.0;
        const radHrs = Math.round((radPct / 100.0) * TOTAL_STEPS);
        html += `
          <hr class="tt-divider"/>
          <b>Radio Exposure (2027):</b> <span class="tt-radio">${{radPct.toFixed(1)}}%</span> (${{radHrs.toLocaleString()}} h/yr)
        `;
      }}

      if (tileIdx >= 0) {{
        html += `<hr class="tt-divider"/><span class="tt-cta">🔍 Klicken für Max-Detail 3D-Ansicht</span>`;
      }}

      tooltip.style.display = 'block';
      tooltip.style.left = `${{Math.min(window.innerWidth - 285, clientX + 16)}}px`;
      tooltip.style.top = `${{Math.min(window.innerHeight - 250, clientY + 16)}}px`;
      tooltip.innerHTML = html;
    }} else {{
      renderer.domElement.style.cursor = 'default';
      tooltip.style.display = 'none';
      GlobalView.setHoveredTile(-1);
    }}
  }} else {{
    if (TileDetailView.raycastTerrainGrid(ndcX, ndcY, _hitPoint, _hitNormal)) {{
      renderer.domElement.style.cursor = 'crosshair';
      TileDetailView.updateCrosshairGeometry(_hitPoint.x, _hitPoint.y, _hitPoint.z, _hitNormal);
      const pts = TileDetailView.getPointCoords(_hitPoint);
      const latDir = pts.lat >= 0 ? 'N' : 'S';
      const lonDir = pts.lon >= 0 ? 'E' : 'W';
      const tMode = TileDetailView.getMapMode();

      let html = `
        <b>Lat:</b> ${{Math.abs(pts.lat).toFixed(3)}}° ${{latDir}} |
        <b>Lon:</b> ${{Math.abs(pts.lon).toFixed(3)}}° ${{lonDir}}<br/>
        <b>Lokal:</b> X ${{pts.xKm >= 0 ? '+' : ''}}${{pts.xKm.toFixed(1)}} km, Y ${{pts.yKm >= 0 ? '+' : ''}}${{pts.yKm.toFixed(1)}} km<br/>
        <b>Höhe:</b> ${{pts.elevM.toFixed(1)}} m
      `;

      if (tMode === 'shadow') {{
        const illum = TileDetailView.evaluateSurfaceIllumination(_hitPoint, _hitNormal);
        html += `
          <hr class="tt-divider"/>
          <b>Status:</b> ${{illum.statusHtml}}<br/>
          <b>Illumination:</b> ${{illum.illumPct.toFixed(1)}}% (${{illum.fluxWm2}} W/m²)<br/>
          <b>Incidence:</b> ${{illum.incidenceDeg.toFixed(1)}}° | <b>Slope:</b> ${{illum.slopeDeg.toFixed(1)}}°
        `;
      }} else if (tMode === 'sunexp' && HAS_EXPOSURE_MAPS) {{
        const sunPct = pts.sunExp * 100.0;
        html += `
          <hr class="tt-divider"/>
          <b>Avg Sunlight (2027):</b> <span class="tt-lit">${{sunPct.toFixed(1)}}%</span>
        `;
      }} else if (tMode === 'radio' && HAS_EXPOSURE_MAPS) {{
        const radPct = pts.radioExp * 100.0;
        html += `
          <hr class="tt-divider"/>
          <b>Radio Exposure (2027):</b> <span class="tt-radio">${{radPct.toFixed(1)}}%</span>
        `;
      }}

      tooltip.style.display = 'block';
      tooltip.style.left = `${{Math.min(window.innerWidth - 285, clientX + 16)}}px`;
      tooltip.style.top = `${{Math.min(window.innerHeight - 260, clientY + 16)}}px`;
      tooltip.innerHTML = html;
    }} else {{
      renderer.domElement.style.cursor = 'default';
      tooltip.style.display = 'none';
      TileDetailView.hideCrosshair();
    }}
  }}
}}

let pointerDownPos = null;
renderer.domElement.addEventListener('pointerdown', (e) => {{
  pointerDownPos = {{ x: e.clientX, y: e.clientY }};
}}, {{ passive: true }});

renderer.domElement.addEventListener('pointerup', (e) => {{
  if (!pointerDownPos || transition.active) return;
  const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
  pointerDownPos = null;

  if (dist < 5 && viewScope === 'global') {{
    const ndcX = (e.clientX / window.innerWidth) * 2 - 1;
    const ndcY = -(e.clientY / window.innerHeight) * 2 + 1;
    if (GlobalView.raycastLunarSphere(ndcX, ndcY, _hitPoint, _hitNormal, _hitInfo)) {{
      const clickedTileIdx = GlobalView.findTileIndexAtWorldPoint(_hitPoint);
      if (clickedTileIdx >= 0) {{
        startTransitionToTile(clickedTileIdx);
      }}
    }}
  }}
}}, {{ passive: true }});

let hoverTicking = false;
window.addEventListener('pointermove', (e) => {{
  lastMouseClient = {{ x: e.clientX, y: e.clientY }};
  if (!hoverTicking) {{
    requestAnimationFrame(() => {{
      if (lastMouseClient) updateHoverCrosshair(lastMouseClient.x, lastMouseClient.y);
      hoverTicking = false;
    }});
    hoverTicking = true;
  }}
}}, {{ passive: true }});

renderer.domElement.addEventListener('pointerleave', () => {{
  lastMouseClient = null;
  tooltip.style.display = 'none';
  GlobalView.setHoveredTile(-1);
  TileDetailView.hideCrosshair();
}});

window.addEventListener('resize', () => {{
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}}, {{ passive: true }});

let lastFrameTime = performance.now();
const _lastCamPos = new THREE.Vector3(Infinity, Infinity, Infinity);

function animate(now) {{
  requestAnimationFrame(animate);
  const dtSec = Math.min(0.1, (now - lastFrameTime) / 1000);
  lastFrameTime = now;

  if (isPlaying) {{
    const prevIdx = Math.round(currentStepFloat);
    currentStepFloat = (currentStepFloat + playbackHoursPerSec * dtSec) % TOTAL_STEPS;
    const nextIdx = Math.round(currentStepFloat);
    if (nextIdx !== prevIdx) {{
      applyEphemerisStep(nextIdx);
    }}
  }}

  if (transition.active) {{
    updateTransition(dtSec);
  }} else {{
    controls.update();
  }}

  if (viewScope === 'tile' && camera.position.distanceToSquared(_lastCamPos) > 1e-6) {{
    TileDetailView.updateScaleOrientation();
    _lastCamPos.copy(camera.position);
  }}

  renderer.render(scene, camera);
}}
animate(performance.now());
</script>
</body>
</html>
"""

Path(OUTPUT_HTML).write_text(html_template, encoding="utf-8")
print(f"Tiered Global Globe + {total_tiles_count:,} x (200x200 km, {TILE_GRID_RES}px) Tiles saved to '{OUTPUT_HTML}'")
webbrowser.open(Path(OUTPUT_HTML).resolve().as_uri())
