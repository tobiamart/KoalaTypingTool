#!/usr/bin/env bash
#
# Publikacja „eleganckiej wersji" projektu do publicznego repozytorium
# tobiamart/narwhal.
#
# To repozytorium (KoalaTypingTool) jest wersją pełną: kod, notatki robocze,
# CLAUDE.md, TODO.md, skille, landing. Publiczne `narwhal` dostaje wyłącznie to,
# co jest potrzebne do skompilowania i uruchomienia programu — lista niżej
# w PATHS jest jedynym źródłem prawdy o tym, co wychodzi na zewnątrz.
#
# Publikacja jest ręczna i rzadka: robi się ją wtedy, gdy stan jest pewny,
# a nie przy każdym commicie tutaj. Skrypt nie kopiuje niezapisanych zmian —
# bierze stan z HEAD, więc publikujesz dokładnie to, co masz zacommitowane.
#
#   ./scripts/publish-narwhal.sh                  # podgląd zmian, bez pushu
#   ./scripts/publish-narwhal.sh "opis zmiany"    # commit + pytanie o push
#
# Na Windows uruchamiać w Git Bash — skrypt tylko kopiuje pliki i woła gita,
# więc nie dotyczy go problem z linkerem MSVC opisany w CLAUDE.md.

set -euo pipefail

PUBLIC_REPO="${NARWHAL_PUBLIC_REPO:-git@github.com:tobiamart/narwhal.git}"
WORKDIR="${NARWHAL_PUBLISH_DIR:-$HOME/.cache/narwhal-publish}"
BRANCH="main"

# ── Co trafia do publicznego repozytorium ────────────────────────────────────
# Dodanie ścieżki tutaj = zgoda na jej upublicznienie. Katalogi wchodzą
# w całości, z pominięciem tego, co i tak ignoruje git (node_modules, target,
# dist, .env.local, .dev.vars).
#
# Świadomie POZA listą:
#   server/              — kod proxy AI. Nie należy do „eleganckiej wersji"
#                          (samo repo KoalaTypingTool jest i tak publiczne).
#                          Skutkiem jest to, że sklonowana aplikacja buduje się
#                          i pisze, ale nie zweryfikuje tekstu — README to mówi
#                          wprost, żeby nikt nie szukał błędu u siebie.
#   CLAUDE.md, TODO.md   — notatki robocze, decyzje, koszty API, plany cenowe
#   .claude/             — skille Claude Code, nieużyteczne poza tym repo
#   web/                 — landing narwhal.ink, osobny byt od programu
#   scripts/             — w tym ten skrypt
#   *.bat, *.ps1         — pomocniki dwuklikowe pod Windows, nie są potrzebne
#                          do budowania (`npm run tauri build` wystarczy)
#
# Praca z drugiej maszyny idzie przez KoalaTypingTool, nie przez to repo —
# tu lądują tylko dopieszczone wersje.
PATHS=(
  app
  README.md
  .gitignore
)

# ── Sanity check ─────────────────────────────────────────────────────────────
cd "$(dirname "$0")/.."
git rev-parse --git-dir >/dev/null 2>&1 || { echo "Nie jestem w repozytorium git."; exit 1; }

# Ostrzeżenie, nie blokada: publikujemy HEAD, więc niezapisane zmiany po prostu
# nie wyjdą — łatwo to jednak przeoczyć i wysłać wersję sprzed poprawki.
if ! git diff --quiet HEAD -- "${PATHS[@]}"; then
  echo "UWAGA: masz niezacommitowane zmiany w publikowanych ścieżkach."
  echo "       Do narwhala pójdzie stan z HEAD, bez nich."
  echo
  git status --short -- "${PATHS[@]}"
  echo
  read -r -p "Kontynuować mimo to? [t/N] " reply
  [[ "$reply" =~ ^[tTyY]$ ]] || exit 1
fi

# ── Katalog roboczy z klonem publicznego repo ────────────────────────────────
if [ ! -d "$WORKDIR/.git" ]; then
  echo "Klonuję $PUBLIC_REPO do $WORKDIR ..."
  mkdir -p "$(dirname "$WORKDIR")"
  git clone "$PUBLIC_REPO" "$WORKDIR"
fi

git -C "$WORKDIR" fetch origin --quiet
# Świeżo założone repo nie ma jeszcze żadnego commita — wtedy tylko gałąź.
if git -C "$WORKDIR" rev-parse --verify --quiet "origin/$BRANCH" >/dev/null; then
  git -C "$WORKDIR" checkout -q -B "$BRANCH" "origin/$BRANCH"
  git -C "$WORKDIR" reset -q --hard "origin/$BRANCH"
else
  git -C "$WORKDIR" checkout -q -B "$BRANCH"
fi

# ── Synchronizacja treści ────────────────────────────────────────────────────
# Czyścimy katalog do gołego .git i rozpakowujemy stan z HEAD. Dzięki temu
# usunięcie pliku tutaj jest usunięciem także tam — kopiowanie „na wierzch"
# zostawiałoby po sobie pliki, których już nie ma.
find "$WORKDIR" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
git archive HEAD -- "${PATHS[@]}" | tar -x -C "$WORKDIR"

git -C "$WORKDIR" add -A

if git -C "$WORKDIR" diff --cached --quiet; then
  echo "Brak zmian — publiczne repo jest już aktualne."
  exit 0
fi

echo
echo "── Zmiany do opublikowania ──────────────────────────────────────────────"
git -C "$WORKDIR" diff --cached --stat
echo

# ── Commit i push ────────────────────────────────────────────────────────────
if [ $# -eq 0 ]; then
  echo "Podgląd bez commita. Uruchom ponownie z opisem zmiany, np.:"
  echo "  ./scripts/publish-narwhal.sh \"Add project search\""
  echo "Przygotowany stan czeka w: $WORKDIR"
  exit 0
fi

git -C "$WORKDIR" commit -q -m "$1"
echo "Commit gotowy w $WORKDIR"
read -r -p "Wypchnąć do $PUBLIC_REPO ($BRANCH)? [t/N] " reply
if [[ "$reply" =~ ^[tTyY]$ ]]; then
  git -C "$WORKDIR" push -u origin "$BRANCH"
  echo "Opublikowane."
else
  echo "Nie wypchnięto. Commit czeka w $WORKDIR — wyślij go później komendą:"
  echo "  git -C $WORKDIR push -u origin $BRANCH"
fi
