---
name: publish
description: Publish the clean, compile-only version of Narwhal to the public tobiamart/narwhal repository. Use when asked to publish, release, push to the public repo, or sync the public mirror. Covers what is allowed out, the pre-flight checks, and how to change the published file list.
---

# Publikacja do publicznego repozytorium

Projekt żyje w **dwóch repozytoriach** i to jest celowe.

| Repo | Rola | Zawartość |
|---|---|---|
| `tobiamart/KoalaTypingTool` | wersja robocza, codzienna | wszystko: kod, `CLAUDE.md`, `TODO.md`, `.claude/`, `web/`, skrypty |
| `tobiamart/narwhal` | wersja publiczna, „elegancka" | tylko to, co potrzebne, żeby program się skompilował i działał |

Publikacja jest **ręczna i rzadka**. Nie robi się jej przy każdym commicie tutaj,
tylko wtedy, gdy stan jest pewny — publiczna historia ma być czytelna, a nie być
zapisem eksperymentów.

## Jak opublikować

```bash
./scripts/publish-narwhal.sh                    # podgląd: co by poszło, bez commita
./scripts/publish-narwhal.sh "Add project search"   # commit + pytanie o push
```

Zawsze zaczynaj od podglądu. Skrypt wypisze `git diff --stat` względem
publicznego repo, więc widać dokładnie, co się zmieni, zanim cokolwiek wyjdzie.

Pierwsze uruchomienie klonuje `narwhal` do `~/.cache/narwhal-publish`
(nadpisywalne przez `NARWHAL_PUBLISH_DIR`). Katalog roboczy jest zawsze
resetowany do `origin/main`, więc jego stan nigdy nie jest źródłem prawdy —
można go skasować bez straty.

## Zanim opublikujesz

Publiczne repo obiecuje „sklonuj i skompiluj", więc sprawdź, że to prawda:

```bash
cd app && npx tsc --noEmit && npm test && npx vite build
```

Skoro publikowana jest sama aplikacja, sprawdzaj ją tak, jak zobaczy ją ktoś
z zewnątrz: build musi przejść bez `server/` w zasięgu i bez `.env.local`.

## Co wychodzi na zewnątrz

Jedynym źródłem prawdy jest tablica `PATHS` w `scripts/publish-narwhal.sh`.
Dziś: `app/`, `README.md`, `.gitignore` — czyli sama aplikacja desktopowa.

KoalaTypingTool też jest publiczny (od 2026-10-30), więc lista nie decyduje
już o tym, co jest jawne, tylko o tym, co należy do „eleganckiej wersji".
**Zmiany w `PATHS` i tak uzgadniaj z właścicielem.** Świadomie poza listą:

- `server/` — proxy AI; sklonowana aplikacja ma się budować bez niego,
  a backend i tak stoi za bramką tokenową
- `CLAUDE.md`, `TODO.md` — notatki robocze, decyzje, koszty API, plany cenowe
- `.claude/` — skille, bezużyteczne poza repozytorium roboczym
- `web/` — landing `narwhal.ink`, osobny byt od programu
- `scripts/`, `*.bat`, `*.ps1` — pomocniki, do budowania niepotrzebne

Konsekwencja braku `server/`: aplikacja zbudowana z publicznego źródła pisze
i szuka, ale „Check text" dostaje odmowę, bo `api.narwhal.ink` stoi za bramką
tokenową. **README musi to mówić wprost** — inaczej ktoś będzie szukał błędu
u siebie. Przy zmianach w opisie backendu sprawdź, czy README dalej jest zgodny
z prawdą.

Praca z drugiej maszyny idzie przez KoalaTypingTool, nie przez publiczne repo.

## Pułapki

- **Publikowany jest `HEAD`, nie stan roboczy.** Niezacommitowane zmiany nie
  wyjdą. Skrypt ostrzega i pyta, ale łatwo to przeklikać i wysłać wersję sprzed
  poprawki.
- **Usunięcie pliku tutaj usuwa go też tam.** Katalog roboczy jest czyszczony do
  gołego `.git` przed każdą synchronizacją — to celowe, bo kopiowanie „na
  wierzch" zostawiałoby pliki, których już nie ma.
- **Historia publiczna jest własna i płaska.** Jeden commit publikacyjny obejmuje
  wszystko, co się zmieniło od poprzedniej publikacji. Nie próbuj przenosić tam
  historii z KoalaTypingTool — „elegancka wersja" ma mieć własną, czystą historię.
- **Cokolwiek raz opublikujesz, zostaje w historii publicznego repo.** Usunięcie
  pliku kolejnym commitem nie usuwa go z wcześniejszych. Dlatego podgląd przed
  pushem, a nie po.
- **Sekrety**: `.env.local` i `.dev.vars` są gitignorowane, więc nie mają jak
  wyjść — ale przy dodawaniu nowej ścieżki do `PATHS` sprawdź to jeszcze raz:
  `git -C ~/.cache/narwhal-publish ls-files | grep -iE 'env|vars|secret|token'`
- Na Windows uruchamiaj w **Git Bash** — skrypt tylko kopiuje pliki i woła gita,
  więc nie dotyczy go problem z linkerem MSVC z `CLAUDE.md`.
