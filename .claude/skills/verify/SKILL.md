---
name: verify
description: Verify a change to Narwhal end-to-end — typecheck, unit tests, and driving the real fact-check pipeline (streaming NDJSON, issue categories, prompt cache, ignored issues). Use before committing any change to server/src/index.ts, app/src/lib/ai.ts, storage.ts, highlight.ts, the editor, or the verification panel.
---

# Weryfikacja zmian w Narwhalu

Kolejność: **statyka → testy → realne wywołanie**. Sam typecheck nic nie mówi
o tym, czy fact-check faktycznie działa — trzeba przepuścić tekst przez serwer.

## 1. Statyka i testy jednostkowe

```bash
cd server && npm run typecheck     # tsc --noEmit
cd ../app && npx tsc --noEmit      # obejmuje też pliki *.test.ts
npm test                           # vitest: storage.test.ts + highlight.test.ts
```

`npm test` pokrywa dwie rzeczy, których nie widać w UI: scenariusze utraty
treści w warstwie dyskowej i mapowanie cytatów na zakresy dokumentu
(`highlight.ts`). **Nie osłabiaj tych testów, żeby przeszły** — pilnują
regresji, które kosztują użytkownika tekst.

## 2. Realne wywołanie fact-checku

Serwer musi działać w trybie `live` (`curl -s http://localhost:8787`).
Pliki tymczasowe trzymaj w katalogu scratchpad sesji, nie w repo.

Fixture pokrywający **wszystkie trzy kategorie** naraz:

```json
{
  "text": "Marek wyszedł na spacer i zabrał swojego psa Bartka. Gdy zapadła noc, rzucił czar rozświetlający ścieżkę. Ona poszli do domu.",
  "notes": [
    { "title": "Postacie", "content": "Marek — kupiec z Eldorii. Ma kota o imieniu Bartek." },
    { "title": "Zasady świata", "content": "Magia w Eldorii działa wyłącznie za dnia." }
  ],
  "chapters": []
}
```

```bash
curl -sN -X POST http://localhost:8787/verify \
  -H "Content-Type: application/json" --data @fixture.json -m 180
```

`-N` (bez buforowania) jest istotne — odpowiedź to **strumień NDJSON**.

### Co musi wyjść

| Kategoria | Fragment | Dlaczego |
|---|---|---|
| `consistency` | „psa Bartka" | fakt przeczy notatkom (Bartek to kot) |
| `logic` | czar w nocy | zdarzenie łamie regułę świata |
| `grammar` | „Ona poszli" | niezgodność podmiotu z orzeczeniem |

**Podział kategorii przebiega wg natury błędu, nie źródła.** Niezgodność faktu
to `consistency`, choćby fakt pochodził z notatek; `logic` jest wtedy, gdy fakty
są poprawne, ale zdarzenia nie mogły tak wyglądać. Jeśli „psa Bartka" wychodzi
jako `logic`, prompt w `server/src/index.ts` się rozjechał.

### Kształt strumienia

```
{"type":"start","mock":false}
{"type":"issue","issue":{...}}     ← jedna linia na błąd, w trakcie pracy modelu
{"type":"done","usage":{...}}
```

Błędy muszą przychodzić **pojedynczo i rozłożone w czasie** (mierz znaczniki
czasu nadejścia linii). Jeśli wszystkie lecą razem z `done`, przyrostowy parser
(`makeIssueExtractor`) przestał działać i UI wróciło do czekania na całość.
Błąd merytoryczny przychodzi jako linia `{"type":"error"}`, nie jako HTTP 502.

## 3. Prompt cache

Dwa **identyczne** wywołania pod rząd; czytaj `usage` z odpowiedzi albo z logu serwera:

```
1: cacheWrite=N  cacheRead=0    ← zapis prefiksu
2: cacheWrite=0  cacheRead=N    ← odczyt (~10% ceny)
```

⚠️ **Minimalny cache'owalny prefiks na Sonnecie 5 to 1024 tokeny.** Mały fixture
(notatki + rozdziały poniżej progu) da `cacheWrite=0, cacheRead=0` w obu
wywołaniach — API po cichu ignoruje `cache_control`. **To nie regresja.** Żeby
przetestować cache, dopchnij kontekst wypełniaczem powyżej progu.

Test rozdzielnych breakpointów: zmień **tylko notatkę** i sprawdź, że trzecie
wywołanie ma mały `cacheWrite` (same notatki) przy dużym `cacheRead` (rozdziały
nadal z cache). Kolejność bloków w prefiksie ma być: system → rozdziały →
notatki → weryfikowany tekst, od najstabilniejszego do najzmienniejszego.

⚠️ **TTL nie może rosnąć w dół prefiksu** — blok z `ttl: "1h"` po bloku z
domyślnym 5m to HTTP 400 z API (kolejność: `tools` → `system` → `messages`).

## 4. W aplikacji (gdy zmiana dotyczy UI)

Uruchom aplikację (patrz skill `run`) i przejdź ścieżkę:

1. „Check text" na tekście z błędami → **kółko** kręci się przed pierwszym
   wynikiem, potem karty pojawiają się jedna po drugiej
2. fragmenty **podświetlone** w edytorze w kolorze kategorii; najechanie
   pokazuje tooltip z opisem i sugestią
3. dopisz coś w tekście → podświetlenia przesuwają się z tekstem,
   a licznik słów i `Saved`/`Saving…` działają jak wcześniej
   (dekoracje ProseMirror nie mogą brudzić dokumentu, undo ani autozapisu)
4. **Ignore** na karcie → błąd znika z panelu i z podświetleń, licznik
   „Ignored issues" rośnie, w folderze projektu pojawia się `ignored-issues.json`
5. ponowne „Check text" → zignorowany błąd **nie wraca**
6. **Restore** w podglądzie → po kolejnym sprawdzeniu błąd wraca
7. przełącz plik w trakcie sprawdzania → wyniki nie mogą wylądować w nowym pliku

## 5. Tryb atrapy

Bez klucza (`mode:mock`) `/verify` streamuje trzy przykładowe błędy co 350 ms.
Pozwala sprawdzić całe okablowanie UI (strumień, podświetlenia, ignorowanie)
bez kosztów API. Fragmenty atrapy nie występują w prawdziwym tekście, więc
podświetleń wtedy nie będzie — to normalne.

## Czego nie zepsuć

- Klucz API **wyłącznie** w `server/.dev.vars` — nigdy w aplikacji.
- Każdą zmianę w wywołaniu API (`server/src/index.ts`) konsultuj ze skillem
  `claude-api`, nie z pamięci — model, parametry i reguły cache się zmieniają.
- Zabezpieczenia przed utratą tekstu: osobna instancja edytora na plik (`key`),
  zapis przed przełączeniem pliku, dopchnięcie zapisu przy zamknięciu okna.
