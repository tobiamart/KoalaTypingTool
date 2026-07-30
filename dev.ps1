# Uruchamia Narwhal w trybie deweloperskim (hot-reload - zmiany w kodzie widac od razu).
# Okno aplikacji otworzy sie automatycznie. Zamkniecie okna lub Ctrl+C konczy tryb dev.

$ErrorActionPreference = "Stop"

Write-Host "== Ladowanie srodowiska Visual Studio ==" -ForegroundColor Cyan

# Katalog instalatora VS doklejamy do PATH, bo wewnetrzny VsDevCmd.bat wola
# vswhere.exe po samej nazwie - bez tego sypie "not recognized" i srodowisko
# laduje sie tylko czesciowo.
$vsInstaller = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer"
$vswhere = Join-Path $vsInstaller "vswhere.exe"
if (-not (Test-Path $vswhere)) {
    throw "Nie znaleziono vswhere.exe ($vswhere). Zainstaluj VS Build Tools 2022 z workloadem VCTools."
}
$env:Path = "$vsInstaller;$env:Path"

$vs = & $vswhere -latest -products * -property installationPath
if (-not $vs) {
    throw "vswhere nie znalazl zadnej instalacji Visual Studio / Build Tools."
}

Import-Module (Join-Path $vs "Common7\Tools\Microsoft.VisualStudio.DevShell.dll")
Enter-VsDevShell -VsInstallPath $vs -SkipAutomaticLocation -DevCmdArguments "-arch=x64 -host_arch=x64" | Out-Null

# Swieze instalacje node/cargo nie sa w PATH nowej sesji - doklejamy PATH User+Machine.
$env:Path = $env:Path + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')

Set-Location "$PSScriptRoot\app"

Write-Host "== Uruchamianie trybu deweloperskiego ==" -ForegroundColor Cyan
npm run tauri dev
exit $LASTEXITCODE
