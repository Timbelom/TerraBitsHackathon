"""Shared geometry and terrain access for the data tools (build_globe.py, build_terrain.py, serve.py).

Reference frame: everything the web page sees is MOON_ME (mean Earth / polar axis, DE421), the frame
of JPL Horizons, the LOLA polar products and the usual lunar coordinates. The global LOLA raster
LDEM64_PA is in MOON_PA (principal axes, DE421). The two differ by a constant rotation of 0.0288 deg
(up to about 875 m on the surface), so every lookup in that raster goes through me_to_pa().

Heights are metres above the reference sphere of 1737.4 km.
"""
import math
import struct
import threading
from pathlib import Path

import numpy as np

MOON_RADIUS_M = 1737400.0
MOON_RADIUS_KM = MOON_RADIUS_M / 1000.0

# ---------------------------------------------------------------------------------------------
# MOON_ME <-> MOON_PA
# ---------------------------------------------------------------------------------------------
# NAIF lunar frame kernel moon_080317.tf, frame MOON_ME_DE421 (31007) relative to MOON_PA_DE421:
#   TKFRAME_31007_ANGLES = ( 67.92  78.56  0.30 )   TKFRAME_31007_AXES = ( 3, 2, 1 )   arcseconds
# SPICE convention for such a frame: v_PA = [67.92"]_3 [78.56"]_2 [0.30"]_1 v_ME, where [a]_i is the
# rotation of the coordinate system by the angle a about axis i. Checked against the LOLA 80 m
# south-pole model, which is in MOON_ME (tools/check_frames.py): this direction fits, the inverse does not.
_ARCSEC = math.pi / (180.0 * 3600.0)
ME_TO_PA_ANGLES_ARCSEC = (67.92, 78.56, 0.30)
ME_TO_PA_AXES = (3, 2, 1)


def _frame_rotation(axis: int, angle_rad: float) -> np.ndarray:
    c, s = math.cos(angle_rad), math.sin(angle_rad)
    if axis == 1:
        return np.array([[1.0, 0.0, 0.0], [0.0, c, s], [0.0, -s, c]])
    if axis == 2:
        return np.array([[c, 0.0, -s], [0.0, 1.0, 0.0], [s, 0.0, c]])
    return np.array([[c, s, 0.0], [-s, c, 0.0], [0.0, 0.0, 1.0]])


ME_TO_PA = np.linalg.multi_dot(
    [_frame_rotation(ax, ang * _ARCSEC) for ax, ang in zip(ME_TO_PA_AXES, ME_TO_PA_ANGLES_ARCSEC)]
)
PA_TO_ME = ME_TO_PA.T


def unit_from_latlon(lat_deg, lon_deg):
    """Unit vectors (..., 3) in a Moon-fixed frame: x = longitude 0, y = longitude 90 E, z = north."""
    lat = np.radians(np.asarray(lat_deg, dtype=np.float64))
    lon = np.radians(np.asarray(lon_deg, dtype=np.float64))
    cl = np.cos(lat)
    return np.stack([cl * np.cos(lon), cl * np.sin(lon), np.sin(lat)], axis=-1)


def latlon_from_unit(u):
    """Latitude and east longitude (-180..180) in degrees of unit vectors (..., 3)."""
    u = np.asarray(u, dtype=np.float64)
    lat = np.degrees(np.arcsin(np.clip(u[..., 2], -1.0, 1.0)))
    lon = np.degrees(np.arctan2(u[..., 1], u[..., 0]))
    return lat, lon


def rotate_latlon(lat_deg, lon_deg, matrix):
    """Coordinates of the same surface points in another frame (rotation matrix: old -> new)."""
    return latlon_from_unit(unit_from_latlon(lat_deg, lon_deg) @ matrix.T)


def me_to_pa(lat_deg, lon_deg):
    return rotate_latlon(lat_deg, lon_deg, ME_TO_PA)


def pa_to_me(lat_deg, lon_deg):
    return rotate_latlon(lat_deg, lon_deg, PA_TO_ME)


# ---------------------------------------------------------------------------------------------
# Local frame of a site and its flat map (azimuthal equidistant: distance and azimuth from the centre are true)
# ---------------------------------------------------------------------------------------------
def local_basis(lat_deg: float, lon_deg: float):
    """(up, east, north) unit vectors at a site. Mirrors localBasis() in core/frames.js."""
    up = unit_from_latlon(lat_deg, lon_deg)
    if abs(up[2]) < 0.999999:
        east = np.array([-up[1], up[0], 0.0])
        east /= np.linalg.norm(east)
        north = np.cross(up, east)
        north /= np.linalg.norm(north)
    elif up[2] < 0:                      # south pole: "north" along longitude 0
        east = np.array([0.0, 1.0, 0.0])
        north = np.array([1.0, 0.0, 0.0])
    else:                                # north pole: "north" along longitude 180
        east = np.array([0.0, 1.0, 0.0])
        north = np.array([-1.0, 0.0, 0.0])
    return up, east, north


def local_km_to_latlon(basis, x_km, y_km):
    """Lat/lon of points given in a site's local km (x east, y north, measured along the surface)."""
    up, east, north = basis
    x_km = np.asarray(x_km, dtype=np.float64)
    y_km = np.asarray(y_km, dtype=np.float64)
    rho = np.hypot(x_km, y_km)
    chi = rho / MOON_RADIUS_KM
    cc = np.cos(chi)
    sc = np.where(rho > 1e-9, np.sin(chi) / np.maximum(rho, 1e-12), 1.0 / MOON_RADIUS_KM)
    u = cc[..., None] * up + sc[..., None] * (x_km[..., None] * east + y_km[..., None] * north)
    u /= np.linalg.norm(u, axis=-1, keepdims=True)
    return latlon_from_unit(u)


# ---------------------------------------------------------------------------------------------
# The global LOLA raster
# ---------------------------------------------------------------------------------------------
LDEM_CANDIDATES = ("LDEM64_PA_pixel_202405.tif", "LDEM64_PA_pixel_202405 copy.tif")
LDEM_URL = "https://pgda.gsfc.nasa.gov/data/LOLA_PA/LDEM64_PA_pixel_202405.tif"


def find_ldem(root: Path, explicit: str | None = None) -> Path | None:
    if explicit:
        p = Path(explicit)
        return p if p.exists() else None
    for name in LDEM_CANDIDATES:
        p = root / name
        if p.exists():
            return p
    return None


class Ldem:
    """A global elevation raster on a regular latitude/longitude grid, read window by window.

    sample(lat, lon) takes MOON_ME coordinates and returns metres above the reference sphere.
    """

    def __init__(self, path, frame: str | None = None):
        import rasterio                                    # only needed where the GeoTIFF is read

        self.path = Path(path)
        self._ds = rasterio.open(self.path)
        self._lock = threading.Lock()
        ds = self._ds
        self.width, self.height = int(ds.width), int(ds.height)
        t = ds.transform
        if abs(t.b) > 1e-12 or abs(t.d) > 1e-12:
            raise ValueError(f"{self.path.name}: rotated rasters are not supported")
        if ds.crs is not None and not ds.crs.is_geographic:
            raise ValueError(f"{self.path.name}: expected a latitude/longitude raster, found {ds.crs}")
        self.deg_per_col, self.deg_per_row = float(t.a), float(t.e)          # row step is negative
        self.lon_col0 = float(t.c) + 0.5 * self.deg_per_col                  # centre of pixel 0
        self.lat_row0 = float(t.f) + 0.5 * self.deg_per_row
        if abs(abs(self.deg_per_col) * self.width - 360.0) > 0.5:
            raise ValueError(f"{self.path.name}: the raster does not span 360 deg of longitude")
        self.nodata = ds.nodata
        self.scale = float(ds.scales[0]) if ds.scales and ds.scales[0] else 1.0
        self.offset = float(ds.offsets[0]) if ds.offsets and ds.offsets[0] else 0.0
        self.frame = (frame or ("PA" if "_PA" in self.path.name.upper() else "ME")).upper()
        if self.frame not in ("PA", "ME"):
            raise ValueError("frame must be PA or ME")
        # Units: some LOLA products hold radii in metres or heights in km. Decide once from three strips
        # (north edge, equator, south edge); reading the whole raster for this would take minutes.
        from rasterio.windows import Window

        strip_h, strip_w = min(64, self.height), min(2048, self.width)
        rows = sorted({0, max(0, self.height // 2 - strip_h // 2), self.height - strip_h})
        probe = np.concatenate([
            self._clean(ds.read(1, window=Window(0, r, strip_w, strip_h)).astype(np.float64)).ravel() for r in rows
        ])
        valid = probe[np.isfinite(probe)]
        if valid.size == 0:
            raise ValueError(f"{self.path.name}: no valid elevation values")
        self.is_radius_m = float(np.median(valid)) > 1_000_000.0
        self.is_km = (not self.is_radius_m) and float(np.max(np.abs(valid))) < 30.0
        self.cell_m = abs(self.deg_per_row) * math.pi / 180.0 * MOON_RADIUS_M

    def close(self):
        self._ds.close()

    def describe(self) -> str:
        return (f"{self.path.name}: {self.width} x {self.height}, {1.0 / abs(self.deg_per_col):g} px/deg "
                f"({self.cell_m:.0f} m per pixel north-south), frame MOON_{self.frame}")

    def _clean(self, block):
        if self.nodata is not None and not (isinstance(self.nodata, float) and math.isnan(self.nodata)):
            block[np.isclose(block, self.nodata)] = np.nan
        block[~np.isfinite(block)] = np.nan
        if self.scale != 1.0 or self.offset != 0.0:
            block = block * self.scale + self.offset
        return block

    def _to_metres(self, block):
        block = self._clean(block)
        if self.is_radius_m:
            block -= MOON_RADIUS_M
        elif self.is_km:
            block *= 1000.0
        return block

    def read_rows_cols(self, row_lo, row_hi, col_lo, col_hi):
        """Heights (m) for source rows/columns [lo, hi] inclusive; columns may run past either edge (they wrap)."""
        from rasterio.windows import Window

        n_rows = row_hi - row_lo + 1
        pieces = []
        with self._lock:
            c = col_lo
            while c <= col_hi:
                c_mod = c % self.width
                n_cols = min(col_hi - c + 1, self.width - c_mod)
                pieces.append(self._ds.read(1, window=Window(c_mod, row_lo, n_cols, n_rows)))
                c += n_cols
        dtype = np.float64 if self.is_radius_m else np.float32
        block = (pieces[0] if len(pieces) == 1 else np.concatenate(pieces, axis=1)).astype(dtype)
        return self._to_metres(block)

    def decimated(self, rows: int, cols: int):
        """The whole raster reduced to rows x cols by averaging (area mean of the source pixels), in its own frame."""
        from rasterio.enums import Resampling

        with self._lock:
            grid = self._ds.read(1, out_shape=(rows, cols), resampling=Resampling.average).astype(np.float64)
        return self._to_metres(grid)

    def sample(self, lat_deg, lon_deg):
        """Bilinear heights (m) at MOON_ME latitude / east longitude; arrays of any (equal) shape."""
        lat_deg = np.asarray(lat_deg, dtype=np.float64)
        lon_deg = np.asarray(lon_deg, dtype=np.float64)
        shape = lat_deg.shape
        if self.frame == "PA":
            lat_deg, lon_deg = me_to_pa(lat_deg, lon_deg)
        row_f = np.clip((lat_deg - self.lat_row0) / self.deg_per_row, 0.0, self.height - 1.0).ravel()
        col_f = ((lon_deg - self.lon_col0) / self.deg_per_col).ravel()
        # Unwrap the columns around one reference point so the window to read is as narrow as possible.
        c_ref = float(col_f[col_f.size // 2])
        col_f = c_ref + ((col_f - c_ref + self.width * 0.5) % self.width) - self.width * 0.5
        c0 = np.floor(col_f).astype(np.int64)
        r0 = np.minimum(np.floor(row_f).astype(np.int64), self.height - 2)
        row_lo, row_hi = int(r0.min()), int(r0.max()) + 1
        col_lo, col_hi = int(c0.min()), int(c0.max()) + 1
        if col_hi - col_lo + 1 > self.width:                 # the whole circle of longitudes is needed
            col_hi = col_lo + self.width
        block = self.read_rows_cols(row_lo, row_hi, col_lo, col_hi)
        finite = np.isfinite(block)
        if not finite.all():
            block = np.where(finite, block, float(block[finite].min()) if finite.any() else 0.0)
        fr = row_f - r0
        fc = col_f - c0
        ri, ci = r0 - row_lo, c0 - col_lo
        z = ((block[ri, ci] * (1.0 - fc) + block[ri, ci + 1] * fc) * (1.0 - fr)
             + (block[ri + 1, ci] * (1.0 - fc) + block[ri + 1, ci + 1] * fc) * fr)
        return np.asarray(z, dtype=np.float64).reshape(shape)


# ---------------------------------------------------------------------------------------------
# Terrain block: the ground around one site, as the page reads it (core/terrain.js parseBlock)
# ---------------------------------------------------------------------------------------------
# Near grid: BLOCK_RES x BLOCK_RES heights over the square of BLOCK_FULL_KM around the site. The page shows the
# inner BLOCK_VISIBLE_KM; the rim of BLOCK_PAD_KM only casts shadows into it.
# Far grid: FAR_RES x FAR_RES heights out to FAR_HALF_KM from the site, one per FAR_STEP_KM. With a low Sun
# (near the poles always) mountains far away still cover it: an obstacle that tops the observer by dH
# stays above the horizontal out to sqrt(2 R dH), 186 km for dH = 10 km.
# Both grids are laid out in the site's local map (x east, y north, distances along the surface);
# row 0 is the northern edge, column 0 the western edge.
BLOCK_MAGIC = b"LTIL"
BLOCK_VERSION = 3
BLOCK_RES = 640
BLOCK_VISIBLE_KM = 200.0
BLOCK_PAD_KM = 25.0
BLOCK_FULL_KM = BLOCK_VISIBLE_KM + 2.0 * BLOCK_PAD_KM
FAR_HALF_KM = 300.0
FAR_STEP_KM = 1.0
FAR_RES = int(round(2.0 * FAR_HALF_KM / FAR_STEP_KM)) + 1
FRAME_CODE_ME = 1
# little-endian: magic, version, res, centre lat, centre lon (float64), visible km, pad km, z min, z max,
# far res, frame code, far half km, far z min, far z max, source metres per pixel, reserved
BLOCK_HEADER_FORMAT = "<4sHHddffffHHffffI"
BLOCK_HEADER_BYTES = struct.calcsize(BLOCK_HEADER_FORMAT)
assert BLOCK_HEADER_BYTES == 64


def block_size_bytes() -> int:
    return BLOCK_HEADER_BYTES + BLOCK_RES * BLOCK_RES * 2 + FAR_RES * FAR_RES * 2


def _quantise_u16(z_m: np.ndarray):
    z_min = float(np.float32(z_m.min()))
    z_max = float(np.float32(z_m.max()))
    if z_max <= z_min:
        z_max = z_min + 1.0
    u16 = np.round(np.clip((z_m - z_min) / (z_max - z_min), 0.0, 1.0) * 65535.0).astype("<u2")
    return z_min, z_max, u16


def block_grids(ldem: Ldem, lat_deg: float, lon_deg: float):
    """(near, far) height grids in metres around a site given in MOON_ME."""
    basis = local_basis(lat_deg, lon_deg)
    half = BLOCK_FULL_KM * 0.5
    frac = np.arange(BLOCK_RES, dtype=np.float64) / (BLOCK_RES - 1)
    xx, yy = np.meshgrid(-half + frac * BLOCK_FULL_KM, half - frac * BLOCK_FULL_KM)
    near = ldem.sample(*local_km_to_latlon(basis, xx, yy))

    idx = np.arange(FAR_RES, dtype=np.float64)
    fx, fy = np.meshgrid(-FAR_HALF_KM + idx * FAR_STEP_KM, FAR_HALF_KM - idx * FAR_STEP_KM)
    # each far value is the mean of 2 x 2 sub-samples inside its cell: neither lifted (as a maximum
    # would do) nor thinned out to single points
    offsets = [(-0.25, -0.25), (0.25, -0.25), (-0.25, 0.25), (0.25, 0.25)]
    xs = np.concatenate([fx + ox * FAR_STEP_KM for ox, _ in offsets], axis=0)
    ys = np.concatenate([fy + oy * FAR_STEP_KM for _, oy in offsets], axis=0)
    far = ldem.sample(*local_km_to_latlon(basis, xs, ys)).reshape(len(offsets), FAR_RES, FAR_RES).mean(axis=0)
    return near, far


def build_block(ldem: Ldem, lat_deg: float, lon_deg: float) -> bytes:
    lon_deg = float(lon_deg) % 360.0
    near, far = block_grids(ldem, lat_deg, lon_deg)
    z_min, z_max, near_u16 = _quantise_u16(near)
    far_min, far_max, far_u16 = _quantise_u16(far)
    header = struct.pack(
        BLOCK_HEADER_FORMAT, BLOCK_MAGIC, BLOCK_VERSION, BLOCK_RES, float(lat_deg), lon_deg,
        BLOCK_VISIBLE_KM, BLOCK_PAD_KM, z_min, z_max, FAR_RES, FRAME_CODE_ME, FAR_HALF_KM, far_min, far_max,
        float(ldem.cell_m), 0,
    )
    return header + near_u16.tobytes() + far_u16.tobytes()


def parse_block(blob: bytes) -> dict:
    """The block as arrays in metres (used by the checks; the page has its own reader)."""
    if len(blob) < BLOCK_HEADER_BYTES:
        raise ValueError("block is too short")
    (magic, version, res, lat, lon, vis_km, pad_km, z_min, z_max, far_res, frame, far_half_km,
     far_min, far_max, cell_m, _) = struct.unpack_from(BLOCK_HEADER_FORMAT, blob, 0)
    if magic != BLOCK_MAGIC or version != BLOCK_VERSION:
        raise ValueError("not a terrain block of this version")
    n_near, n_far = res * res, far_res * far_res
    if len(blob) != BLOCK_HEADER_BYTES + 2 * (n_near + n_far):
        raise ValueError("block has the wrong length")
    near = np.frombuffer(blob, dtype="<u2", count=n_near, offset=BLOCK_HEADER_BYTES).reshape(res, res)
    far = np.frombuffer(blob, dtype="<u2", count=n_far, offset=BLOCK_HEADER_BYTES + 2 * n_near).reshape(far_res, far_res)
    return {
        "lat": lat, "lon": lon, "res": res, "visible_km": vis_km, "pad_km": pad_km, "far_res": far_res,
        "far_half_km": far_half_km, "frame": frame, "source_cell_m": cell_m,
        "near_m": z_min + near.astype(np.float64) * (z_max - z_min) / 65535.0,
        "far_m": far_min + far.astype(np.float64) * (far_max - far_min) / 65535.0,
    }
