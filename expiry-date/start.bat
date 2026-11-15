@echo off
rem Expiry Date: serve this folder on http://localhost:8080 (the page loads its data files, so it cannot be opened by double-click).
cd /d "%~dp0"
echo Open http://localhost:8080/  -  stop with Ctrl+C
start "" http://localhost:8080/
where python >nul 2>&1 && (python -m http.server 8080 & goto :eof)
py -m http.server 8080
