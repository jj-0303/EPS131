@echo off
cd /d "%~dp0"
echo.
echo EEW Lab V0.1 - Local Test Server
echo.
echo Open this URL in your browser:
echo   http://localhost:8000
 echo.
echo Press Ctrl+C to stop.
echo.
py -m http.server 8000
pause
