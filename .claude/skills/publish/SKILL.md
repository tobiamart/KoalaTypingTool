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

Przy zmianach w `server/src/index.ts` — pełna ścieżka ze skilla `verify`,
nie tylko typecheck.

## Co wychodzi na zewnątrz

Jedynym źródłem prawdy jest tablica `PATHS` w `scripts/publish-narwhal.sh`.
Dziś: `app/`, `server/`, `README.md`, `.gitignore`.

**Dopisanie ścieżki do `PATHS` jest decyzją o upublicznieniu — nie rób tego
bez zgody właściciela.** Świadomie poza listą:

- `CLAUDE.md`, `TODO.md` — notatki robocze, decyzje, koszty API, plany cenowe
- `.claude/` — skille, bezużyteczne poza repozytorium roboczym
- `web/` — landing `narwhal.ink`, osobny byt od programu
- `scripts/`, `*.bat`, `*.ps1` — pomocniki, do budowania niepotrzebne

`server/` jest na liście celowo: produkcyjne `api.narwhal.ink` stoi za bramką
tokenową, więc bez kodu proxy nikt (łącznie z Tobą na nowej maszynie) nie
uruchomi weryfikacji na własnym kluczu.

## Pułapki

- **Publikowany jest `HEAD`, nie stan roboczy.** Niezacommitowane zmiany nie
  wyjdą. Skrypt ostrzega i pyta, ale łatwo to przeklikać i wysłać wersję sprzed
  poprawki.
- **Usunięcie pliku tutaj usuwa go też tam.** Katalog roboczy jest czyszczony do
  gołego `.git` przed każdą synchronizacją — to celowe, bo kopiowanie „na
  wierzch" zostawiałoby pliki, których już nie ma.
- **Historia publiczna jest własna i płaska.** Jeden commit publikacyjny obejmuje
  wszystko, co się zmieniło od poprzedniej publikacji. Nie próbuj przenosić tam
  historii z KoalaTypingTool — to właśnie ona ma zostać prywatna.
- **Cokolwiek raz opublikujesz, zostaje w historii publicznego repo.** Usunięcie
  pliku kolejnym commitem nie usuwa go z wcześniejszych. Dlatego podgląd przed
  pushem, a nie po.
- **Sekrety**: `.env.local` i `.dev.vars` są gitignorowane, więc nie mają jak
  wyjść — ale przy dodawaniu nowej ścieżki do `PATHS` sprawdź to jeszcze raz:
  `git -C ~/.cache/narwhal-publish ls-files | grep -iE 'env|vars|secret|token'`
- Na Windows uruchamiaj w **Git Bash** — skrypt tylko kopiuje pliki i woła gita,
  więc nie dotyczy go problem z linkerem MSVC z `CLAUDE.md`.
