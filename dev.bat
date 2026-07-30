@echo off
REM Dwuklik, zeby uruchomic Narwhal w trybie deweloperskim (hot-reload). Wywoluje dev.ps1.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev.ps1"
echo.
pause
