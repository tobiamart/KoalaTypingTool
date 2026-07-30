@echo off
REM Dwuklik, zeby zbudowac aplikacje Narwhal. Wywoluje build.ps1 w PowerShell.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1"
echo.
pause
