@echo off
REM Dwuklik, zeby zbudowac aplikacje Koala. Wywoluje build.ps1 w PowerShell.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1"
echo.
pause
