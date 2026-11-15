@echo off
rem Serves the whole repo on http://localhost:8080 (TerraBits site at /, Expiry Date at /expiry-date/).
cd /d "%~dp0"
echo Open http://localhost:8080/  -  stop with Ctrl+C
where python >nul 2>&1 && (python -m http.server 8080 & goto :eof)
py -m http.server 8080
