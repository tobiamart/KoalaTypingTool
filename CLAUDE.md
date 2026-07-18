# Koala — kontekst projektu dla Claude

> Ten plik jest wczytywany automatycznie przez Claude Code po otwarciu repo.
> Służy do kontynuowania pracy nad projektem na dowolnym urządzeniu.
> Konwencje językowe TEGO pliku i rozmów: patrz sekcja „Język".

## Czym jest Koala

Aplikacja **desktopowa** (Tauri) do pisania **książek** i pojedynczych **dokumentów**
(np. prac naukowych) z funkcją **weryfikacji AI** (fact-checking).

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

## Typy projektów i przechowywanie

Użytkownik wybiera na ekranie startowym jeden z dwóch typów:

- **`book`** — wiele rozdziałów, każdy osobny plik `.md` w `chapters/`
- **`document`** — pojedynczy `document.md`

Oba mają **notatki autora** w `notes/` (opis świata, postacie, bibliografia) —
będą kompendium/kontekstem dla AI.

**Przechowywanie: pliki Markdown na dysku** (świadomie zamiast SQLite — własność
danych, backup, brak vendor lock-in). Folder projektu ma `project.json` (manifest:
typ, tytuł, kolejność rozdziałów, lista notatek).

## Kluczowe pliki frontendu (`app/src/`)

- `types.ts` — modele domenowe (ProjectType, FileRef, ProjectManifest, OpenProject, FontChoice…)
- `lib/storage.ts` — I/O plików przez plugin-fs (createProject, loadProject, addChapter,
  addNote, renameRef, deleteRef…); `slugify()` transliteruje polskie znaki
- `lib/ai.ts` — `verifyText()` to na razie **ATRAPA** zwracająca przykładowe dane;
  do podmiany na `fetch` do serwera proxy. IssueType = `"grammar" | "consistency" | "logic"`
- `store/useStore.ts` — Zustand (otwarty projekt, aktywny plik, autozapis, verifyOpen,
  editorFont, settingsOpen)
- `components/` — StartScreen, Sidebar, Editor, EditorToolbar, VerificationPanel, Settings
- `styles.css` — ciemny minimalistyczny motyw (near-black z eukaliptusowym odcieniem,
  akcent szałwiowa zieleń)

Rust (`app/src-tauri/`): tylko init pluginów (opener, dialog, fs) — brak własnych komend.
Uprawnienia w `capabilities/default.json` (scope `$HOME/**`).

## Ważne pułapki (TipTap 3)

Komponenty **NIE** re-renderują się automatycznie przy zmianie stanu edytora — do
liczników słów/znaków, aktywnych przycisków paska itp. używać **`useEditorState`**,
inaczej wartości zostają w tyle. `useEditor` ma `immediatelyRender: false`
(inaczej skróty klawiszowe nie działają w React StrictMode).

## Bezpieczeństwo — TWARDA ZASADA

**Klucz Anthropic API NIGDY nie trafia do aplikacji desktopowej.** Ma być wyłącznie
na osobnym **serwerze proxy** (rozważany Cloudflare Worker + ewentualnie D1).
Aplikacja woła tylko ten proxy. Serwer jeszcze nie zbudowany (jest w TODO).

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
npm run tauri dev    # albo: npm run tauri build -- --debug
```

Wymagania: Node, Rust (host MSVC), VS Build Tools 2022 z workloadem
`Microsoft.VisualStudio.Workload.VCTools`. Świeży `node`/`cargo` nie są w PATH nowej
sesji, dopóki nie doda się User+Machine PATH (jak wyżej).

**Smart App Control (Windows 11)** blokuje `tauri build` release (os error 4551) —
dlatego build używa `--debug`. Release wymagałby wyłączenia SAC lub podpisu aplikacji.

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
