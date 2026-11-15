import base64
import json
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.transform import from_bounds
from rasterio.warp import Resampling, reproject


# =============================================================================
# 🌕 MOND-KOORDINATEN & PROJEKTION (SHACKLETON RIM / SITE 04)
# =============================================================================
LUNAR_RADIUS_M = 1737400.0

MOON_SOUTH_POLE_CRS = CRS.from_proj4(
    f"+proj=stere +lat_0=-90 +lon_0=0 +k=1 +x_0=0 +y_0=0 +R={LUNAR_RADIUS_M} +units=m +no_defs"
)

# Zentrum der 200x200 km Karte (Shackleton Rim)
SHACKLETON_RIM_LAT = -89.7668
SHACKLETON_RIM_LON = -171.8700


def latlon_to_south_polar_stere_m(lat_deg: float, lon_deg: float):
    lat_rad = np.radians(lat_deg)
    lon_rad = np.radians(lon_deg)
    chi = (np.pi / 2.0) + lat_rad
    r = 2.0 * LUNAR_RADIUS_M * np.tan(chi / 2.0)
    return float(r * np.sin(lon_rad)), float(r * np.cos(lon_rad))


def south_polar_stere_m_to_latlon(x_m: float, y_m: float):
    r = np.hypot(x_m, y_m)
    chi = 2.0 * np.arctan2(r, 2.0 * LUNAR_RADIUS_M)
    lat_deg = np.degrees(chi - (np.pi / 2.0))
    lon_east_deg = np.degrees(np.arctan2(x_m, y_m)) % 360.0
    return float(lat_deg), float(lon_east_deg)


# =============================================================================
# 🛰️ JPL HORIZONS API: 1-JAHRES-EPHEMERIDEN (SONNE & ERDE VOM MOND AUS)
# =============================================================================
def fetch_jpl_horizons_body_1yr(
    command_id: str,
    body_label: str,
    lat_deg: float,
    lon_east_deg: float,
    start_date_str: str = "2026-01-01",
):
    start_dt = datetime.strptime(start_date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    stop_dt = start_dt + timedelta(days=365)
    stop_date_str = stop_dt.strftime("%Y-%m-%d")

    params = {
        "format": "json",
        "COMMAND": f"'{command_id}'",
        "OBJ_DATA": "'NO'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'",
        "CENTER": "'coord@301'",
        "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": f"'{lon_east_deg:.4f},{lat_deg:.4f},0'",
        "START_TIME": f"'{start_date_str}'",
        "STOP_TIME": f"'{stop_date_str}'",
        "STEP_SIZE": "'3 h'",
        "QUANTITIES": "'4'",
        "ANG_FORMAT": "'DEG'",
        "CSV_FORMAT": "'YES'",
    }

    url = "https://ssd.jpl.nasa.gov/api/horizons.api?" + urllib.parse.urlencode(params)
    print(f"🛰️ Lade 1 Jahr {body_label}-Ephemeriden von JPL Horizons...")

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "LunarViewer/3.2"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            payload = json.loads(resp.read().decode("utf-8"))

        result_text = payload.get("result", "")
        if "$$SOE" not in result_text or "$$EOE" not in result_text:
            raise ValueError("Keine Ephemeriden im JPL-Response.")

        ephem_block = result_text.split("$$SOE")[1].split("$$EOE")[0].strip()
        records = []
        for line in ephem_block.splitlines():
            parts = [p.strip() for p in line.split(",") if p.strip() != ""]
            if len(parts) < 3:
                continue
            ts_str = parts[0]
            nums = []
            for p in parts[1:]:
                try:
                    nums.append(float(p))
                except ValueError:
                    continue
            if len(nums) >= 2:
                records.append([ts_str, round(nums[-2], 3), round(nums[-1], 3)])

        if len(records) < 100:
            raise ValueError("Zu wenige JPL-Datenpunkte.")

        print(f"✅ {body_label} (JPL Horizons) geladen: {len(records)} Punkte.")
        return {"source": "NASA JPL Horizons API", "step_hours": 3.0, "data": records}

    except Exception as exc:
        print(f"⚠️ JPL Horizons Offline-Fallback für {body_label} ({exc})...")
        n_steps = int(365 * 24 / 3) + 1
        records = []
        lat1 = np.radians(lat_deg)

        if command_id == "10":
            synodic_h = 29.530588 * 24.0
            year_h = 365.2422 * 24.0
            for i in range(n_steps):
                dt = start_dt + timedelta(hours=i * 3)
                h = i * 3.0
                sub_lon = (180.0 - (360.0 * h / synodic_h)) % 360.0
                sub_lat = 1.5424 * np.sin(2.0 * np.pi * (h / year_h) - 0.4)
                dlon = np.radians(sub_lon - lon_east_deg)
                lat2 = np.radians(sub_lat)
                sin_el = np.sin(lat1) * np.sin(lat2) + np.cos(lat1) * np.cos(lat2) * np.cos(dlon)
                el_deg = float(np.degrees(np.arcsin(np.clip(sin_el, -1.0, 1.0))))
                y_az = np.sin(dlon) * np.cos(lat2)
                x_az = np.cos(lat1) * np.sin(lat2) - np.sin(lat1) * np.cos(lat2) * np.cos(dlon)
                az_deg = float((np.degrees(np.arctan2(y_az, x_az)) + 360.0) % 360.0)
                records.append([dt.strftime("%Y-%b-%d %H:%M"), round(az_deg, 3), round(el_deg, 3)])
        else:
            anom_h = 27.55455 * 24.0
            drac_h = 27.21222 * 24.0
            for i in range(n_steps):
                dt = start_dt + timedelta(hours=i * 3)
                h = i * 3.0
                sub_lon = (7.9 * np.sin(2.0 * np.pi * h / anom_h)) % 360.0
                sub_lat = 6.7 * np.sin(2.0 * np.pi * h / drac_h + 0.8)
                dlon = np.radians(sub_lon - lon_east_deg)
                lat2 = np.radians(sub_lat)
                sin_el = np.sin(lat1) * np.sin(lat2) + np.cos(lat1) * np.cos(lat2) * np.cos(dlon)
                el_deg = float(np.degrees(np.arcsin(np.clip(sin_el, -1.0, 1.0))))
                y_az = np.sin(dlon) * np.cos(lat2)
                x_az = np.cos(lat1) * np.sin(lat2) - np.sin(lat1) * np.cos(lat2) * np.cos(dlon)
                az_deg = float((np.degrees(np.arctan2(y_az, x_az)) + 360.0) % 360.0)
                records.append([dt.strftime("%Y-%b-%d %H:%M"), round(az_deg, 3), round(el_deg, 3)])

        return {"source": "Astronomisches Mond-Modell (Offline)", "step_hours": 3.0, "data": records}


def resolve_source_crs(src):
    if src.crs is not None:
        return src.crs
    b = src.bounds
    if abs(b.left) <= 360 and abs(b.right) <= 360 and abs(b.bottom) <= 90 and abs(b.top) <= 90:
        return CRS.from_proj4(f"+proj=longlat +R={LUNAR_RADIUS_M} +no_defs")
    return MOON_SOUTH_POLE_CRS


def read_reprojected_window(tif_path: str, bounds_m: tuple, out_size: int):
    min_x, min_y, max_x, max_y = bounds_m
    dst_transform = from_bounds(min_x, min_y, max_x, max_y, out_size, out_size)
    dst_array = np.full((out_size, out_size), np.nan, dtype=np.float32)

    with rasterio.open(tif_path) as src:
        src_crs = resolve_source_crs(src)
        raw = src.read(1).astype(np.float32)

        if src.nodata is not None:
            raw = np.where(np.isclose(raw, src.nodata), np.nan, raw)
        raw = np.where(~np.isfinite(raw), np.nan, raw)

        scale = float(src.scales[0]) if src.scales else 1.0
        offset = float(src.offsets[0]) if src.offsets else 0.0
        if scale != 1.0 or offset != 0.0:
            raw = raw * scale + offset

        reproject(
            source=raw,
            destination=dst_array,
            src_transform=src.transform,
            src_crs=src_crs,
            src_nodata=np.nan,
            dst_transform=dst_transform,
            dst_crs=MOON_SOUTH_POLE_CRS,
            dst_nodata=np.nan,
            resampling=Resampling.bilinear,
        )

    valid_max = float(np.nanmax(np.abs(dst_array))) if np.any(np.isfinite(dst_array)) else 0.0
    if valid_max > 50.0:
        dst_array = dst_array / 1000.0

    return dst_array


def pack_dem_raw_uint16_b64(dem_km: np.ndarray, z_min_km: float, z_max_km: float) -> str:
    """Direkte 16-Bit Base64-Kodierung ohne Kompression -> 0 ms Ladezeit im Browser."""
    span = max(z_max_km - z_min_km, 1e-6)
    norm = np.clip((dem_km - z_min_km) / span, 0.0, 1.0)
    u16 = np.round(norm * 65535.0).astype(">u2")
    return base64.b64encode(u16.tobytes()).decode("ascii")


def generate_linear_web_3d_viewer():
    # =========================================================================
    # 🗺️ EINGABEDATEI & AUFLÖSUNG (200 x 200 km ÜBERSICHTSKARTE)
    # =========================================================================
    global_tif_path = "LDEM64_PA_pixel_202405 copy.tif"
    global_extent_km = 200.0   # 200 x 200 km (±100 km)
    dem_tex_size = 512         # 512 x 512 px (~390 m/px, volle LDEM64-Auflösung)

    # =========================================================================
    # 📍 KARTENZENTRUM & JPL EPHEMERIDEN BESTIMMEN
    # =========================================================================
    center_x_m, center_y_m = latlon_to_south_polar_stere_m(
        SHACKLETON_RIM_LAT, SHACKLETON_RIM_LON
    )
    print(f"📍 Kartenzentrum: X = {center_x_m/1000:.3f} km, Y = {center_y_m/1000:.3f} km")

    site_lat_deg, site_lon_east_deg = south_polar_stere_m_to_latlon(center_x_m, center_y_m)
    jpl_sun = fetch_jpl_horizons_body_1yr("10", "Sonne", site_lat_deg, site_lon_east_deg, "2026-01-01")
    jpl_earth = fetch_jpl_horizons_body_1yr("399", "Erde", site_lat_deg, site_lon_east_deg, "2026-01-01")

    half_g_m = (global_extent_km * 1000.0) / 2.0
    global_bounds_m = (
        center_x_m - half_g_m,
        center_y_m - half_g_m,
        center_x_m + half_g_m,
        center_y_m + half_g_m,
    )

    # =========================================================================
    # 🗺️ 200x200 KM KARTE LADEN
    # =========================================================================
    try:
        dem = read_reprojected_window(global_tif_path, global_bounds_m, dem_tex_size)
        print(f"✅ GeoTIFF geladen: {global_tif_path} ({dem_tex_size}×{dem_tex_size} px)")
    except FileNotFoundError:
        print("⚠️ GeoTIFF-Datei nicht gefunden. Nutze synthetische Dummy-Daten.")
        x_d = np.linspace(-100, 100, dem_tex_size, dtype=np.float32)
        xx_d, yy_d = np.meshgrid(x_d, x_d[::-1])
        rng = np.random.default_rng(42)
        dem = 0.55 * np.sin(xx_d / 32.0) * np.cos(yy_d / 28.0)
        for _ in range(22):
            cx, cy = rng.uniform(-85, 85), rng.uniform(-85, 85)
            cr = rng.uniform(5.0, 22.0)
            cd = rng.uniform(0.7, 2.8)
            dist = np.hypot(xx_d - cx, yy_d - cy)
            dem += (0.35 * cd) * np.exp(-((dist - cr) ** 2) / (0.12 * cr**2)) - cd * np.exp(-(dist**2) / (0.55 * cr**2))

    dem_median = float(np.nanmedian(dem)) if np.any(np.isfinite(dem)) else 0.0
    dem = np.where(np.isfinite(dem), dem, dem_median).astype(np.float32)

    z_min = float(np.min(dem))
    z_max = float(np.max(dem))
    dem_b64 = pack_dem_raw_uint16_b64(dem, z_min, z_max)

    # =========================================================================
    # 🌐 HTML & EIGENSTÄNDIGER WEBGL2 VIEWER
    # =========================================================================
    output_filename = "mond_3d_linear_viewer.html"
    print(f"Generiere eigenständigen WebGL2-Viewer: {output_filename}...")

    html_content = """<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <title>Mond Südpol - 3D Viewer (200×200 km, 1:1:1 Maßstab &amp; JPL Sonne/Erde)</title>
    <style>
        * { box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
            background-color: #0b0d10;
            color: #f0f2f5;
            margin: 0;
            padding: 10px 14px;
            display: flex;
            flex-direction: column;
            height: 100vh;
            overflow: hidden;
        }
        .header-bar {
            width: 100%;
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
            flex-wrap: wrap;
            gap: 8px;
        }
        h2 { margin: 0 0 2px 0; font-size: 16px; }
        .subtitle { color: #9aa0a6; margin: 0; font-size: 12px; }
        .controls-right {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
        }
        .control-box {
            background: #161920;
            padding: 5px 10px;
            border-radius: 7px;
            border: 1px solid #2b303b;
            display: flex;
            align-items: center;
            gap: 7px;
            font-size: 12px;
        }
        .action-btn {
            background: #1e232d;
            color: #e2e8f0;
            border: 1px solid #333b48;
            border-radius: 6px;
            padding: 6px 10px;
            font-size: 12px;
            cursor: pointer;
        }
        .action-btn:hover { background: #2a3140; }
        .mode-toggle {
            display: flex;
            background: #14171c;
            border: 1px solid #323844;
            border-radius: 7px;
            overflow: hidden;
        }
        .mode-btn {
            border: none;
            background: transparent;
            color: #9aa0a6;
            padding: 7px 13px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
        }
        .mode-btn.active { background: #2563eb; color: #ffffff; }
        .mode-btn.active.solar { background: #d97706; color: #ffffff; }

        #solar-panel {
            width: 100%;
            background: #14181f;
            border: 1px solid #2b313e;
            border-radius: 7px;
            padding: 8px 12px;
            margin-bottom: 8px;
            display: none;
            flex-direction: column;
            gap: 7px;
        }
        .solar-top-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 10px;
        }
        .play-btn {
            background: #f59e0b;
            color: #111827;
            border: none;
            border-radius: 6px;
            padding: 6px 14px;
            font-weight: 700;
            font-size: 12.5px;
            cursor: pointer;
            min-width: 96px;
        }
        .play-btn.playing { background: #ef4444; color: #ffffff; }
        .timeline-wrap {
            flex: 1;
            min-width: 180px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        #time-slider { flex: 1; accent-color: #f59e0b; cursor: pointer; }
        .telemetry-badges { display: flex; gap: 6px; flex-wrap: wrap; }
        .badge {
            background: #1e232b;
            border: 1px solid #303746;
            padding: 3px 8px;
            border-radius: 5px;
            font-family: monospace;
            font-size: 11.5px;
        }
        .badge span.sun { color: #fbbf24; font-weight: 600; }
        .badge span.earth { color: #38bdf8; font-weight: 600; }

        .speed-bar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 8px;
            padding-top: 6px;
            border-top: 1px solid #242934;
            font-size: 11.5px;
        }
        .speed-group { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
        .speed-btn {
            background: #1e232b;
            color: #cbd5e1;
            border: 1px solid #323948;
            border-radius: 4px;
            padding: 3px 8px;
            font-size: 11px;
            cursor: pointer;
        }
        .speed-btn.active { background: #f59e0b; color: #111827; border-color: #f59e0b; font-weight: 700; }
        .checkbox-group { display: flex; align-items: center; gap: 12px; color: #cbd5e1; }
        .checkbox-group label { display: flex; align-items: center; gap: 4px; cursor: pointer; }

        .workspace {
            width: 100%;
            flex: 1;
            min-height: 0;
            display: flex;
            gap: 10px;
        }
        #viewport-wrap {
            flex: 1;
            height: 100%;
            position: relative;
            background: #07090d;
            border-radius: 8px;
            border: 1px solid #262b35;
            overflow: hidden;
        }
        #gl-canvas {
            width: 100%;
            height: 100%;
            display: block;
            cursor: grab;
        }
        #gl-canvas:active { cursor: grabbing; }
        .hud-overlay {
            position: absolute;
            bottom: 10px;
            left: 10px;
            background: rgba(15, 18, 24, 0.85);
            border: 1px solid #2d3442;
            border-radius: 6px;
            padding: 6px 10px;
            font-size: 11.5px;
            color: #cbd5e1;
            pointer-events: none;
        }
        .colorbar-overlay {
            position: absolute;
            right: 12px;
            top: 12px;
            background: rgba(15, 18, 24, 0.85);
            border: 1px solid #2d3442;
            border-radius: 6px;
            padding: 8px;
            display: flex;
            flex-direction: column;
            align-items: center;
            font-size: 11px;
            pointer-events: none;
        }
        .colorbar-grad {
            width: 14px;
            height: 120px;
            border-radius: 3px;
            margin: 5px 0;
            background: linear-gradient(to top, #081d58, #225ea8, #1d91c0, #41b6c4, #7fcdbb, #c7e9b4, #ffffd9);
        }
        #error-box {
            position: absolute;
            top: 12px;
            left: 12px;
            background: #7f1d1d;
            color: #fecaca;
            border: 1px solid #ef4444;
            padding: 10px 14px;
            border-radius: 6px;
            font-family: monospace;
            font-size: 12px;
            display: none;
            z-index: 30;
        }
        #ephem-sidebar {
            width: 350px;
            height: 100%;
            background: #14171c;
            border-radius: 8px;
            border: 1px solid #262b35;
            padding: 10px;
            display: none;
            flex-direction: column;
        }
        #ephem-canvas {
            width: 100%;
            flex: 1;
            margin-top: 6px;
            cursor: crosshair;
            border-radius: 5px;
            background: #181c23;
        }
    </style>
</head>
<body>

    <div class="header-bar">
        <div>
            <h2>Mond-Südpol – 200×200 km Übersicht (1:1:1 Maßstab)</h2>
            <p class="subtitle" id="mode-subtitle">Topographie-Modus • 1 km Z = 1 km X/Y • 200×200 km Fläche deckend</p>
        </div>
        <div class="controls-right">
            <button class="action-btn" id="btn-reset">🎯 Ansicht zurücksetzen</button>

            <div class="control-box" id="contour-box">
                <label style="display:flex; align-items:center; gap:4px; cursor:pointer;">
                    <input type="checkbox" id="chk-contours" checked> Höhenlinien
                </label>
                <span>|</span>
                <label for="contour-slider">Feinheit:</label>
                <input type="range" id="contour-slider" min="0.05" max="1.0" step="0.025" value="0.20" style="width:85px;">
                <span id="contour-val" style="font-family:monospace; color:#93c5fd; min-width:44px;">200 m</span>
            </div>

            <div class="mode-toggle">
                <button class="mode-btn active" id="btn-mode-topo">🗺️ Topographie</button>
                <button class="mode-btn" id="btn-mode-solar">☀️ JPL Sonne &amp; Erde</button>
            </div>
        </div>
    </div>

    <div id="solar-panel">
        <div class="solar-top-row">
            <button class="play-btn" id="btn-play" type="button">▶ Start</button>
            <div class="timeline-wrap">
                <span style="font-size:11.5px; color:#9ca3af;">Jahr (JPL):</span>
                <input type="range" id="time-slider" min="0" max="1000" step="0.1" value="0">
            </div>
            <div class="telemetry-badges">
                <div class="badge">UTC: <span class="sun" id="val-time">--</span></div>
                <div class="badge">☀️ Az/El: <span class="sun" id="val-sun-azel">--° / --°</span></div>
                <div class="badge">🌍 Erde Az/El: <span class="earth" id="val-earth-azel">--° / --°</span></div>
            </div>
        </div>
        <div class="speed-bar">
            <div class="speed-group">
                <span style="color:#9ca3af; font-weight:600;">Geschwindigkeit:</span>
                <button class="speed-btn" data-speed="1">1 Std/s</button>
                <button class="speed-btn active" data-speed="6">6 Std/s</button>
                <button class="speed-btn" data-speed="24">1 Tag/s</button>
                <button class="speed-btn" data-speed="120">5 Tage/s</button>
                <button class="speed-btn" data-speed="360">15 Tage/s</button>
                <input type="range" id="speed-slider" min="0.5" max="480" step="0.5" value="6" style="width:95px; margin-left:4px;">
                <span id="speed-label" style="color:#fbbf24; font-family:monospace;">6.0 Std/s</span>
            </div>
            <div class="checkbox-group">
                <label><input type="checkbox" id="chk-rays" checked> Sonnenstrahlen</label>
                <label><input type="checkbox" id="chk-orbit" checked> Sonnenbahn</label>
                <label><input type="checkbox" id="chk-earth" checked> 🌍 Erde &amp; Bahn</label>
            </div>
        </div>
    </div>

    <div class="workspace">
        <div id="viewport-wrap">
            <div id="error-box"></div>
            <canvas id="gl-canvas"></canvas>
            <div class="colorbar-overlay" id="topo-colorbar">
                <span id="cb-max">+0.0 km</span>
                <div class="colorbar-grad"></div>
                <span id="cb-min">-0.0 km</span>
            </div>
            <div class="hud-overlay">
                <strong>Kamera:</strong> Linksklick = Rotieren • Rechtsklick / Shift = Verschieben • Mausrad = Zoom
            </div>
        </div>

        <div id="ephem-sidebar">
            <div style="font-size:12.5px; font-weight:600;">☀️ Sonne &amp; 🌍 Erde (Perspektive Mond)</div>
            <div style="font-size:11px; color:#9ca3af;" id="jpl-source-label">Quelle: --</div>
            <canvas id="ephem-canvas"></canvas>
        </div>
    </div>

    <script>
        window.onerror = function(msg, url, line) {
            const box = document.getElementById('error-box');
            box.style.display = 'block';
            box.textContent = 'WebGL/JS Fehler (Zeile ' + line + '): ' + msg;
        };

        // =====================================================================
        // 1. DATEN AUS PYTHON (SYNCHRONES SOFORT-DECODING)
        // =====================================================================
        const CFG = {
            globalBounds: __GLOBAL_BOUNDS__,
            centerX: __CENTER_X__,
            centerY: __CENTER_Y__,
            zMin: __Z_MIN__,
            zMax: __Z_MAX__,
            demSize: __DEM_SIZE__,
            demB64: "__DEM_B64__"
        };

        const jplSun = __JPL_SUN__;
        const jplEarth = __JPL_EARTH__;

        document.getElementById('cb-max').textContent = (CFG.zMax >= 0 ? '+' : '') + CFG.zMax.toFixed(2) + ' km';
        document.getElementById('cb-min').textContent = (CFG.zMin >= 0 ? '+' : '') + CFG.zMin.toFixed(2) + ' km';

        function decodeBase64ToBytes(b64) {
            const bin = atob(b64);
            const len = bin.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
            return bytes;
        }

        const demBytes = decodeBase64ToBytes(CFG.demB64);

        function sampleCpuHeight(bytes, size, u, v, zMin, zMax) {
            const cu = Math.max(0, Math.min(1, u)) * (size - 1);
            const cv = Math.max(0, Math.min(1, v)) * (size - 1);
            const c0 = Math.floor(cu), r0 = Math.floor(cv);
            const c1 = Math.min(size - 1, c0 + 1), r1 = Math.min(size - 1, r0 + 1);
            const tx = cu - c0, ty = cv - r0;
            const h = (r, c) => {
                const idx = (r * size + c) * 2;
                const u16 = (bytes[idx] << 8) | bytes[idx + 1];
                return zMin + (u16 / 65535.0) * (zMax - zMin);
            };
            return (h(r0, c0) * (1 - tx) + h(r0, c1) * tx) * (1 - ty) +
                   (h(r1, c0) * (1 - tx) + h(r1, c1) * tx) * ty;
        }

        const centerZKm = sampleCpuHeight(demBytes, CFG.demSize, 0.5, 0.5, CFG.zMin, CFG.zMax);

        // =====================================================================
        // 2. NATIVER WEBGL2 CONTEXT & SHADER
        // =====================================================================
        const canvas = document.getElementById('gl-canvas');
        const gl = canvas.getContext('webgl2', { antialias: true });
        if (!gl) {
            throw new Error("WebGL2 wird von diesem Browser nicht unterstützt.");
        }

        function createShader(type, source) {
            const sh = gl.createShader(type);
            gl.shaderSource(sh, source);
            gl.compileShader(sh);
            if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
                const log = gl.getShaderInfoLog(sh);
                gl.deleteShader(sh);
                throw new Error("Shader-Kompilierfehler: " + log);
            }
            return sh;
        }

        function createProgram(vsSrc, fsSrc) {
            const prog = gl.createProgram();
            gl.attachShader(prog, createShader(gl.VERTEX_SHADER, vsSrc));
            gl.attachShader(prog, createShader(gl.FRAGMENT_SHADER, fsSrc));
            gl.linkProgram(prog);
            if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
                throw new Error("Shader-Linkfehler: " + gl.getProgramInfoLog(prog));
            }
            return prog;
        }

        function createRG8Texture(bytes, size) {
            const tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, size, size, 0, gl.RG, gl.UNSIGNED_BYTE, bytes);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            return tex;
        }

        const demTex = createRG8Texture(demBytes, CFG.demSize);

        const commonGLSL = `#version 300 es
            precision highp float;
            precision highp int;
            precision highp sampler2D;

            uniform sampler2D uDemTex;
            uniform vec4 uGlobalBounds;
            uniform vec2 uZRange;
            uniform float uDemSize;

            float decodeRG(vec2 rg) {
                return (rg.r * 65280.0 + rg.g * 255.0) / 65535.0;
            }

            float sampleBilinear16(sampler2D tex, vec2 uv, float texSize, vec2 zRange) {
                uv = clamp(uv, 0.0, 1.0);
                vec2 p = uv * (texSize - 1.0);
                vec2 base = floor(p);
                vec2 f = p - base;
                float invS = 1.0 / texSize;
                vec2 b1 = min(base + 1.0, texSize - 1.0);

                float n00 = decodeRG(texture(tex, (base + 0.5) * invS).rg);
                float n10 = decodeRG(texture(tex, (vec2(b1.x, base.y) + 0.5) * invS).rg);
                float n01 = decodeRG(texture(tex, (vec2(base.x, b1.y) + 0.5) * invS).rg);
                float n11 = decodeRG(texture(tex, (b1 + 0.5) * invS).rg);

                float n = mix(mix(n00, n10, f.x), mix(n01, n11, f.x), f.y);
                return mix(zRange.x, zRange.y, n);
            }

            float sampleDemH(vec2 xy) {
                vec2 uv = vec2(
                    (xy.x - uGlobalBounds.x) / (uGlobalBounds.z - uGlobalBounds.x),
                    (uGlobalBounds.w - xy.y) / (uGlobalBounds.w - uGlobalBounds.y)
                );
                return sampleBilinear16(uDemTex, uv, uDemSize, uZRange);
            }
        `;

        // Terrain Vertex Shader
        const terrainVS = commonGLSL + `
            in vec2 aPosXY;
            uniform mat4 uMVP;
            out vec3 vWorldPos;

            void main() {
                float z = sampleDemH(aPosXY);
                vWorldPos = vec3(aPosXY, z);
                gl_Position = uMVP * vec4(vWorldPos, 1.0);
            }
        `;

        // Terrain Fragment Shader (Topographie + Höhenlinien + GPU-Raycasting auf gesamter 200x200 km Fläche)
        const terrainFS = commonGLSL + `
            in vec3 vWorldPos;
            uniform int uMode;
            uniform int uShowContours;
            uniform float uContourStep;
            uniform vec3 uSunDir;
            uniform float uSunElRad;
            out vec4 fragColor;

            const float MOON_R_KM = 1737.4;
            const float SOLAR_RAD = 0.00464;

            vec3 evalYlGnBu(float t) {
                t = clamp(t, 0.0, 1.0);
                vec3 c0 = vec3(0.031, 0.114, 0.345);
                vec3 c1 = vec3(0.133, 0.369, 0.659);
                vec3 c2 = vec3(0.114, 0.569, 0.753);
                vec3 c3 = vec3(0.255, 0.714, 0.769);
                vec3 c4 = vec3(0.498, 0.804, 0.733);
                vec3 c5 = vec3(0.780, 0.914, 0.706);
                vec3 c6 = vec3(1.000, 1.000, 0.851);
                float s = t * 6.0;
                if (s < 1.0) return mix(c0, c1, s);
                if (s < 2.0) return mix(c1, c2, s - 1.0);
                if (s < 3.0) return mix(c2, c3, s - 2.0);
                if (s < 4.0) return mix(c3, c4, s - 3.0);
                if (s < 5.0) return mix(c4, c5, s - 4.0);
                return mix(c5, c6, s - 5.0);
            }

            vec3 applyContours(vec3 baseCol, float zKm) {
                if (uShowContours == 0 || uContourStep <= 0.0) return baseCol;
                float coord = zKm / uContourStep;
                float fw = max(fwidth(coord), 1e-5);
                float dist = abs(fract(coord - 0.5) - 0.5) / fw;
                float minorLine = 1.0 - smoothstep(0.0, 1.35, dist);

                float majCoord = zKm / (uContourStep * 5.0);
                float majFw = max(fwidth(majCoord), 1e-5);
                float majDist = abs(fract(majCoord - 0.5) - 0.5) / majFw;
                float majorLine = 1.0 - smoothstep(0.0, 1.75, majDist);

                vec3 col = mix(baseCol, vec3(0.04, 0.06, 0.10), minorLine * 0.55);
                col = mix(col, vec3(0.98, 0.99, 1.00), majorLine * 0.65);
                return col;
            }

            void main() {
                float eps = 0.35;
                float zC = sampleDemH(vWorldPos.xy);
                float zL = sampleDemH(vWorldPos.xy - vec2(eps, 0.0));
                float zR = sampleDemH(vWorldPos.xy + vec2(eps, 0.0));
                float zD = sampleDemH(vWorldPos.xy - vec2(0.0, eps));
                float zU = sampleDemH(vWorldPos.xy + vec2(0.0, eps));

                vec3 N = normalize(vec3(-(zR - zL) / (2.0 * eps), -(zU - zD) / (2.0 * eps), 1.0));

                if (uMode == 0) {
                    float tNorm = (zC - uZRange.x) / max(uZRange.y - uZRange.x, 1e-5);
                    vec3 topoCol = evalYlGnBu(tNorm);
                    float hill = 0.72 + 0.28 * clamp(dot(N, normalize(vec3(-0.5, 0.6, 0.65))), 0.0, 1.0);
                    topoCol = applyContours(topoCol * hill, zC);
                    fragColor = vec4(topoCol, 1.0);
                    return;
                }

                // Solar-Modus: GPU-Raycasting über die gesamte 200x200 km Fläche
                float stopAngle = uSunElRad + SOLAR_RAD;
                if (stopAngle < -0.035) {
                    fragColor = vec4(vec3(0.012, 0.014, 0.018), 1.0);
                    return;
                }

                float mu0 = dot(N, uSunDir);
                if (mu0 <= 0.0) {
                    fragColor = vec4(vec3(0.012, 0.014, 0.018), 1.0);
                    return;
                }

                vec2 horizDir = normalize(uSunDir.xy + vec2(1e-8));
                float maxHorizAngle = -1.5708;
                float inv2R = 1.0 / (2.0 * MOON_R_KM);
                float tanStop = tan(stopAngle);

                float d = 0.35;
                float stepDist = 0.35;
                for (int i = 0; i < 220; i++) {
                    vec2 p = vWorldPos.xy + horizDir * d;
                    if (p.x < uGlobalBounds.x || p.x > uGlobalBounds.z || p.y < uGlobalBounds.y || p.y > uGlobalBounds.w) break;

                    float hT = sampleDemH(p) - (d * d) * inv2R;
                    float ang = atan(hT - zC, d);
                    if (ang > maxHorizAngle) {
                        maxHorizAngle = ang;
                        if (maxHorizAngle >= stopAngle) break;
                    }
                    if (zC + d * tanStop - (d * d) * inv2R > uZRange.y + 0.05) break;

                    d += stepDist;
                    if (d > 12.0) stepDist = 0.9;
                    if (d > 65.0) stepDist = 1.8;
                }

                float lit = 1.0;
                if (maxHorizAngle >= stopAngle) {
                    lit = 0.0;
                } else if (maxHorizAngle > uSunElRad - SOLAR_RAD) {
                    lit = clamp((stopAngle - maxHorizAngle) / (2.0 * SOLAR_RAD), 0.0, 1.0);
                }

                float lommel = (mu0 / (mu0 + 0.30)) * 0.88 + 0.24 * mu0;
                float lum = 0.014 + lit * clamp(lommel, 0.05, 0.98);
                vec3 regolith = mix(vec3(0.012, 0.015, 0.020), vec3(0.94, 0.945, 0.96), lum);
                fragColor = vec4(regolith, 1.0);
            }
        `;

        // Einfacher Linien- & Punkt-Shader (für Südpol, Sonne, Erde & Strahlen)
        const overlayVS = `#version 300 es
            precision highp float;
            precision highp int;
            in vec3 aPos;
            uniform mat4 uMVP;
            uniform float uPointSize;
            void main() {
                gl_Position = uMVP * vec4(aPos, 1.0);
                gl_PointSize = uPointSize;
            }
        `;

        const overlayFS = `#version 300 es
            precision highp float;
            precision highp int;
            uniform vec4 uColor;
            uniform int uIsPoint;
            out vec4 fragColor;
            void main() {
                if (uIsPoint == 1) {
                    float r = length(gl_PointCoord - vec2(0.5));
                    if (r > 0.5) discard;
                }
                fragColor = uColor;
            }
        `;

        const terrainProg = createProgram(terrainVS, terrainFS);
        const overlayProg = createProgram(overlayVS, overlayFS);

        // =====================================================================
        // 3. MESH-GEOMETRIE ERZEUGEN (200x200 KM GITTER)
        // =====================================================================
        function buildGridMesh(bounds, segs) {
            const [x0, y0, x1, y1] = bounds;
            const cols = segs + 1;
            const verts = new Float32Array(cols * cols * 2);
            let ptr = 0;
            for (let r = 0; r < cols; r++) {
                const y = y0 + (y1 - y0) * (r / segs);
                for (let c = 0; c < cols; c++) {
                    verts[ptr++] = x0 + (x1 - x0) * (c / segs);
                    verts[ptr++] = y;
                }
            }
            const indices = new Uint32Array(segs * segs * 6);
            let iptr = 0;
            for (let r = 0; r < segs; r++) {
                for (let c = 0; c < segs; c++) {
                    const a = r * cols + c;
                    const b = a + 1;
                    const d = (r + 1) * cols + c;
                    const e = d + 1;
                    indices[iptr++] = a; indices[iptr++] = b; indices[iptr++] = d;
                    indices[iptr++] = b; indices[iptr++] = e; indices[iptr++] = d;
                }
            }
            const vao = gl.createVertexArray();
            gl.bindVertexArray(vao);

            const vbo = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
            gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
            const loc = gl.getAttribLocation(terrainProg, "aPosXY");
            gl.enableVertexAttribArray(loc);
            gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

            const ibo = gl.createBuffer();
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

            gl.bindVertexArray(null);
            return { vao, count: indices.length };
        }

        const terrainMesh = buildGridMesh(CFG.globalBounds, 320);

        function createLineVAO(ptsFloat32, dynamic = false) {
            const vao = gl.createVertexArray();
            gl.bindVertexArray(vao);
            const vbo = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
            gl.bufferData(gl.ARRAY_BUFFER, ptsFloat32, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
            const loc = gl.getAttribLocation(overlayProg, "aPos");
            gl.enableVertexAttribArray(loc);
            gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
            gl.bindVertexArray(null);
            return { vao, vbo, count: ptsFloat32.length / 3 };
        }

        // Südpol-Punkt (0, 0)
        const poleU = (0 - CFG.globalBounds[0]) / (CFG.globalBounds[2] - CFG.globalBounds[0]);
        const poleV = (CFG.globalBounds[3] - 0) / (CFG.globalBounds[3] - CFG.globalBounds[1]);
        const poleZ = sampleCpuHeight(demBytes, CFG.demSize, poleU, poleV, CFG.zMin, CFG.zMax);
        const poleVAO = createLineVAO(new Float32Array([0, 0, poleZ + 0.25]));

        // =====================================================================
        // 4. ASTRONOMIE (SONNE & ERDE AUS JPL HORIZONS)
        // =====================================================================
        const poleDist = Math.hypot(CFG.centerX, CFG.centerY) || 1.0;
        const northX = CFG.centerX / poleDist;
        const northY = CFG.centerY / poleDist;
        const eastX = northY;
        const eastY = -northX;

        function azElToVec(azDeg, elDeg) {
            const az = azDeg * Math.PI / 180.0;
            const el = elDeg * Math.PI / 180.0;
            const cosEl = Math.cos(el);
            const hx = Math.cos(az) * northX + Math.sin(az) * eastX;
            const hy = Math.cos(az) * northY + Math.sin(az) * eastY;
            return { sx: cosEl * hx, sy: cosEl * hy, sz: Math.sin(el), hx, hy, elRad: el };
        }

        const sunData = jplSun.data;
        const earthData = jplEarth.data;
        const nEphem = Math.min(sunData.length, earthData.length);
        document.getElementById('jpl-source-label').textContent = `${jplSun.source} • ${nEphem} Punkte`;

        const timeSlider = document.getElementById('time-slider');
        timeSlider.max = (nEphem - 1).toString();

        const celestialRadius = 115.0;
        const sunOrbitArr = [], earthOrbitArr = [];
        const sunElArr = [], earthElArr = [];

        for (let i = 0; i < nEphem; i++) {
            const [, sAz, sEl] = sunData[i];
            const [, eAz, eEl] = earthData[i];
            sunElArr.push(sEl);
            earthElArr.push(eEl);
            if (i % 2 === 0) {
                const sv = azElToVec(sAz, sEl);
                sunOrbitArr.push(CFG.centerX + sv.hx * celestialRadius, CFG.centerY + sv.hy * celestialRadius, 3.5 + Math.sin(sv.elRad) * 44.0);
                const ev = azElToVec(eAz, eEl);
                earthOrbitArr.push(CFG.centerX + ev.hx * celestialRadius, CFG.centerY + ev.hy * celestialRadius, 3.5 + Math.sin(ev.elRad) * 44.0);
            }
        }

        const sunOrbitVAO = createLineVAO(new Float32Array(sunOrbitArr));
        const earthOrbitVAO = createLineVAO(new Float32Array(earthOrbitArr));
        const sunPointVAO = createLineVAO(new Float32Array([0, 0, 0]), true);
        const earthPointVAO = createLineVAO(new Float32Array([0, 0, 0]), true);
        const beamOffsets = [[0, 0], [-45.0, -45.0], [45.0, -45.0], [-45.0, 45.0], [45.0, 45.0]];
        const beamsArr = new Float32Array(beamOffsets.length * 6);
        const beamsVAO = createLineVAO(beamsArr, true);

        // =====================================================================
        // 5. EINGEBAUTE 3D-KAMERASTEUERUNG
        // =====================================================================
        const cam = {
            target: [CFG.centerX, CFG.centerY, centerZKm],
            yaw: -0.75,
            pitch: 0.62,
            dist: 155.0
        };

        function resetCamera() {
            cam.target = [CFG.centerX, CFG.centerY, centerZKm];
            cam.yaw = -0.75;
            cam.pitch = 0.62;
            cam.dist = 155.0;
        }
        document.getElementById('btn-reset').addEventListener('click', resetCamera);

        let dragMode = null;
        let lastMouse = { x: 0, y: 0 };

        canvas.addEventListener('contextmenu', (e) => e.preventDefault());
        canvas.addEventListener('pointerdown', (e) => {
            canvas.setPointerCapture(e.pointerId);
            lastMouse = { x: e.clientX, y: e.clientY };
            dragMode = (e.button === 2 || e.shiftKey) ? 'pan' : 'rotate';
        });
        canvas.addEventListener('pointermove', (e) => {
            if (!dragMode) return;
            const dx = e.clientX - lastMouse.x;
            const dy = e.clientY - lastMouse.y;
            lastMouse = { x: e.clientX, y: e.clientY };

            if (dragMode === 'rotate') {
                cam.yaw -= dx * 0.0065;
                cam.pitch = Math.max(0.04, Math.min(Math.PI * 0.49, cam.pitch + dy * 0.0065));
            } else {
                const scale = cam.dist * 0.0014;
                const rightX = -Math.sin(cam.yaw);
                const rightY = Math.cos(cam.yaw);
                const fwdX = -Math.cos(cam.yaw);
                const fwdY = -Math.sin(cam.yaw);
                cam.target[0] += (-dx * rightX + dy * fwdX) * scale;
                cam.target[1] += (-dx * rightY + dy * fwdY) * scale;
            }
        });
        canvas.addEventListener('pointerup', (e) => {
            dragMode = null;
            try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
        });
        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const factor = e.deltaY > 0 ? 1.12 : 0.89;
            cam.dist = Math.max(2.0, Math.min(480.0, cam.dist * factor));
        }, { passive: false });

        function buildMVP(aspect) {
            const [tx, ty, tz] = cam.target;
            const ex = tx + cam.dist * Math.cos(cam.pitch) * Math.cos(cam.yaw);
            const ey = ty + cam.dist * Math.cos(cam.pitch) * Math.sin(cam.yaw);
            const ez = tz + cam.dist * Math.sin(cam.pitch);

            let zx = ex - tx, zy = ey - ty, zz = ez - tz;
            let zl = Math.hypot(zx, zy, zz) || 1;
            zx /= zl; zy /= zl; zz /= zl;

            let xx = -zy, xy = zx, xz = 0;
            let xl = Math.hypot(xx, xy) || 1;
            xx /= xl; xy /= xl;

            const yx = zy * xz - zz * xy;
            const yy = zz * xx - zx * xz;
            const yz = zx * xy - zy * xx;

            const view = new Float32Array([
                xx, yx, zx, 0,
                xy, yy, zy, 0,
                xz, yz, zz, 0,
                -(xx * ex + xy * ey + xz * ez),
                -(yx * ex + yy * ey + yz * ez),
                -(zx * ex + zy * ey + zz * ez),
                1
            ]);

            const fov = 45 * Math.PI / 180;
            const near = 0.1, far = 1500.0;
            const f = 1.0 / Math.tan(fov / 2);
            const nf = 1.0 / (near - far);

            const proj = new Float32Array([
                f / aspect, 0, 0, 0,
                0, f, 0, 0,
                0, 0, (far + near) * nf, -1,
                0, 0, (2 * far * near) * nf, 0
            ]);

            const mvp = new Float32Array(16);
            for (let c = 0; c < 4; c++) {
                for (let r = 0; r < 4; r++) {
                    mvp[c * 4 + r] =
                        proj[0 * 4 + r] * view[c * 4 + 0] +
                        proj[1 * 4 + r] * view[c * 4 + 1] +
                        proj[2 * 4 + r] * view[c * 4 + 2] +
                        proj[3 * 4 + r] * view[c * 4 + 3];
                }
            }
            return mvp;
        }

        // =====================================================================
        // 6. 2D EPHEMERIDEN-GRAPH
        // =====================================================================
        const ephemCanvas = document.getElementById('ephem-canvas');
        const ephemCtx = ephemCanvas.getContext('2d');

        function drawEphemChart(activeIdx) {
            const rect = ephemCanvas.getBoundingClientRect();
            if (rect.width < 10 || rect.height < 10) return;
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            if (ephemCanvas.width !== Math.round(rect.width * dpr) || ephemCanvas.height !== Math.round(rect.height * dpr)) {
                ephemCanvas.width = Math.round(rect.width * dpr);
                ephemCanvas.height = Math.round(rect.height * dpr);
            }
            const ctx = ephemCtx;
            ctx.save();
            ctx.scale(dpr, dpr);
            const w = rect.width, h = rect.height;

            ctx.fillStyle = '#181c23';
            ctx.fillRect(0, 0, w, h);

            const padL = 36, padR = 10, padT = 24, padB = 24;
            const plotW = w - padL - padR, plotH = h - padT - padB;
            const minEl = -9.5, maxEl = 9.5;
            const yOf = (el) => padT + plotH * (1.0 - (el - minEl) / (maxEl - minEl));
            const xOf = (idx) => padL + (idx / (nEphem - 1)) * plotW;

            ctx.strokeStyle = '#262b35';
            ctx.font = '10px monospace';
            ctx.fillStyle = '#9ca3af';
            for (const deg of [-8, -4, 0, 4, 8]) {
                const y = yOf(deg);
                ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
                ctx.fillText((deg > 0 ? '+' : '') + deg + '°', 4, y + 3);
            }

            ctx.strokeStyle = 'rgba(239,68,68,0.6)';
            ctx.setLineDash([4, 4]);
            ctx.beginPath(); ctx.moveTo(padL, yOf(0)); ctx.lineTo(w - padR, yOf(0)); ctx.stroke();
            ctx.setLineDash([]);

            ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 1.4;
            ctx.beginPath();
            for (let i = 0; i < nEphem; i += 2) {
                const x = xOf(i), y = yOf(earthElArr[i]);
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();

            ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 1.7;
            ctx.beginPath();
            for (let i = 0; i < nEphem; i += 2) {
                const x = xOf(i), y = yOf(sunElArr[i]);
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();

            ctx.fillStyle = '#fbbf24'; ctx.fillText('■ Sonne El (°)', padL, 14);
            ctx.fillStyle = '#38bdf8'; ctx.fillText('■ Erde El (°)', padL + 92, 14);

            const cx = xOf(activeIdx);
            ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(cx, padT); ctx.lineTo(cx, h - padB); ctx.stroke();

            ctx.fillStyle = '#9ca3af';
            const months = ['Jan', 'Mär', 'Mai', 'Jul', 'Sep', 'Nov', 'Jan'];
            for (let m = 0; m < months.length; m++) {
                ctx.fillText(months[m], padL + (m / (months.length - 1)) * plotW - 10, h - 7);
            }
            ctx.restore();
        }

        let scrubbingChart = false;
        function scrubChart(e) {
            const rect = ephemCanvas.getBoundingClientRect();
            const frac = Math.max(0, Math.min(1, (e.clientX - rect.left - 36) / (rect.width - 46)));
            currentIndex = frac * (nEphem - 1);
            timeSlider.value = currentIndex;
            updateSolarState();
        }
        ephemCanvas.addEventListener('pointerdown', (e) => { scrubbingChart = true; scrubChart(e); });
        window.addEventListener('pointermove', (e) => { if (scrubbingChart) scrubChart(e); });
        window.addEventListener('pointerup', () => { scrubbingChart = false; });

        // =====================================================================
        // 7. STEUERUNG & MODUS-TOGGLE
        // =====================================================================
        let currentMode = 0; // 0 = Topo, 1 = Solar
        let isPlaying = false;
        let currentIndex = 0.0;
        let simHoursPerSec = 6.0;
        let lastFrameMs = performance.now();
        let sunDir = [1, 0, 0.02];
        let sunElRad = 0.02;

        const btnPlay = document.getElementById('btn-play');
        btnPlay.addEventListener('click', () => {
            isPlaying = !isPlaying;
            btnPlay.textContent = isPlaying ? '⏸ Pause' : '▶ Start';
            btnPlay.classList.toggle('playing', isPlaying);
            lastFrameMs = performance.now();
        });

        timeSlider.addEventListener('input', () => {
            currentIndex = parseFloat(timeSlider.value);
            updateSolarState();
        });

        const speedSlider = document.getElementById('speed-slider');
        speedSlider.addEventListener('input', () => {
            simHoursPerSec = parseFloat(speedSlider.value);
            document.getElementById('speed-label').textContent = simHoursPerSec.toFixed(1) + ' Std/s';
            document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
        });

        document.querySelectorAll('.speed-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                simHoursPerSec = parseFloat(btn.dataset.speed);
                speedSlider.value = simHoursPerSec;
                document.getElementById('speed-label').textContent = simHoursPerSec.toFixed(1) + ' Std/s';
                document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        const contourSlider = document.getElementById('contour-slider');
        contourSlider.addEventListener('input', () => {
            document.getElementById('contour-val').textContent = Math.round(parseFloat(contourSlider.value) * 1000) + ' m';
        });

        function interpSeries(series, idx) {
            const i0 = Math.floor(idx);
            const i1 = Math.min(nEphem - 1, i0 + 1);
            const f = idx - i0;
            const [ts0, az0, el0] = series[i0];
            const [, az1, el1] = series[i1];
            let dAz = az1 - az0;
            if (dAz > 180) dAz -= 360;
            if (dAz < -180) dAz += 360;
            return { ts: ts0, az: (az0 + f * dAz + 360) % 360, el: el0 + f * (el1 - el0) };
        }

        function updateSolarState() {
            if (currentMode !== 1) return;
            const s = interpSeries(sunData, currentIndex);
            const e = interpSeries(earthData, currentIndex);
            const sv = azElToVec(s.az, s.el);
            const ev = azElToVec(e.az, e.el);

            const len = Math.hypot(sv.sx, sv.sy, sv.sz) || 1;
            sunDir = [sv.sx / len, sv.sy / len, sv.sz / len];
            sunElRad = sv.elRad;

            document.getElementById('val-time').textContent = s.ts;
            document.getElementById('val-sun-azel').textContent = `${s.az.toFixed(1)}° / ${(s.el >= 0 ? '+' : '')}${s.el.toFixed(2)}°`;
            document.getElementById('val-earth-azel').textContent = `${e.az.toFixed(1)}° / ${(e.el >= 0 ? '+' : '')}${e.el.toFixed(2)}°`;

            gl.bindBuffer(gl.ARRAY_BUFFER, sunPointVAO.vbo);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array([
                CFG.centerX + sv.hx * celestialRadius,
                CFG.centerY + sv.hy * celestialRadius,
                3.5 + Math.sin(sv.elRad) * 44.0
            ]));

            gl.bindBuffer(gl.ARRAY_BUFFER, earthPointVAO.vbo);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array([
                CFG.centerX + ev.hx * celestialRadius,
                CFG.centerY + ev.hy * celestialRadius,
                3.5 + Math.sin(ev.elRad) * 44.0
            ]));

            const rayLen = 95.0;
            const szSafe = Math.max(0.015, sunDir[2]);
            for (let i = 0; i < beamOffsets.length; i++) {
                const tx = CFG.centerX + beamOffsets[i][0];
                const ty = CFG.centerY + beamOffsets[i][1];
                const b = i * 6;
                beamsArr[b] = tx + sunDir[0] * rayLen;
                beamsArr[b + 1] = ty + sunDir[1] * rayLen;
                beamsArr[b + 2] = centerZKm + szSafe * rayLen;
                beamsArr[b + 3] = tx;
                beamsArr[b + 4] = ty;
                beamsArr[b + 5] = centerZKm;
            }
            gl.bindBuffer(gl.ARRAY_BUFFER, beamsVAO.vbo);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, beamsArr);

            drawEphemChart(Math.round(currentIndex));
        }

        document.getElementById('btn-mode-topo').addEventListener('click', () => {
            currentMode = 0;
            isPlaying = false;
            btnPlay.textContent = '▶ Start';
            btnPlay.classList.remove('playing');
            document.getElementById('btn-mode-topo').classList.add('active');
            document.getElementById('btn-mode-solar').classList.remove('active', 'solar');
            document.getElementById('solar-panel').style.display = 'none';
            document.getElementById('ephem-sidebar').style.display = 'none';
            document.getElementById('contour-box').style.display = 'flex';
            document.getElementById('topo-colorbar').style.display = 'flex';
            document.getElementById('mode-subtitle').textContent = 'Topographie-Modus • 1 km Z = 1 km X/Y • 200×200 km Fläche deckend';
        });

        document.getElementById('btn-mode-solar').addEventListener('click', () => {
            currentMode = 1;
            document.getElementById('btn-mode-topo').classList.remove('active');
            document.getElementById('btn-mode-solar').classList.add('active', 'solar');
            document.getElementById('solar-panel').style.display = 'flex';
            document.getElementById('ephem-sidebar').style.display = 'flex';
            document.getElementById('contour-box').style.display = 'none';
            document.getElementById('topo-colorbar').style.display = 'none';
            document.getElementById('mode-subtitle').textContent = 'JPL Horizons Sonne & Erde • GPU-Raycasting & Horizontschatten (200×200 km)';
            updateSolarState();
        });

        // =====================================================================
        // 8. RENDER-SCHLEIFE (60 FPS)
        // =====================================================================
        function drawOverlay(vaoObj, mode, color, pointSize, mvp) {
            gl.uniformMatrix4fv(gl.getUniformLocation(overlayProg, "uMVP"), false, mvp);
            gl.uniform4fv(gl.getUniformLocation(overlayProg, "uColor"), color);
            gl.uniform1f(gl.getUniformLocation(overlayProg, "uPointSize"), pointSize);
            gl.uniform1i(gl.getUniformLocation(overlayProg, "uIsPoint"), mode === gl.POINTS ? 1 : 0);
            gl.bindVertexArray(vaoObj.vao);
            gl.drawArrays(mode, 0, vaoObj.count);
        }

        function render(nowMs) {
            requestAnimationFrame(render);

            const dtSec = Math.min(0.1, (nowMs - lastFrameMs) / 1000.0);
            lastFrameMs = nowMs;

            if (isPlaying && currentMode === 1) {
                currentIndex = (currentIndex + dtSec * (simHoursPerSec / jplSun.step_hours)) % (nEphem - 1);
                timeSlider.value = currentIndex;
                updateSolarState();
            }

            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const w = Math.floor(canvas.clientWidth * dpr);
            const h = Math.floor(canvas.clientHeight * dpr);
            if (canvas.width !== w || canvas.height !== h) {
                canvas.width = w;
                canvas.height = h;
            }
            gl.viewport(0, 0, w, h);
            gl.clearColor(0.028, 0.035, 0.05, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            gl.enable(gl.DEPTH_TEST);
            gl.depthMask(true);
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

            const mvp = buildMVP(w / Math.max(1, h));

            // 1. 200x200 km Terrain zeichnen (100% deckend)
            gl.useProgram(terrainProg);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, demTex);
            gl.uniform1i(gl.getUniformLocation(terrainProg, "uDemTex"), 0);

            gl.uniformMatrix4fv(gl.getUniformLocation(terrainProg, "uMVP"), false, mvp);
            gl.uniform4fv(gl.getUniformLocation(terrainProg, "uGlobalBounds"), CFG.globalBounds);
            gl.uniform2f(gl.getUniformLocation(terrainProg, "uZRange"), CFG.zMin, CFG.zMax);
            gl.uniform1f(gl.getUniformLocation(terrainProg, "uDemSize"), CFG.demSize);
            gl.uniform1i(gl.getUniformLocation(terrainProg, "uMode"), currentMode);
            gl.uniform1i(gl.getUniformLocation(terrainProg, "uShowContours"), (currentMode === 0 && document.getElementById('chk-contours').checked) ? 1 : 0);
            gl.uniform1f(gl.getUniformLocation(terrainProg, "uContourStep"), parseFloat(contourSlider.value));
            gl.uniform3fv(gl.getUniformLocation(terrainProg, "uSunDir"), sunDir);
            gl.uniform1f(gl.getUniformLocation(terrainProg, "uSunElRad"), sunElRad);

            gl.bindVertexArray(terrainMesh.vao);
            gl.drawElements(gl.TRIANGLES, terrainMesh.count, gl.UNSIGNED_INT, 0);

            // 2. Overlays (Südpol, Sonne & Erde)
            gl.useProgram(overlayProg);
            drawOverlay(poleVAO, gl.POINTS, [0.98, 0.80, 0.08, 1.0], 8.0, mvp);

            if (currentMode === 1) {
                if (document.getElementById('chk-orbit').checked) {
                    drawOverlay(sunOrbitVAO, gl.LINE_STRIP, [0.98, 0.75, 0.14, 0.45], 1.0, mvp);
                }
                if (document.getElementById('chk-rays').checked) {
                    drawOverlay(beamsVAO, gl.LINES, [0.99, 0.88, 0.28, 0.55], 1.0, mvp);
                }
                if (document.getElementById('chk-earth').checked) {
                    drawOverlay(earthOrbitVAO, gl.LINE_STRIP, [0.22, 0.74, 0.97, 0.65], 1.0, mvp);
                    drawOverlay(earthPointVAO, gl.POINTS, [0.22, 0.74, 0.97, 1.0], 14.0, mvp);
                }
                drawOverlay(sunPointVAO, gl.POINTS, [0.99, 0.88, 0.28, 1.0], 16.0, mvp);
            }
        }

        requestAnimationFrame(render);
    </script>

</body>
</html>
"""

    html_content = html_content.replace("__GLOBAL_BOUNDS__", json.dumps([round(v / 1000.0, 5) for v in global_bounds_m]))
    html_content = html_content.replace("__CENTER_X__", str(round(center_x_m / 1000.0, 5)))
    html_content = html_content.replace("__CENTER_Y__", str(round(center_y_m / 1000.0, 5)))
    html_content = html_content.replace("__Z_MIN__", str(round(z_min, 5)))
    html_content = html_content.replace("__Z_MAX__", str(round(z_max, 5)))
    html_content = html_content.replace("__DEM_SIZE__", str(dem_tex_size))
    html_content = html_content.replace("__DEM_B64__", dem_b64)
    html_content = html_content.replace("__JPL_SUN__", json.dumps(jpl_sun))
    html_content = html_content.replace("__JPL_EARTH__", json.dumps(jpl_earth))

    with open(output_filename, "w", encoding="utf-8") as f:
        f.write(html_content)

    print(f"✅ Fertig! Öffne '{output_filename}' in deinem Browser.")


if __name__ == "__main__":
    generate_linear_web_3d_viewer()
