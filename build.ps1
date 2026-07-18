# Buduje aplikacje Koala (wersja debug z instalatorem).
# Uruchamia sie w srodowisku Visual Studio Dev Shell, zeby uzyc wlasciwego linkera MSVC.

$ErrorActionPreference = "Stop"

Write-Host "== Ladowanie srodowiska Visual Studio ==" -ForegroundColor Cyan
$vs = & "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * -property installationPath
Import-Module "$vs\Common7\Tools\Microsoft.VisualStudio.DevShell.dll"
Enter-VsDevShell -VsInstallPath $vs -SkipAutomaticLocation -DevCmdArguments "-arch=x64 -host_arch=x64" | Out-Null
$env:Path = $env:Path + ';' + [Environment]::GetEnvironmentVariable('Path','User') + ';' + [Environment]::GetEnvironmentVariable('Path','Machine')

Set-Location "$PSScriptRoot\app"

Write-Host "== Budowanie aplikacji (moze potrwac kilka minut) ==" -ForegroundColor Cyan
npm run tauri build -- --debug

Write-Host ""
Write-Host "== Gotowe! Pliki znajdziesz w: ==" -ForegroundColor Green
Write-Host "  app\src-tauri\target\debug\app.exe"
Write-Host "  app\src-tauri\target\debug\bundle\nsis\Koala_0.1.0_x64-setup.exe"
