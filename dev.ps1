# Uruchamia Koala w trybie deweloperskim (hot-reload — zmiany w kodzie widac od razu).
# Okno aplikacji otworzy sie automatycznie. Zamkniecie okna lub Ctrl+C konczy tryb dev.

$ErrorActionPreference = "Stop"

Write-Host "== Ladowanie srodowiska Visual Studio ==" -ForegroundColor Cyan
$vs = & "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * -property installationPath
Import-Module "$vs\Common7\Tools\Microsoft.VisualStudio.DevShell.dll"
Enter-VsDevShell -VsInstallPath $vs -SkipAutomaticLocation -DevCmdArguments "-arch=x64 -host_arch=x64" | Out-Null
$env:Path = $env:Path + ';' + [Environment]::GetEnvironmentVariable('Path','User') + ';' + [Environment]::GetEnvironmentVariable('Path','Machine')

Set-Location "$PSScriptRoot\app"

Write-Host "== Uruchamianie trybu deweloperskiego ==" -ForegroundColor Cyan
npm run tauri dev
