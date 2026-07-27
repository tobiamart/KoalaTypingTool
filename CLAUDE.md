# Koala — kontekst projektu dla Claude

> Ten plik jest wczytywany automatycznie przez Claude Code po otwarciu repo.
> Służy do kontynuowania pracy nad projektem na dowolnym urządzeniu.
> Konwencje językowe TEGO pliku i rozmów: patrz sekcja „Język".

## Czym jest Koala

Aplikacja **desktopowa** (Tauri) do pisania długich tekstów podzielonych na
**rozdziały**, z funkcją **weryfikacji AI** (fact-checking).

Cel funkcji AI: po kliknięciu przycisku tekst jest sprawdzany pod kątem
(1) spójności z resztą treści, (2) poprawności logicznej wg zasad świata z notatek,
(3) gramatyki. Wyniki pokazywane w chowanym panelu po prawej.

## Stos technologiczny

- **Tauri 2** (backend Rust) + **React 19** + **TypeScript** + **Vite 7**
- **TipTap 3.28** (edytor) + **tiptap-markdown 0.9** (serializacja do Markdown)
- **Zustand 5** (stan) + localStorage (ostatnie projekty, szerokość panelu, czcionka)
- I/O plików: **oficjalne pluginy Tauri** `@tauri-apps/plugin-fs` + `plugin-dialog`
  + `@tauri-apps/api/path` — **NIE** własne komendy Rust (świadoma decyzja użytkownika).

Aplikacja jest w podkatalogu **`app/`**. Backend Rust w `app/src-tauri/`.

## Struktura projektu i przechowywanie

**Jest tylko jeden typ projektu** (decyzja z 2026-07-25 — wcześniej istniał też typ
`document` z pojedynczym plikiem; został usunięty dla uproszczenia):

- **rozdziały** — wiele plików `.md` w `chapters/`
- **notatki autora** w `notes/` (opis świata, postacie, bibliografia) — kompendium
  i kontekst dla AI

Pojedynczy dokument (np. praca naukowa) to po prostu projekt z jednym rozdziałem.

**Przechowywanie: pliki Markdown na dysku** (świadomie zamiast SQLite — własność
danych, backup, brak vendor lock-in). Folder projektu ma `project.json` (manifest:
tytuł, `createdAt`, kolejność rozdziałów, lista notatek — **bez** pola `type`).
Stare manifesty z `type` wczytują się dalej; pole znika przy pierwszym zapisie.

## Kluczowe pliki frontendu (`app/src/`)

- `types.ts` — modele domenowe (FileRef, ProjectManifest, OpenProject, FontChoice…)
- `lib/storage.ts` — I/O plików przez plugin-fs (createProject, loadProject, addChapter,
  addNote, renameRef, deleteRef…); `slugify()` transliteruje polskie znaki;
  ignorowane błędy fact-checku w `ignored-issues.json` w folderze projektu
  (klucz: plik + typ + cytat)
- `lib/highlight.ts` — mapowanie cytatów z fact-checku na zakresy dokumentu
  (czysta logika, testy w `highlight.test.ts`); Editor podświetla je dekoracjami
  ProseMirror (nie zmieniają dokumentu → nie brudzą undo/autozapisu), tooltip
  po najechaniu; wyniki weryfikacji żyją w store (`issues`), przycisk „Ignore"
  na karcie błędu dopisuje wpis do ignorowanych; rozwijany podgląd „Ignored
  issues" na dole panelu (cały projekt) z przyciskiem „Restore"
- `lib/ai.ts` — `verifyText()` woła serwer proxy (`POST /verify`) z timeoutem
  i rozróżnianiem błędów. IssueType = `"grammar" | "consistency" | "logic"`
- `store/useStore.ts` — Zustand (otwarty projekt, aktywny plik, autozapis, verifyOpen,
  editorFont, settingsOpen)
- `components/` — StartScreen, Sidebar, Editor, EditorToolbar, VerificationPanel, Settings
- `styles.css` — ciemny minimalistyczny motyw (near-black z eukaliptusowym odcieniem,
  akcent szałwiowa zieleń)
- `lib/storage.test.ts` — testy vitest warstwy dyskowej (`npm test`); pilnują
  scenariuszy utraty treści (kolizje nazw, rename na dysku, kolejność)

**Zabezpieczenia przed utratą tekstu** (nie osłabiać przy zmianach): każdy plik ma
własną instancję edytora (`key` w `Editor.tsx` — inaczej undo przecieka między
plikami); usuwanie pyta o potwierdzenie (`confirm` z plugin-dialog); zamknięcie
okna dopycha zapis (`onCloseRequested` w `App.tsx` + `core:window:allow-destroy`
w capabilities); `saveActive` zwraca boolean i błędy zapisu lądują w `error`
(pływający baner w workspace).

Rust (`app/src-tauri/`): tylko init pluginów (opener, dialog, fs) — brak własnych komend.
Uprawnienia w `capabilities/default.json` (scope `$HOME/**`).

## Ważne pułapki (TipTap 3)

Komponenty **NIE** re-renderują się automatycznie przy zmianie stanu edytora — do
liczników słów/znaków, aktywnych przycisków paska itp. używać **`useEditorState`**,
inaczej wartości zostają w tyle. `useEditor` ma `immediatelyRender: false`
(inaczej skróty klawiszowe nie działają w React StrictMode).

## Bezpieczeństwo — TWARDA ZASADA

**Klucz Anthropic API NIGDY nie trafia do aplikacji desktopowej.** Żyje wyłącznie
na **serwerze proxy** w `server/` (Cloudflare Worker + Hono). Aplikacja woła tylko
ten proxy (`app/src/lib/ai.ts`, `PROXY_URL`).

## Serwer proxy AI (`server/`)

- **Cloudflare Worker + Hono**, endpoint `POST /verify` (`{text, notes, chapters}`),
  `GET /` = health-check z trybem pracy. Odpowiedź to **strumień NDJSON**:
  `start` → `issue`* → `done` (albo `error`) — serwer parsuje JSON modelu
  przyrostowo (`makeIssueExtractor`) i wypycha każdy dokończony błąd od razu;
  UI pokazuje wyniki na żywo, jeden po drugim.
- **Dwutrybowy:** bez klucza → atrapa (`mock: true`, UI pokazuje disclaimer);
  klucz w `server/.dev.vars` (gitignorowany, wzór w `.dev.vars.example`) →
  prawdziwe wywołanie API Anthropic (`claude-sonnet-5`, structured outputs
  ze schematem JSON, streaming + `finalMessage()`, prompt caching z TTL 1h —
  prefiks: system prompt + notatki + pozostałe rozdziały; weryfikowany rozdział
  poza cache). Żądanie `/verify` niesie `{text, notes, chapters}` — pozostałe
  rozdziały są kontekstem spójności.
- **Lokalnie:** `server-dev.bat` w root albo `npm run dev` w `server/` →
  `http://localhost:8787` (wrangler dev, bez konta Cloudflare).
- **CORS** wpuszcza tylko originy okna Koali (`localhost:1420`, `tauri.localhost`).
- **Deploy (TODO):** `npm run deploy` + `wrangler secret put ANTHROPIC_API_KEY`,
  potem podmienić `PROXY_URL` w `app/src/lib/ai.ts`.

## Język

- **UI aplikacji po angielsku** (etykiety, tooltipy, błędy, dialogi, tagline
  „Fact-checking writing tool"). Identyfikatory i wartości w kodzie po angielsku.
- **Komentarze w kodzie po polsku.** Rozmowy z użytkownikiem po polsku.
- Nie mieszać: żadnych polskich stringów w UI.

## Budowanie i uruchamianie

Skrypty dwuklikowe w root projektu (Windows): **`dev.bat`** (tryb deweloperski,
hot-reload) i **`build.bat`** (buduje instalator). Wołają `.ps1`.

### Windows (obecna maszyna deweloperska)

**Kompiluj Rust/Tauri wyłącznie przez PowerShell w Visual Studio Dev Shell — nigdy
przez Git Bash.** Powód: Git Bash ma `/usr/bin/link.exe` (GNU coreutils), który
przesłania linker MSVC → `link: extra operand` / `linking with link.exe failed`.

```powershell
$vs = & "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" -latest -property installationPath
Import-Module "$vs\Common7\Tools\Microsoft.VisualStudio.DevShell.dll"
Enter-VsDevShell -VsInstallPath $vs -SkipAutomaticLocation -DevCmdArguments "-arch=x64 -host_arch=x64" | Out-Null
$env:Path = $env:Path + ';' + [Environment]::GetEnvironmentVariable('Path','User') + ';' + [Environment]::GetEnvironmentVariable('Path','Machine')
Set-Location '<repo>\app'
npm install          # przy pierwszym uruchomieniu na nowym urządzeniu
npm run tauri dev    # albo: npm run tauri build
npm test             # testy jednostkowe (vitest) — warstwa storage.ts
```

Wymagania: Node, Rust (host MSVC), VS Build Tools 2022 z workloadem
`Microsoft.VisualStudio.Workload.VCTools`. Świeży `node`/`cargo` nie są w PATH nowej
sesji, dopóki nie doda się User+Machine PATH (jak wyżej).

**Smart App Control (Windows 11)** — **wyłączony przez użytkownika 2026-07-25**
(`VerifiedAndReputablePolicyState = 0`; decyzja nieodwracalna bez reinstalacji
Windows). Wcześniej blokował uruchamianie niepodpisanego `app.exe` (Event ID
3077/3033 w logu `Microsoft-Windows-CodeIntegrity/Operational`) oraz build release
(os error 4551). Po wyłączeniu **build release działa normalnie** — skrypty budują
release (bez `--debug`). Podpis aplikacji (certyfikat / Azure Trusted Signing)
pozostaje w TODO pod dystrybucję — u użytkowników z włączonym SAC niepodpisana
aplikacja nie uruchomi się.

### macOS / Linux (planowane)

Nie ma tu problemu z `link.exe`. Wymagany Node + Rust + zależności systemowe Tauri.
Zwykły `npm install` w `app/`, potem `npm run tauri dev` / `npm run tauri build`.
Aplikacji na macOS **nie da się zbudować na Windows** (potrzebny macOS + Xcode) —
docelowo przez GitHub Actions (`tauri-action`). Plik `.exe` z Windows nie zadziała na macOS.

## Praca z gitem

**Nie commituj ani nie pushuj za użytkownika — on robi commity sam.** Zawsze podawaj
gotowe komendy, ale ich nie wykonuj. `.gitignore` ignoruje `node_modules/`, `target/`,
`dist/`, oraz artefakty (`*.exe`, `*.msi`, `*.dmg`, `.app`…).

## Co dalej

Bieżąca lista zadań jest w **`TODO.md`**. Najbliższe sensowne kroki (do potwierdzenia
z użytkownikiem, nie zaczynać bez zielonego światła): serwer proxy AI, GitHub Actions
do budowania, wersja macOS.
