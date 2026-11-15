#!/usr/bin/env python3
"""Local server for the site: the files of this folder, plus terrain for any point on the Moon.

  python tools/serve.py [--port 8080] [--ldem PATH] [--open]

  /                      the page (index.html) and every other file of the repo folder
  /api/status            what this server can do, as JSON
  /api/terrain?lat=&lon= the terrain block around a point (MOON_ME, degrees, east longitude), cut from
                         LOLA LDEM64 on the first request and kept in cache/terrain/

Terrain on request needs numpy, rasterio and LDEM64_PA_pixel_202405.tif in the repo folder. Without them the
server still serves the page; the page then uses the blocks in data/terrain/ and says what is missing.
"""
import argparse
import json
import sys
import threading
import urllib.parse
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = ROOT / "cache" / "terrain"
sys.path.insert(0, str(Path(__file__).resolve().parent))


class Terrain:
    """Cuts terrain blocks out of the global raster, one at a time, and remembers them on disk."""

    def __init__(self, ldem_arg):
        self.ldem = None
        self.reason = ""
        self._lock = threading.Lock()
        try:
            import lunar
        except ImportError as exc:                      # numpy missing
            self.reason = f"Python package missing: {exc.name}"
            return
        self.lunar = lunar
        path = lunar.find_ldem(ROOT, ldem_arg)
        if path is None:
            self.reason = f"{lunar.LDEM_CANDIDATES[0]} not found in the repo folder (download: {lunar.LDEM_URL})"
            return
        try:
            self.ldem = lunar.Ldem(path)
        except ImportError as exc:                      # rasterio missing
            self.reason = f"Python package missing: {exc.name}"
        except Exception as exc:
            self.reason = f"{path.name} cannot be read: {exc}"

    def status(self):
        out = {"terrain": self.ldem is not None, "frame": "MOON_ME"}
        if self.ldem is not None:
            out.update(source=self.ldem.path.name, source_frame=f"MOON_{self.ldem.frame}",
                       pixel_m=round(self.ldem.cell_m, 1), block_version=self.lunar.BLOCK_VERSION)
        else:
            out["reason"] = self.reason
        return out

    def block(self, lat, lon):
        """(bytes, from_cache)"""
        lunar = self.lunar
        lat, lon = round(lat, 5), round(lon % 360.0, 5) % 360.0
        path = CACHE_DIR / f"block_{lat:+09.5f}_{lon:09.5f}.bin"
        with self._lock:
            if path.exists():
                blob = path.read_bytes()
                if len(blob) == lunar.block_size_bytes() and blob[:6] == lunar.BLOCK_MAGIC + lunar.BLOCK_VERSION.to_bytes(2, "little"):
                    return blob, True
            blob = lunar.build_block(self.ldem, lat, lon)
            try:
                CACHE_DIR.mkdir(parents=True, exist_ok=True)
                tmp = path.with_suffix(".tmp")
                tmp.write_bytes(blob)
                tmp.replace(path)
            except OSError as exc:
                print(f"  note: block not cached ({exc})")
            return blob, False


class Handler(SimpleHTTPRequestHandler):
    server_version = "TerraBitsLocal/1.0"
    # Windows takes MIME types from the registry, where .js is sometimes text/plain; browsers then refuse modules.
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css",
        ".html": "text/html", ".svg": "image/svg+xml", ".bin": "application/octet-stream",
        ".glb": "model/gltf-binary", ".mp4": "video/mp4", ".wasm": "application/wasm",
    }
    terrain: Terrain = None

    def _send(self, status, body, content_type):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self._cache_header_sent = True
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, status, obj):
        self._send(status, json.dumps(obj).encode("utf-8"), "application/json")

    def do_GET(self):
        parts = urllib.parse.urlsplit(self.path)
        if parts.path == "/api/status":
            return self._json(200, self.terrain.status())
        if parts.path == "/api/terrain":
            return self._terrain(urllib.parse.parse_qs(parts.query))
        # the folder also holds things that are not part of the site
        segments = [s for s in urllib.parse.unquote(parts.path).split("/") if s]
        if any(s.startswith(".") for s in segments) or parts.path.lower().endswith((".tif", ".tiff", ".py", ".bat")):
            return self._send(404, b"not found", "text/plain; charset=utf-8")
        return super().do_GET()

    do_HEAD = do_GET

    def _terrain(self, query):
        if self.terrain.ldem is None:
            return self._json(503, {"error": self.terrain.reason})
        try:
            lat, lon = float(query["lat"][0]), float(query["lon"][0])
            if not (-90.0 <= lat <= 90.0 and -360.0 <= lon <= 720.0):
                raise ValueError
        except (KeyError, IndexError, ValueError):
            return self._json(400, {"error": "use /api/terrain?lat=<-90..90>&lon=<east longitude in degrees>"})
        try:
            blob, cached = self.terrain.block(lat, lon)
        except Exception as exc:                        # tell the page instead of dropping the connection
            print(f"  terrain {lat:.4f}, {lon:.4f}: ERROR {exc}")
            return self._json(500, {"error": str(exc)})
        print(f"  terrain {lat:.4f}, {lon % 360:.4f}: {'from cache' if cached else 'cut from ' + self.terrain.ldem.path.name}")
        self._send(200, blob, "application/octet-stream")

    def end_headers(self):
        if not getattr(self, "_cache_header_sent", False):
            self.send_header("Cache-Control", "no-cache")     # files change while we work on them
        self._cache_header_sent = False
        super().end_headers()

    def log_message(self, fmt, *args):                  # keep the terminal quiet; terrain requests are logged above
        pass


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = sys.platform != "win32"       # on Windows this would let two servers share a port

    def handle_error(self, request, client_address):
        # A browser that closes a tab or cancels a download is not an error worth a traceback.
        if isinstance(sys.exc_info()[1], (ConnectionError, TimeoutError)):
            return
        super().handle_error(request, client_address)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--ldem", help="global raster (default: LDEM64_PA_pixel_202405.tif in the repo folder)")
    ap.add_argument("--open", action="store_true", help="open the page in the browser")
    args = ap.parse_args()

    Handler.terrain = Terrain(args.ldem)
    handler = partial(Handler, directory=str(ROOT))
    httpd = None
    for port in range(args.port, args.port + 20):
        try:
            httpd = Server((args.host, port), handler)
            break
        except OSError:
            continue
    if httpd is None:
        sys.exit(f"No free port between {args.port} and {args.port + 19}.")
    url = f"http://{args.host}:{httpd.server_address[1]}/"
    print(f"TerraBits runs on {url}   (Expiry Date: {url}expiry-date/)")
    if Handler.terrain.ldem is not None:
        print(f"Terrain for any point: yes, from {Handler.terrain.ldem.describe()}")
    else:
        print(f"Terrain for any point: no ({Handler.terrain.reason}).")
        print("The listed sites still open from data/terrain/.")
    print("Stop with Ctrl+C.")
    if args.open:
        webbrowser.open(url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
