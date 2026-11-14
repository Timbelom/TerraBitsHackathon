@echo off
rem Expiry Date: laedt die Rohdaten (JPL Horizons + NASA PGDA LOLA) in diesen Ordner.
rem Start: Doppelklick oder im Terminal ausfuehren. Braucht nur curl.exe (in Windows 10/11 enthalten).
cd /d "%~dp0"
echo [1/3] Horizons: Sub-Punkte von Erde und Sonne auf dem Mond, stuendlich 2027-2066
curl.exe -L --fail --retry 3 -o horizons_subpoints_2027_2032.txt "https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND=%%27301%%27&CENTER=%%27500@399%%27&MAKE_EPHEM=YES&EPHEM_TYPE=OBSERVER&QUANTITIES=%%2714,15,20%%27&START_TIME=%%272027-01-01%%27&STOP_TIME=%%272032-01-01%%27&STEP_SIZE=%%271h%%27&CSV_FORMAT=YES"
curl.exe -L --fail --retry 3 -o horizons_subpoints_2032_2037.txt "https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND=%%27301%%27&CENTER=%%27500@399%%27&MAKE_EPHEM=YES&EPHEM_TYPE=OBSERVER&QUANTITIES=%%2714,15,20%%27&START_TIME=%%272032-01-01%%27&STOP_TIME=%%272037-01-01%%27&STEP_SIZE=%%271h%%27&CSV_FORMAT=YES"
curl.exe -L --fail --retry 3 -o horizons_subpoints_2037_2042.txt "https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND=%%27301%%27&CENTER=%%27500@399%%27&MAKE_EPHEM=YES&EPHEM_TYPE=OBSERVER&QUANTITIES=%%2714,15,20%%27&START_TIME=%%272037-01-01%%27&STOP_TIME=%%272042-01-01%%27&STEP_SIZE=%%271h%%27&CSV_FORMAT=YES"
curl.exe -L --fail --retry 3 -o horizons_subpoints_2042_2047.txt "https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND=%%27301%%27&CENTER=%%27500@399%%27&MAKE_EPHEM=YES&EPHEM_TYPE=OBSERVER&QUANTITIES=%%2714,15,20%%27&START_TIME=%%272042-01-01%%27&STOP_TIME=%%272047-01-01%%27&STEP_SIZE=%%271h%%27&CSV_FORMAT=YES"
curl.exe -L --fail --retry 3 -o horizons_subpoints_2047_2052.txt "https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND=%%27301%%27&CENTER=%%27500@399%%27&MAKE_EPHEM=YES&EPHEM_TYPE=OBSERVER&QUANTITIES=%%2714,15,20%%27&START_TIME=%%272047-01-01%%27&STOP_TIME=%%272052-01-01%%27&STEP_SIZE=%%271h%%27&CSV_FORMAT=YES"
curl.exe -L --fail --retry 3 -o horizons_subpoints_2052_2057.txt "https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND=%%27301%%27&CENTER=%%27500@399%%27&MAKE_EPHEM=YES&EPHEM_TYPE=OBSERVER&QUANTITIES=%%2714,15,20%%27&START_TIME=%%272052-01-01%%27&STOP_TIME=%%272057-01-01%%27&STEP_SIZE=%%271h%%27&CSV_FORMAT=YES"
curl.exe -L --fail --retry 3 -o horizons_subpoints_2057_2062.txt "https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND=%%27301%%27&CENTER=%%27500@399%%27&MAKE_EPHEM=YES&EPHEM_TYPE=OBSERVER&QUANTITIES=%%2714,15,20%%27&START_TIME=%%272057-01-01%%27&STOP_TIME=%%272062-01-01%%27&STEP_SIZE=%%271h%%27&CSV_FORMAT=YES"
curl.exe -L --fail --retry 3 -o horizons_subpoints_2062_2067.txt "https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND=%%27301%%27&CENTER=%%27500@399%%27&MAKE_EPHEM=YES&EPHEM_TYPE=OBSERVER&QUANTITIES=%%2714,15,20%%27&START_TIME=%%272062-01-01%%27&STOP_TIME=%%272067-01-01%%27&STEP_SIZE=%%271h%%27&CSV_FORMAT=YES"
echo [2/3] PGDA: 5-m-Gelaende und Unsicherheit fuer Site01 und Site04
curl.exe -L --fail --retry 3 -C - -o Site01_final_adj_5mpp_surf.tif "https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/Site01/Site01_final_adj_5mpp_surf.tif"
curl.exe -L --fail --retry 3 -C - -o Site01_final_adj_5mpp_toterr.tif "https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/Site01/Site01_final_adj_5mpp_toterr.tif"
curl.exe -L --fail --retry 3 -C - -o Site04_final_adj_5mpp_surf.tif "https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/Site04/Site04_final_adj_5mpp_surf.tif"
curl.exe -L --fail --retry 3 -C - -o Site04_final_adj_5mpp_toterr.tif "https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/Site04/Site04_final_adj_5mpp_toterr.tif"
echo [3/3] PGDA: Fernfeld 80-90 S, 80 m/Pixel (ca. 181 MB)
curl.exe -L --fail --retry 3 -C - -o LDEM_80S_80MPP_ADJ.TIF "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF"
echo.
echo Fertig. Dateien in diesem Ordner:
dir /b
pause
