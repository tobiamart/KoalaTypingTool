# Narwhal — kontekst projektu dla Claude

> Ten plik jest wczytywany automatycznie przez Claude Code po otwarciu repo.
> Służy do kontynuowania pracy nad projektem na dowolnym urządzeniu.
> Konwencje językowe TEGO pliku i rozmów: patrz sekcja „Język".

## Czym jest Narwhal

Aplikacja **desktopowa** (Tauri) do pisania długich tekstów podzielonych na
**rozdziały**, z funkcją **weryfikacji AI** (fact-checking).

Cel funkcji AI: po kliknięciu przycisku tekst jest sprawdzany pod kątem
(1) spójności faktów z resztą treści **i notatkami** (`consistency`),
(2) logiki zdarzeń — niemożliwe sekwencje, złamanie zasad świata (`logic`),
(3) gramatyki. Podział przebiega wg *natury* błędu, nie wg źródła: niezgodność
faktu = `consistency` niezależnie od tego, czy fakt padł w notatkach czy
w innym rozdziale. Wyniki pokazywane w chowanym panelu po prawej.

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
  addNote, renameRef, deleteRef, moveRefTo…); `slugify()` transliteruje polskie znaki;
  **kolejność rozdziałów i notatek żyje wyłącznie w manifeście** — przeciągnięcie
  w sidebarze nie przenumerowuje plików, więc `03-targ.md` może być pierwszym
  rozdziałem. Świadome: przenumerowanie oznaczałoby lawinę zmian nazw na dysku
  przy każdym ruchu, a nazwa pliku nie jest źródłem prawdy o kolejności;
  ignorowane błędy fact-checku w `ignored-issues.json` w folderze projektu
  (klucz: plik + typ + cytat)
- `lib/highlight.ts` — mapowanie cytatów z fact-checku na zakresy dokumentu
  (czysta logika, testy w `highlight.test.ts`)
- `lib/issueHighlight.ts` — dekoracje ProseMirror z tych zakresów (nie zmieniają
  dokumentu → nie brudzą undo/autozapisu); plugin wpina `Editor.tsx`, a logika
  siedzi osobno, bo testuje się ją na samym `EditorState`, bez DOM-u
  (`issueHighlight.test.ts`). **Edycja fragmentu gasi jego podświetlenie
  natychmiast** — cytat modelu przestaje wtedy opisywać tekst, który jest
  w dokumencie. Rozpoznanie idzie po zakresach zmienionych przez transakcję
  (krańce włącznie, więc dopisanie litery na styku też się liczy), a nie przez
  przeliczanie cytatów od nowa: to ostatnie znaczyłoby skanowanie całego
  rozdziału przy **każdym naciśnięciu klawisza**. Zgaszone zgłoszenie dostaje
  w store flagę `edited` (karta w panelu przygaszona, ale sugestia zostaje —
  sięga się po nią właśnie w trakcie poprawiania) i nie wraca do dokumentu
  przy kolejnym przeliczeniu. Skutek uboczny: cofnięcie edycji (Ctrl+Z) nie
  przywraca podświetlenia — wraca dopiero po ponownym „Check text"
- wyniki weryfikacji żyją w store (`issues`), ignorowane też (`ignored`) — bo
  „Ignore" klika się w dwóch miejscach: na karcie w panelu i w dymku nad
  fragmentem w tekście (dymek jest z tego powodu najeżdżalny, bez
  `pointer-events: none`, a jego zgaszenie ma opóźnienie na przejechanie myszą
  z tekstu). Rozwijany podgląd „Ignored issues" na dole panelu (cały projekt)
  z przyciskiem „Restore"
- `lib/ai.ts` — `verifyText()` woła serwer proxy (`POST /verify`) z timeoutem
  i rozróżnianiem błędów. IssueType = `"grammar" | "consistency" | "logic"`;
  `issueKey()` to tożsamość zgłoszenia (kategoria + cytat) używana przez
  dekoracje i listę ignorowanych
- `lib/search.ts` — wyszukiwarka projektu (czysta logika, testy w `search.test.ts`):
  `fold()` sprowadza tekst do postaci porównawczej **znak w znak** (małe litery
  bez ogonków), więc „zolw" znajduje „ŻÓŁW", a pozycje trafień dalej pasują
  do oryginału — ta niezmienność długości jest tu warunkiem poprawności, nie
  optymalizacją. `searchDocs()` zwraca trafienia z podglądem kontekstu, po trzy
  na plik, tytułowe przed treściowymi. Indeks buduje `SearchPalette` przy każdym
  otwarciu (treść z dysku, dla aktywnego pliku wersja ze store'u — inaczej
  świeżo napisane zdanie byłoby nie do znalezienia)
- `store/useStore.ts` — Zustand (otwarty projekt, aktywny plik, autozapis, verifyOpen,
  editorFont, settingsOpen, searchOpen, reveal)
- `components/` — StartScreen, Sidebar, Editor, EditorToolbar, VerificationPanel,
  Settings, SearchPalette (paleta ⌘K / Ctrl+K — skrót łapany w fazie
  przechwytywania w `App.tsx`, żeby nie połknął go edytor; wybór wyniku ustawia
  `reveal` w store, a `FileEditor` przewija do wskazanego **wystąpienia**
  i podświetla je dekoracją `search-hl` — do pierwszego kliknięcia albo
  klawisza, nie na odliczony czas)
- `styles.css` — ciemny minimalistyczny motyw (near-black z chłodnym, granatowym
  odcieniem, akcent arktyczny błękit — paleta marki, skojarzenie z narwalem
  i wodą pod lodem; ten sam błękit niesie logo `assets/narwhal.svg`, z którego
  generowane są ikony aplikacji). Kategorie fact-checku muszą trzymać się
  z dala od błękitu akcentu: podświetlenie wyszukiwarki stoi w tekście obok
  podkreśleń błędów, więc wspólny odcień znaczyłby, że trafienie wyszukiwania
  czyta się jak błąd — dlatego gramatyka dostała morską zieleń, nie sąsiedni
  błękit. **Wszystkie kolory, promienie i cienie pochodzą
  z tokenów w `:root`** — nie wpisywać wartości na miejscu, bo wtedy motyw
  przestaje być jednym źródłem prawdy. Promienie mają skalę `--radius-xs|sm|
  (bazowy)|lg`. Każdy kolor tekstu musi trzymać próg **WCAG AA 4,5:1** na tle,
  na którym realnie występuje; `--faint` (najsłabszy poziom) leży najbliżej
  granicy i był już raz poprawiany, więc jego przyciemnienie wymaga policzenia
  kontrastu, nie oka
- `lib/storage.test.ts` — testy vitest warstwy dyskowej (`npm test`); pilnują
  scenariuszy utraty treści (kolizje nazw, rename na dysku, kolejność)

**Zabezpieczenia przed utratą tekstu** (nie osłabiać przy zmianach): każdy plik ma
własną instancję edytora (`key` w `Editor.tsx` — inaczej undo przecieka między
plikami); usuwanie pyta o potwierdzenie (`confirm` z plugin-dialog); zamknięcie
okna dopycha zapis (`onCloseRequested` w `App.tsx` + `core:window:allow-destroy`
w capabilities); `saveActive` zwraca boolean i błędy zapisu lądują w `error`
(pływający baner w workspace).

Rust (`app/src-tauri/`): init pluginów (opener, dialog, fs) + `register_spellcheck_defaults()`
dla macOS — **brak własnych komend** (`invoke`) i tak ma zostać.
Uprawnienia w `capabilities/default.json` (scope `$HOME/**`).

**Przeciąganie (HTML5 DnD) wymaga `"dragDropEnabled": false`** w oknie
(`tauri.conf.json`). Mimo nazwy ta opcja znaczy „działa **wewnętrzny** system
drag-and-drop Tauri, a DOM-owy jest wyłączony" — z domyślnym `true` warstwa
natywna połyka zdarzenia, zanim dojdą do webview, i sortowanie listy w sidebarze
po prostu nic nie robi. W przeglądarce tego problemu nie widać, bo tam nie ma
warstwy natywnej — **testuj DnD w zbudowanej aplikacji, nie w Vite**.
Na macOS dochodzi drugi warunek: WKWebView nie przeciąga dowolnych elementów
na sam atrybut `draggable`, potrzebuje `-webkit-user-drag: element` (jest
w `.navitem` w `styles.css`). Wyłączenie `dragDropEnabled` nic nie kosztuje,
dopóki aplikacja nie obsługuje upuszczania plików z systemu.

**Sprawdzanie pisowni** korzysta z natywnego mechanizmu webview (słowniki systemowe,
zero bajtów w instalatorze). Wymaga *dwóch* rzeczy naraz: atrybutu `spellcheck`
w `editorProps` (`Editor.tsx`, świadomie bez `lang` — system sam rozpoznaje język)
**i** klucza `WebContinuousSpellCheckingEnabled` w NSUserDefaults, bo w osadzonym
WKWebView ciągłe sprawdzanie jest domyślnie wyłączone (`lib.rs`). Sam atrybut HTML
nie wystarczy.

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
- **Język odpowiedzi** ustala `detectLanguage()` w `server/src/index.ts`: osobne
  mikro-zapytanie do `claude-haiku-4-5` (próbka 1500 znaków, `max_tokens: 16`)
  zwraca **nazwę** języka rozdziału, a ta nazwa idzie do promptu głównego obok
  tekstu. Dowolny język, nie tylko polski i angielski. Błąd wykrywania nie psuje
  weryfikacji — wtedy angielski.
  **Nie zastępować tego instrukcją w prompcie.** Sprawdzone i nieskuteczne były
  cztery warianty: reguła w prompcie systemowym, opisy pól w schemacie JSON,
  przypomnienie tuż przy tekście oraz pole `language` jako pierwsze w structured
  outputs. Za każdym razem model kopiował język **notatek**, więc rozdział po
  angielsku dostawał opisy po polsku. Działa wyłącznie nazwa podana z góry.
- **Bramka dostępu:** gdy ustawiony jest `NARWHAL_AUTH_TOKEN`, `/verify` wymaga
  `Authorization: Bearer <token>` — inaczej 401. Bez tokenu bramka jest wyłączona
  (praca lokalna bez konfiguracji); health-check raportuje `auth: "on" | "off"`.
  Po stronie aplikacji token daje szew `getAuthToken()` w `app/src/lib/ai.ts`
  (dziś `VITE_NARWHAL_TOKEN` z `app/.env.local`, wzór w `app/.env.example`;
  docelowo token zalogowanego użytkownika). `authenticate()` zwraca też `userId`,
  który trafia do logu `usage` — jedyne miejsce do podmiany, gdy dojdą konta.
- **Ograniczniki nadużyć** (bo token siedzi w bundlu aplikacji i trzeba zakładać,
  że wycieknie): limit tempa 10 żądań/60 s na adres IP (binding `[[ratelimits]]`,
  odpowiedź 429) oraz limity rozmiaru — 8 MB ciała, 200 tys. znaków rozdziału,
  1,8 mln znaków łącznie (odpowiedź 413). Bez nich jedno żądanie albo jedna
  pętla mogą kosztować dowolnie dużo. Aplikacja tłumaczy 429 i 413 na komunikaty.
  Limity rozmiaru są celowo tak wysokie, **żeby zmieściła się cała spora
  książka**: Sonnet 5 ma okno 1 mln tokenów, a 1,8 mln znaków to ~700 tys.
  tokenów dla polskiego. Konsekwencja: sprawdzenie pełnej książki kosztuje
  rzędy wielkości więcej niż rozdziału — to argument za limitami per użytkownik,
  nie przeciw nim. Parsowanie takiego żądania przekracza też 10 ms CPU
  darmowego planu Cloudflare (wymaga Workers Paid).
- **CORS** wpuszcza tylko originy okna Narwhala: `localhost:1420` (dev),
  `tauri.localhost` (webview Windows), `tauri://localhost` (webview macOS/Linux).
  `allowHeaders` musi jawnie zawierać `Authorization`, inaczej preflight odrzuci
  żądanie z tokenem.
- **Produkcja:** Worker jest **wdrożony** na własnej domenie `api.narwhal.ink`
  (`routes` z `custom_domain = true` w `wrangler.toml`, bez adresu
  `*.workers.dev`); tryb `live` i bramka `on`. Aktualizacja: `npm run deploy`
  w `server/`. Sekrety wgrywaj **przez potok**, nie interaktywnie:
  `printf '%s' "$VAL" | wrangler secret put ANTHROPIC_API_KEY` — gdy stdin nie
  jest terminalem, wrangler nie pyta, połyka puste wejście i zapisuje **pusty
  sekret**, raportując „Success". Po wdrożeniu sprawdź `curl -s https://api.narwhal.ink`
  (oczekiwane `mode:"live"`, `auth:"on"`). `PROXY_URL` w `app/src/lib/ai.ts`
  przełącza się sam: localhost w dev, produkcja w buildzie.

## Strona `narwhal.ink` (`web/`)

Landing pod korzeniem domeny — **osobny Worker** od proxy AI (`narwhal-site`
vs `narwhal-proxy`). Rozdzielone celowo: strona nie ma powodu dzielić limitów
tempa ani sekretów z endpointem `/verify`, a ruch statyczny na Workers jest
nielimitowany, więc landing nie rusza budżetu CPU proxy.

- **Bez frameworka i bez builda.** Jeden plik `web/public/index.html` (style
  i skrypt inline), obok `narwhal.svg` (favicon) i `og.png` (podgląd linku,
  kopia ikony aplikacji). Astro albo Vite dokładać dopiero przy **drugiej
  podstronie** — dla jednej strony build byłby czystym kosztem.
- **Paleta jest skopiowana z `app/src/styles.css`** do bloku `:root` na górze
  pliku. Przy zmianie motywu w aplikacji trzeba ją przenieść ręcznie — to
  świadomy koszt zamiast budowania współdzielonego pakietu tokenów dla dwóch
  plików. Motyw wyłącznie ciemny, bo aplikacja jest ciemna.
- **Hero to działające demo, nie zrzut ekranu**: akapit rękopisu z trzema
  prawdziwymi błędami (`consistency` — data urodzenia sprzeczna z notatkami,
  `logic` — świecąca latarnia wygaszona w innym rozdziale, `grammar` — „come"
  zamiast „came"). Podkreślenia rysują się sekwencyjnie, karty dokują z prawej
  — odwzorowanie strumienia NDJSON z `/verify`. Kategorie używają tych samych
  tokenów `--grammar` / `--consistency` / `--logic`, co aplikacja.
- **Typografia koduje podział z aplikacji**: serif (`--font-serif`) to głos
  rękopisu, sans (`--font-ui`) głos narzędzia, mono (`--font-mono`) metadane
  i ścieżki. Nie mieszać ról — w hero ten kontrast jest nośnikiem znaczenia.
- Uruchamianie: `npm install` i `npm run dev` w `web/` (wrangler dev,
  **port 8788** wpisany w `[dev]` — domyślny 8787 kolidowałby z serwerem proxy),
  publikacja `npm run deploy`. **Przed pierwszym wdrożeniem** trzeba usunąć
  w panelu Cloudflare wiszące rekordy A dla `narwhal.ink` i `www` — inaczej
  `custom_domain = true` zgłosi konflikt przy zakładaniu DNS. Cała procedura
  z pre-flightem i wycofaniem: skill `deploy-site`.
- Przyciski prowadzą do `github.com/tobiamart/narwhal`. Repozytorium pod tą
  nazwą **jeszcze nie istnieje** (zostało skasowane 2026-08-03, ma wrócić) —
  do tego czasu linki dają 404.
- Sekcja „Get Narwhal" mówi „Not released yet" i **nie wspomina o podpisie
  kodu** — świadoma decyzja właściciela, nie przeoczenie.

## Język

- **UI aplikacji po angielsku** (etykiety, tooltipy, błędy, dialogi, tagline
  „Fact-checking writing tool"). Identyfikatory i wartości w kodzie po angielsku.
- **Komentarze w kodzie po polsku.** Rozmowy z użytkownikiem po polsku.
- Nie mieszać: żadnych polskich stringów w UI.

## Budowanie i uruchamianie

Projekt jest rozwijany **na dwóch maszynach równolegle: Windows i macOS**. Żadna
z nich nie jest „tą główną" — obie instrukcje poniżej są aktualne, a różnice
sprowadzają się do środowiska kompilacji Rusta i skryptów pomocniczych.

Skrypty dwuklikowe w root projektu **działają tylko na Windows**: **`dev.bat`**
(tryb deweloperski, hot-reload), **`build.bat`** (buduje instalator) i
**`server-dev.bat`** (serwer proxy). Wołają `.ps1` i ładują środowisko Visual
Studio — na macOS/Linuksie wołaj `npm` wprost.

### Pierwsze uruchomienie po świeżym klonie (obie platformy)

`npm install` trzeba wykonać **w dwóch katalogach**, a sekrety odtworzyć ręcznie
— są gitignorowane, więc klon ich nie przynosi:

```bash
cd app && npm install        # frontend + Tauri CLI
cd ../server && npm install  # Worker (wrangler); bez tego proxy nie wystartuje
```

- `server/.dev.vars` — klucz Anthropic (wzór: `.dev.vars.example`). Bez niego
  serwer działa w trybie atrapy i nic nie kosztuje; **atrapa `sk-ant-...`
  zostawiona w pliku jest gorsza niż brak pliku** (serwer wejdzie w tryb live
  i zwróci błąd z API).
- `app/.env.local` — `VITE_NARWHAL_TOKEN` (wzór: `.env.example`). Potrzebny
  tylko wtedy, gdy serwer ma włączoną bramkę: lokalnie przy ustawionym
  `NARWHAL_AUTH_TOKEN`, a **zawsze** przy budowaniu aplikacji produkcyjnej —
  produkcyjny Worker ma bramkę `on`, więc build bez tokenu dostanie 401.
- **Skille globalne** (`frontend-design`, `webapp-testing`) też nie przychodzą
  z klonem — komendy w sekcji „Skille Claude Code" niżej. Skille projektowe
  (`run`, `verify`) są w repo i działają od razu.

**Decyzja z 2026-07-31: klucz API nie jest trzymany lokalnie na żadnej maszynie
deweloperskiej.** Żyje wyłącznie jako sekret Cloudflare (`wrangler secret list`
pokazuje `ANTHROPIC_API_KEY` i `NARWHAL_AUTH_TOKEN`). Zamiast lokalnego trybu
live tryb dev celuje w produkcyjnego Workera przez `VITE_NARWHAL_PROXY_URL=https://api.narwhal.ink`
w `app/.env.local`. Konsekwencje, o których trzeba pamiętać:

- **Każde „Check text" podczas pracy nad kodem to prawdziwy koszt** na koncie
  Anthropic — nie ma już darmowej piaskownicy w trybie live. Tym pilniejszy
  staje się limit wydatków w konsoli Anthropic (Blok 1 w `TODO.md`).
- Do pracy nad samym UI (strumień, podświetlenia, ignorowanie) dalej najtańszy
  jest **lokalny serwer w trybie atrapy**: zakomentuj `VITE_NARWHAL_PROXY_URL`
  i uruchom `npm run dev` w `server/` bez klucza.
- Obowiązuje limit tempa **10 żądań/60 s na IP** — dotyczy też Twoich testów.
- Rotacja tokenu bramki: `TOKEN=$(openssl rand -hex 32)`, potem `printf '%s' "$TOKEN" | wrangler secret put NARWHAL_AUTH_TOKEN`
  i ta sama wartość do `VITE_NARWHAL_TOKEN`. **Nowy sekret propaguje się
  kilkadziesiąt sekund** — 401 tuż po wgraniu nie oznacza błędu, powtórz test.

### Windows

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

### macOS / Linux

Nie ma tu problemu z `link.exe` — wystarczy zwykły terminal. Wymagany Node, Rust
i zależności systemowe Tauri (na macOS: Xcode Command Line Tools).

```bash
cd app
npm run tauri dev              # tryb deweloperski
npm run tauri build            # release: .app + .dmg
npm run tauri build -- --debug # szybszy build; podwójny `--` jest wymagany
npm test                       # testy jednostkowe (vitest)
```

Artefakty lądują w `app/src-tauri/target/{release,debug}/bundle/`. Podpis
i notaryzacja Apple pozostają w TODO — bez nich `.dmg` u obcego użytkownika
wywoła ostrzeżenie Gatekeepera.

**Buildów nie da się robić krzyżowo:** `.app`/`.dmg` wymaga macOS z Xcode,
`.exe`/`.msi` wymaga Windows z MSVC. Docelowo obie platformy z GitHub Actions
(`tauri-action`).

## Skille Claude Code

Dwa rodzaje, o różnym losie przy klonowaniu repozytorium.

**Projektowe — w repo, przychodzą z klonem** (`.claude/skills/`, nic nie trzeba robić):

- **`run`** — uruchamianie aplikacji i serwera proxy (dwa procesy, porty 8787 i 1420),
  sprawdzanie zajętych portów, budowanie instalatorów, pułapki per platforma.
- **`verify`** — sprawdzenie zmiany od statyki po realne wywołanie fact-checku
  (typecheck → testy → strumień NDJSON → kategorie błędów → prompt cache).
- **`publish`** — wypchnięcie „eleganckiej wersji" do publicznego repozytorium
  `tobiamart/narwhal` (patrz sekcja „Dwa repozytoria" niżej).
- **`deploy-site`** — wypuszczenie nowej wersji strony na `narwhal.ink`
  (Worker `narwhal-site`): pre-flight (walidacja HTML, rozjazd palety względem
  `app/src/styles.css`), konflikt rekordów DNS przy pierwszym wdrożeniu,
  weryfikacja po wdrożeniu i wycofanie. **Nie mylić z `publish`** — tamten
  dotyczy repozytorium, ten samej witryny; nie są sprzężone.

**Globalne — poza repo, `git pull` ich NIE przyniesie** (`~/.agents/skills/`
z dowiązaniem w `~/.claude/skills/`). Po przesiadce na drugą maszynę trzeba je
doinstalować ręcznie:

```bash
npx skills add anthropics/claude-code -s frontend-design -g -y
npx skills add anthropics/skills     -s webapp-testing  -g -y
```

- **`frontend-design`** (Anthropic) — kierunek wizualny przy nowych ekranach.
  Uwaga: skill pcha ku „odważnym" wyborom i elementom sygnaturowym, a Narwhal
  jest narzędziem do pisania, gdzie bohaterem ma być tekst użytkownika, nie
  interfejs. Używać do nowych widoków, nie do przemeblowania motywu.
- **`webapp-testing`** (Anthropic) — Playwright: zrzuty ekranu, klikanie, logi
  konsoli. Wymaga dodatkowo Pythona z Playwrightem (`python3 -m venv venv`,
  `pip install playwright`, `playwright install chromium`) — instaluj **poza
  repo** (katalog roboczy sesji), nie w projekcie.

Wbudowane i zawsze dostępne: `claude-api` (obowiązkowo przy każdej zmianie
wywołań modelu w `server/src/index.ts` — patrz `verify`), `code-review`,
`security-review`.

### Podgląd aplikacji w przeglądarce

Frontend da się otworzyć w zwykłym Chromium (`webapp-testing`) **tylko
z atrapą IPC Tauri** — bez niej React wywala się od razu. Atrapa jest plikiem
roboczym sesji, nie repozytorium, więc odtwarza się ją przy potrzebie; dwie
rzeczy, na których to przewraca się za pierwszym razem:

- `window.__TAURI_INTERNALS__.metadata.currentWindow` musi istnieć, inaczej
  `getCurrentWindow()` w `App.tsx` rzuca przy rejestrowaniu `onCloseRequested`;
- `read_text_file` musi zwracać **bajty** (`Array.from(new TextEncoder()...)`),
  bo plugin-fs dekoduje odpowiedź przez `TextDecoder` — string daje pustkę
  i mylący błąd „Unexpected token … is not valid JSON".

Czego w przeglądarce sprawdzić **nie można**: przeciągania (patrz
`dragDropEnabled` wyżej), dialogów systemowych i sprawdzania pisowni. Te
wymagają zbudowanej aplikacji.

## Praca z gitem

**Nie commituj ani nie pushuj za użytkownika — on robi commity sam.** Zawsze podawaj
gotowe komendy, ale ich nie wykonuj. `.gitignore` ignoruje `node_modules/`, `target/`,
`dist/`, oraz artefakty (`*.exe`, `*.msi`, `*.dmg`, `.app`…).

### Dwa repozytoria

Projekt jest publikowany w dwóch miejscach i to jest świadome — GitHub nie umie
ukryć pojedynczych plików, więc rozdziału na „robocze" i „publiczne" nie da się
zrobić wewnątrz jednego repozytorium.

| Repo | Rola | Zawartość |
|---|---|---|
| `tobiamart/KoalaTypingTool` | codzienna praca, pełna historia | wszystko |
| `tobiamart/narwhal` | wersja publiczna, „elegancka" | tylko to, co potrzebne do kompilacji i działania |

Publiczne repo dostaje `app/`, `README.md` i `.gitignore` — samą aplikację
desktopową. Poza nim zostają `server/`, `CLAUDE.md`, `TODO.md`, `.claude/`,
`web/`, `scripts/` oraz pomocniki `*.bat` / `*.ps1`. Lista mieszka w tablicy
`PATHS` w `scripts/publish-narwhal.sh` — **dopisanie tam ścieżki jest decyzją
o upublicznieniu.**

`server/` zostaje prywatny, bo niesie `SYSTEM_PROMPT` (wartość produktu)
i konfigurację infrastruktury. Cena tej decyzji: aplikacja zbudowana
z publicznego źródła nie zweryfikuje tekstu — `api.narwhal.ink` stoi za bramką
tokenową. README mówi to wprost, żeby nikt nie szukał błędu u siebie.
Praca z drugiej maszyny idzie przez KoalaTypingTool, nie przez publiczne repo.

Publikacja jest **ręczna i rzadka**, nie sprzężona z commitami tutaj: robi się ją,
gdy stan jest pewny. Skrypt bierze zawartość z `HEAD` (nie ze stanu roboczego),
czyści katalog docelowy do gołego `.git` i rozpakowuje tam wybrane ścieżki, więc
usunięcie pliku tutaj usuwa go także tam. Historia publiczna jest własna i płaska
— historia z KoalaTypingTool nigdy tam nie idzie. Szczegóły i lista kontrolna:
skill `publish`.

## Co dalej

Bieżąca lista zadań jest w **`TODO.md`** — tam też leży kolejność wynikająca
z łańcucha blokad. Najbliższe sensowne kroki (do potwierdzenia z użytkownikiem,
nie zaczynać bez zielonego światła): limity kosztów po stronie konta Anthropic
i plan Workers Paid (Blok 1 — decyzje właściciela, nie kod), potem komfort
pisania (wyszukiwanie rozdziałów i notatek, foldery notatek) oraz GitHub Actions
do budowania instalatorów.
