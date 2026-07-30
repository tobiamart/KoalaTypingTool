@echo off
REM Dwuklik: uruchamia lokalny serwer proxy AI (Cloudflare Worker przez wrangler dev).
REM Serwer nasluchuje na http://localhost:8787 - musi dzialac, zeby "Check text"
REM w Narwhalu zwracalo wyniki. Ctrl+C albo zamkniecie okna zatrzymuje serwer.
cd /d "%~dp0server"
call npm run dev
pause
