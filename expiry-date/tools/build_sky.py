#!/usr/bin/env python3
"""Build data/sky_2027_2066.bin (+ sky_meta.json) from the raw JPL Horizons text blocks.

Input : data/raw/horizons_subpoints_*.txt  (made by data/raw/download_data.bat)
        Horizons OBSERVER table, target Moon (301), centre Earth geocentre (500@399),
        QUANTITIES 14 (sub-observer point = sub-Earth point), 15 (sub-solar point), 20 (range), 1 h steps.
Output: data/sky_2027_2066.bin  five float32 arrays of length N (little endian), back to back:
        earth_lon_deg, earth_lat_deg, sun_lon_deg, sun_lat_deg, earth_dist_km
        data/sky_meta.json      layout, time axis, source, retrieval date, checksums.

Part of the Expiry Date project (NASA Space Apps 2026). Code written with AI assistance (Claude).
"""
import glob, hashlib, json, os, re, datetime as dt
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'data', 'raw')
OUT = os.path.join(ROOT, 'data')
AU_KM = 149597870.700
MONTHS = {m: i + 1 for i, m in enumerate('Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split())}
START = dt.datetime(2027, 1, 1, tzinfo=dt.timezone.utc)
END = dt.datetime(2067, 1, 1, tzinfo=dt.timezone.utc)


def parse_block(path):
    txt = open(path, encoding='utf-8', errors='replace').read()
    if '$$SOE' not in txt or '$$EOE' not in txt:
        raise SystemExit(f'{path}: no $$SOE/$$EOE, Horizons returned an error:\n{txt[:600]}')
    head = txt.split('$$SOE')[0]
    body = txt.split('$$SOE')[1].split('$$EOE')[0].strip().splitlines()
    times, vals = [], []
    for ln in body:
        f = [x.strip() for x in ln.split(',')]
        m = re.match(r'(\d{4})-([A-Za-z]{3})-(\d{2}) (\d{2}):(\d{2})', f[0])
        t = dt.datetime(int(m[1]), MONTHS[m[2]], int(m[3]), int(m[4]), int(m[5]), tzinfo=dt.timezone.utc)
        times.append(t)
        # f[1], f[2] are the solar/lunar presence flags; then ObsSub LON, LAT, SunSub LON, LAT, delta(AU), deldot
        vals.append([float(f[3]), float(f[4]), float(f[5]), float(f[6]), float(f[7]) * AU_KM])
    meta = {
        'ephemeris': (re.search(r'Target body name: Moon \(301\)\s+\{source: (\w+)\}', head) or [None, '?'])[1],
        'frame': (re.search(r'Target pole/equ\s*:\s*(\w+)', head) or [None, '?'])[1],
        'retrieved': (re.search(r'API_USER (.+?) Pasadena', head) or [None, '?'])[1].strip(),
    }
    return times, np.array(vals, dtype=np.float64), meta


def main():
    files = sorted(glob.glob(os.path.join(RAW, 'horizons_subpoints_*.txt')))
    assert len(files) == 8, f'expected 8 blocks, found {len(files)}'
    all_t, all_v, metas = [], [], []
    for i, p in enumerate(files):
        t, v, m = parse_block(p)
        metas.append(m)
        if i > 0:
            # blocks share their boundary row (stop time of block i-1 == start of block i): must agree
            assert t[0] == all_t[-1], (p, t[0], all_t[-1])
            d = np.abs(v[0] - all_v[-1][-1]).max()
            assert d < 1e-6, f'boundary mismatch {d} at {p}'
            t, v = t[1:], v[1:]
        all_t += t
        all_v.append(v)
        print(os.path.basename(p), len(t), m)
    # block 0 is kept whole, later blocks lost their (duplicate) boundary row above
    V = np.concatenate(all_v)
    N = len(all_t)
    assert V.shape == (N, 5), (V.shape, N)
    hours = (END - START).days * 24 + 1
    assert N == hours, f'rows {N} != expected {hours}'
    exp0, exp1 = all_t[0], all_t[-1]
    assert exp0 == START and exp1 == END, (exp0, exp1)
    dts = np.array([(all_t[k + 1] - all_t[k]).total_seconds() for k in range(N - 1)])
    assert (dts == 3600).all(), 'time axis has gaps or repeats'
    assert np.isfinite(V).all()
    arrs = [V[:, k].astype('<f4') for k in range(5)]
    names = ['earth_lon_deg', 'earth_lat_deg', 'sun_lon_deg', 'sun_lat_deg', 'earth_dist_km']
    err = [float(np.abs(arrs[k].astype(np.float64) - V[:, k]).max()) for k in range(5)]
    blob = b''.join(a.tobytes() for a in arrs)
    binp = os.path.join(OUT, 'sky_2027_2066.bin')
    open(binp, 'wb').write(blob)
    meta = {
        'file': 'sky_2027_2066.bin',
        'description': 'Hourly sub-Earth and sub-solar point on the Moon and Earth-Moon distance, 2027-01-01 00:00 UTC to 2067-01-01 00:00 UTC (inclusive).',
        'n': N,
        'start_utc': '2027-01-01T00:00:00Z',
        'step_hours': 1,
        'dtype': 'float32 little-endian',
        'arrays': names,
        'layout': 'five arrays of length n, back to back, in the order of "arrays"',
        'units': {'lon': 'degrees east, 0..360', 'lat': 'degrees', 'dist': 'km (Horizons delta in AU x 149597870.700)'},
        'frame': metas[0]['frame'] + ' (Mean-Earth/Polar-Axis), east longitude positive',
        'ephemeris': metas[0]['ephemeris'],
        'source': 'NASA JPL Horizons API, https://ssd.jpl.nasa.gov/api/horizons.api',
        'query': {'COMMAND': '301', 'CENTER': '500@399', 'EPHEM_TYPE': 'OBSERVER', 'QUANTITIES': '14,15,20',
                  'STEP_SIZE': '1h', 'CSV_FORMAT': 'YES', 'blocks': 'eight 5-year blocks, Jan 1 to Jan 1'},
        'retrieved': metas[0]['retrieved'],
        'max_float32_rounding_error': dict(zip(names, err)),
        'sha256': hashlib.sha256(blob).hexdigest(),
        'ai_note': 'Prepared with AI assistance (Claude, Anthropic). Values are NASA JPL Horizons output, repacked without change except float32 rounding.',
    }
    json.dump(meta, open(os.path.join(OUT, 'sky_meta.json'), 'w'), indent=2)
    print('N', N, 'bytes', len(blob))
    for k, nme in enumerate(names):
        print(f'{nme:15s} min {V[:, k].min():12.5f} max {V[:, k].max():12.5f} float32 err {err[k]:.2e}')
    d_sun = np.diff(V[:, 2]); d_sun = (d_sun + 180) % 360 - 180
    print('sun lon step per hour: min %.4f max %.4f' % (d_sun.min(), d_sun.max()))


if __name__ == '__main__':
    main()
