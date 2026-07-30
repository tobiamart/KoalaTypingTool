---
name: run
description: Launch Narwhal (Tauri desktop app) and its AI proxy server on macOS or Windows. Use when asked to run, start, build, or open the app, or to confirm a change works in the real app. Covers the two-process setup (proxy on :8787 + app on :1420), port conflicts, and building installers.
---

# Uruchamianie Narwhala

Aplikacja to **dwa procesy**. Fact-check („Check text") nie zadziała bez serwera proxy.

| Proces | Katalog | Komenda | Port |
|---|---|---|---|
| Serwer proxy AI | `server/` | `npm run dev` | 8787 |
| Aplikacja (dev, hot-reload) | `app/` | `npm run tauri dev` | 1420 (Vite) |

Do samego pisania serwer nie jest potrzebny — tylko do weryfikacji AI.

## Zanim uruchomisz — sprawdź, czy już nie chodzi

Uruchomienie drugiej instancji kończy się `Error: Port 1420 is already in use`
i przerwanym buildem. **Zawsze sprawdź najpierw:**

```bash
lsof -nP -iTCP:1420 -sTCP:LISTEN   # Vite (aplikacja)
lsof -nP -iTCP:8787 -sTCP:LISTEN   # serwer proxy
pgrep -lf "target/debug/app$"      # okno aplikacji
```

Jeśli coś nasłuchuje — użytkownik ma już otwartą sesję. **Nie zabijaj jej.**
Zmiany we frontendzie (`app/src/**`) i w serwerze wchodzą hot-reloadem do
działającej sesji; nie trzeba nic restartować. Restart jest potrzebny tylko po
zmianie `server/.dev.vars` albo `app/src-tauri/**` (Rust — Tauri przebuduje sam).

## macOS (i Linux)

**Skryptów `dev.bat` / `build.bat` / `server-dev.bat` NIE używaj poza Windowsem** —
wołają PowerShell i ładują środowisko Visual Studio. Wołaj `npm` wprost.

```bash
# Terminal 1 — serwer proxy AI
cd server && npm run dev

# Terminal 2 — aplikacja z hot-reloadem
cd app && npm run tauri dev
```

Uruchamiając w tle (agent), przekieruj log do pliku i czekaj na sygnał gotowości:
otwarcie okna to pojawienie się procesu `target/debug/app`, gotowość serwera to
odpowiedź na `curl -s http://localhost:8787`.

## Windows

Kompiluj **wyłącznie** w PowerShell w Visual Studio Dev Shell — nigdy w Git Bash
(jego `/usr/bin/link.exe` przesłania linker MSVC → `link: extra operand`).
Dwuklikowe skrypty w root robią to za Ciebie: `dev.bat`, `build.bat`,
`server-dev.bat`. Szczegóły środowiska: `CLAUDE.md`.

## Health-check serwera

```bash
curl -s http://localhost:8787
```

- `{"ok":true,"mode":"live"}` → klucz z `server/.dev.vars` działa, prawdziwe wywołania API
- `{"ok":true,"mode":"mock"}` → brak klucza; `/verify` zwraca dane przykładowe
  (strumieniowane co 350 ms), UI pokazuje disclaimer

Klucz żyje **tylko** w `server/.dev.vars` (gitignorowany, wzór w `.dev.vars.example`).
Nigdy nie trafia do aplikacji desktopowej. Po edycji tego pliku zrestartuj serwer.

⚠️ Zostawiony placeholder `sk-ant-...` jest **gorszy niż brak pliku** — serwer
uzna, że klucz jest, i zwróci 502 przy każdym sprawdzeniu.

## Budowanie instalatora

```bash
cd app
npm run tauri build -- --debug   # szybciej; podwójny `--` jest wymagany
npm run tauri build              # release, zoptymalizowany
```

Artefakty (debug): `app/src-tauri/target/debug/bundle/macos/Narwhal.app`
oraz `.../bundle/dmg/Narwhal_0.1.0_aarch64.dmg`. Wersja release ląduje w
`target/release/...`. Kolejne buildy nadpisują poprzednie.

Instalacja lokalna: `cp -R app/src-tauri/target/debug/bundle/macos/Narwhal.app /Applications/`

## Pułapki, na które już się trafiło

- **`npm install` po zmianie `package.json`** — brak `vitest` w `node_modules`
  wywala build na etapie `tsc` (typecheck obejmuje pliki testowe).
- **Fact-check w zbudowanej `.app` na macOS** — CORS w `server/src/index.ts`
  dopuszcza `localhost:1420` i `tauri.localhost` (origin webview na Windows).
  Spakowana aplikacja na macOS ma inny origin, więc żądanie zostanie odrzucone.
  W trybie dev problemu nie ma.
- **Po przeniesieniu/zmianie nazwy folderu repo** pierwszy build jest pełny —
  `app/src-tauri/target/` ma zaszyte ścieżki bezwzględne.
- **`cd` w tle nie jest trwały** — w jednym wywołaniu podawaj pełną ścieżkę
  (`cd /abs/path/app && npm run ...`), inaczej trafisz w zły katalog.
