# Narwhal — do zrobienia

Kolejność wynika z **łańcucha blokad**, nie z atrakcyjności zadań. Pytanie
porządkujące: *czy Narwhal działa bez terminala?* Dziś nie — fact-check wymaga
dwóch procesów i `localhost:8787`. Dopóki to nie jest zamknięte, nowe funkcje
dokładają wartość do narzędzia, którego nie da się normalnie używać.

## Blok 1 — „działa po instalacji"

Zamknięty poza dwoma pozycjami, które są decyzjami właściciela, nie kodem.

- [ ] **Limit wydatków w konsoli Anthropic** — jedyne zabezpieczenie niezależne
      od błędów w naszym kodzie. Klucz jest już na produkcji, więc pilne
- [ ] **Workers Paid ($5/mies.)** — darmowy plan daje 10 ms CPU na żądanie,
      a samo sparsowanie żądania z całą książką (1,4 MB) trwa dłużej. Bez tego
      sprawdzenia dużych projektów będą kończyć się błędem 1102

## Blok 2 — komfort pisania

- [ ] Wyszukiwanie rozdziałów i notatek (najbardziej odczuwalne, gdy książka rośnie)
- [ ] Foldery notatek (grupowanie notatek autora w podfoldery)
- [ ] **Gramatyka lokalnie** (decyzja odłożona — zależy od docelowego języka
      manuskryptów). Angielski: [Harper](https://writewithharper.com/) jako crate
      w `src-tauri`, Apache-2.0, bez zastrzeżeń komercyjnych. Polski też:
      LanguageTool (LGPL-2.1) tylko jako **osobny lokalny serwer instalowany przez
      użytkownika** — nie redystrybuujemy nic, więc nie ma obowiązków licencyjnych;
      przed ewentualnym pakowaniem trzeba sprawdzić licencje **zasobów językowych**
      (kod jest LGPL, ale słowniki bywają GPL). Wyjęcie gramatyki z promptu AI to
      też zysk jakościowy: model przestaje zasypywać panel literówkami i skupia się
      na `consistency`/`logic`

## Blok 3 — subskrypcja (kierunek długoterminowy)

Aplikacja desktopowa nie utrzyma sekretu — sekret w binarce da się wydobyć.
Dlatego jedyny trwały model to tożsamość użytkownika sprawdzana po stronie serwera.
Blok 1 przygotowuje pod to grunt (protokół `Bearer` + `userId`), ale tego nie buduje.

- [ ] Logowanie użytkowników (Clerk / Supabase Auth / Auth0; w Tauri: logowanie
      w przeglądarce + deep link, refresh token w keychainie systemowym)
- [ ] Płatności — Stripe albo Lemon Squeezy / Paddle (*merchant of record*
      rozlicza VAT za Ciebie przy sprzedaży z Polski do UE)
- [ ] Baza subskrypcji i licznik użycia (Cloudflare D1), aktualizowana webhookami
- [ ] **Limity na użytkownika** — nie opcja, a część produktu: koszt backendu
      rośnie z rozmiarem projektu, i to gwałtownie. Mały projekt: ~$0,04 za
      sprawdzenie z trafionym cache. **Pełna książka w kontekście (~700 tys.
      tokenów): ~$4 za pierwsze sprawdzenie (zapis cache po podwójnej stawce)
      i ~$0,21 za kolejne.** Jeden intensywny użytkownik z grubą powieścią to
      setki dolarów miesięcznie — wielokrotność sensownej ceny abonamentu
- [ ] Gatować **tylko fact-check** — pisanie ma działać bez sieci i subskrypcji

## Blok 4 — dystrybucja

- [ ] GitHub Actions — automatyczne budowanie (Windows / macOS / Linux) przez
      `tauri-action`
- [ ] Podpis aplikacji (Azure Trusted Signing lub certyfikat OV/EV) — u użytkowników
      z włączonym Smart App Control / SmartScreen niepodpisana aplikacja nie
      uruchomi się lub wywoła ostrzeżenia. Na macOS: podpis + notaryzacja Apple
- [ ] Zmienić nazwę repozytorium na GitHubie i `git remote set-url` (nazwa
      `KoalaTypingTool` nie odpowiada już ani nazwie, ani charakterowi projektu)

## Zrobione

- [x] Serwer proxy AI (Cloudflare Worker + Hono w `server/`, lokalnie `wrangler dev`;
      klucz w `.dev.vars` → tryb live, bez klucza → atrapa)
- [x] Podłączenie weryfikacji w aplikacji (`app/src/lib/ai.ts` woła serwer)
- [x] Tryb live przetestowany na prawdziwych wywołaniach API
- [x] Model `claude-sonnet-5` zamiast `claude-opus-5` — ta sama klasa zadania,
      wyraźnie taniej i szybciej
- [x] Kontekst pozostałych rozdziałów w `/verify` — spójność wykrywana **między**
      rozdziałami, nie tylko wewnątrz jednego
- [x] Prompt caching z trzema breakpointami (system → rozdziały → notatki),
      TTL 1h; edycja notatki nie unieważnia cache rozdziałów
- [x] Podział kategorii wg **natury** błędu, nie źródła: niezgodność faktu to
      `consistency` (choćby fakt pochodził z notatek), `logic` to niemożliwe
      zdarzenia i złamane zasady świata
- [x] Strumieniowanie wyników (NDJSON) — błędy pojawiają się jeden po drugim
      w trakcie pracy modelu, nie wszystkie naraz na końcu
- [x] Podświetlanie błędów w tekście (dekoracje ProseMirror — nie brudzą
      dokumentu, undo ani autozapisu) + tooltip z opisem i sugestią
- [x] Ignorowanie błędów (`ignored-issues.json` w folderze projektu) z podglądem
      listy i przywracaniem
- [x] Licznik zużycia tokenów w panelu (cache / wejście / wyjście)
- [x] Wskaźnik pracy (kółko) przed pierwszym wynikiem i w trakcie strumienia
- [x] Rebranding Koala → **Narwhal** (domena `narwhal.ink`); nazwa „Koala"
      kolidowała z aktywnym produktem Koala AI / KoalaWriter
- [x] Ikony aplikacji — jedna grafika `app/src/assets/narwhal.svg` zasila ekran
      startowy i cały zestaw ikon; nieprzezroczyste zaokrąglone tło (macOS nie
      maskuje ikon sam)
- [x] Sekrety produkcyjne wgrane (`NARWHAL_AUTH_TOKEN` przed `ANTHROPIC_API_KEY`),
      tryb `live` i bramka `on` potwierdzone z zewnątrz. **Pułapka:**
      `wrangler secret put` nie pyta interaktywnie, gdy stdin nie jest
      terminalem — połyka puste wejście i zapisuje pusty sekret, raportując
      „Success". Wgrywać przez potok: `printf '%s' "$VAL" | wrangler secret put X`
- [x] Fact-check działa w spakowanej `.app` — CSP i CORS (`tauri://localhost`)
      przetestowane na produkcji, nie tylko w trybie dev
- [x] Język odpowiedzi AI zgodny z językiem rozdziału, niezależnie od języka
      notatek (osobne mikro-zapytanie do Haiku, szczegóły w `CLAUDE.md`)
- [x] Worker wdrożony na własnej domenie `api.narwhal.ink` (custom domain
      w `wrangler.toml`, bez adresu `*.workers.dev`)
- [x] `PROXY_URL` zależny od trybu: localhost w dev, produkcja w buildzie,
      z nadpisaniem przez `VITE_NARWHAL_PROXY_URL`
- [x] CSP w `tauri.conf.json` — `connect-src` tylko do Workera i IPC Tauri;
      osobne `devCsp` z `ws://localhost:1420` i `localhost:8787`
- [x] Ograniczniki nadużyć w Workerze: limit tempa 10/60 s na IP (429)
      i limity rozmiaru żądania (413), z komunikatami po stronie aplikacji
- [x] Bramka `Authorization: Bearer` na `/verify` (`NARWHAL_AUTH_TOKEN`); brak/zły
      token → 401, token nieustawiony → bramka wyłączona i `auth: "off"`
      w health-checku. Porównanie tokenów odporne na atak czasowy
- [x] `userId` z `authenticate()` w logu `usage` — jedno miejsce do podmiany,
      gdy dojdą prawdziwe konta użytkowników
- [x] Szew `getAuthToken()` w `app/src/lib/ai.ts` (`VITE_NARWHAL_TOKEN`),
      osobny komunikat na 401
- [x] CORS dla macOS — dodany origin `tauri://localhost` (webview spakowanej
      `.app`; Windows używa `tauri.localhost`) oraz `Authorization`
      w `allowHeaders`, bez którego preflight odrzucał żądanie z tokenem
- [x] Natywny sprawdzacz pisowni webview w edytorze (`spellcheck` w `editorProps`
      w `Editor.tsx`) — słowniki systemowe, zero bajtów w instalatorze i zero
      licencji; bez atrybutu `lang`, żeby system sam rozpoznawał język tekstu
- [x] Wersja macOS (`.app` + `.dmg`) buduje się lokalnie
- [x] Skille projektowe `.claude/skills/run` i `.claude/skills/verify`
