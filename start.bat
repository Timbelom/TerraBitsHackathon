@echo off
rem Serves the whole repo on http://127.0.0.1:8080 (TerraBits site at /, Expiry Date at /expiry-date/)
rem and cuts terrain for any point on the Moon if LDEM64_PA_pixel_202405.tif, numpy and rasterio are there.
cd /d "%~dp0"
where python >nul 2>&1 && (python tools\serve.py --open %* & goto :eof)
py tools\serve.py --open %*
