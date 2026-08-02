// Wyszukiwanie pełnotekstowe po projekcie: tytuły oraz treść rozdziałów i notatek.
// Czysta logika (zero I/O i zero React) — testowana jednostkowo w search.test.ts.
// Wczytanie plików z dysku należy do wywołującego (components/SearchPalette.tsx).

import type { ActiveKind } from "../types";

/** Pojedynczy plik projektu podany do zaindeksowania. */
export interface SearchDoc {
  kind: ActiveKind;
  id: string;
  title: string;
  /** Ścieżka względna, np. "chapters/01-poczatek.md" — pokazywana pod wynikiem. */
  file: string;
  /** Treść pliku (Markdown). */
  text: string;
}

/** Dokument z policzoną wcześniej postacią porównawczą (patrz `fold`). */
export interface IndexedDoc extends SearchDoc {
  foldedTitle: string;
  foldedText: string;
}

/** Jedno trafienie: albo w tytule pliku, albo w konkretnym miejscu treści. */
export interface SearchHit {
  kind: ActiveKind;
  id: string;
  title: string;
  file: string;
  /** Pozycja trafienia w treści; null = trafienie w samym tytule. */
  index: number | null;
  /** Które z kolei to wystąpienie w tym pliku (0-based). Po tym edytor pozna,
   *  do którego „żółwia" przewinąć, gdy plik zawiera ich kilka. */
  occurrence: number;
  /** Tekst przed trafieniem (z „…", gdy urwany). */
  before: string;
  /** Dokładny wycinek treści, który pasował — w oryginalnej pisowni. */
  match: string;
  /** Tekst po trafieniu (z „…", gdy urwany). */
  after: string;
}

/** Znaki, których NFD nie rozkłada na literę bazową + znak diakrytyczny. */
const MANUAL_FOLD: Record<string, string> = {
  ł: "l",
  ø: "o",
  đ: "d",
  ð: "d",
  ı: "i",
};

/**
 * Sprowadza znak do postaci porównawczej: małe litery bez znaków diakrytycznych.
 *
 * **Wynik ma zawsze długość 1**, i to jest tu najważniejsze: pozycje w tekście
 * złożonym (`fold`) muszą pokrywać się z pozycjami w oryginale, bo wycinek
 * do pokazania i do podświetlenia bierzemy z oryginału. Dlatego znaki, których
 * zmiana wielkości daje więcej niż jeden znak (np. „ﬁ", „İ"), zostają bez zmian.
 */
function foldChar(ch: string): string {
  const lower = ch.toLowerCase();
  if (lower.length !== 1) return ch;
  const base = lower.normalize("NFD")[0];
  return MANUAL_FOLD[base] ?? base;
}

/**
 * Postać porównawcza całego tekstu — bez wielkości liter i bez ogonków, znak
 * w znak. Dzięki temu „Zolw" znajduje „Żółw", a „ZOLW" i „żółw" to to samo.
 */
export function fold(text: string): string {
  let out = "";
  for (const ch of text) out += foldChar(ch);
  return out;
}

/** Dokłada do dokumentu postać porównawczą. Liczone raz na otwarcie wyszukiwarki,
 *  nie przy każdym naciśnięciu klawisza — cała książka to setki tysięcy znaków. */
export function indexDoc(doc: SearchDoc): IndexedDoc {
  return { ...doc, foldedTitle: fold(doc.title), foldedText: fold(doc.text) };
}

/** Ile znaków kontekstu pokazujemy wokół trafienia w podglądzie wyniku. */
const CONTEXT_BEFORE = 42;
const CONTEXT_AFTER = 90;
/** Ile trafień z jednego pliku trafia na listę — reszta zaśmiecałaby wyniki. */
const MAX_PER_DOC = 3;
/** Górny limit całej listy (ochrona przed zapytaniem w rodzaju „a"). */
const MAX_HITS = 60;

/** Buduje podgląd trafienia: wycinek treści z kontekstem po obu stronach.
 *  Nowe linie zamieniamy na spacje, żeby wynik był jedną linijką. */
function buildSnippet(text: string, index: number, length: number) {
  const start = Math.max(0, index - CONTEXT_BEFORE);
  const end = Math.min(text.length, index + length + CONTEXT_AFTER);
  const clean = (s: string) => s.replace(/\s+/g, " ");
  return {
    before: (start > 0 ? "…" : "") + clean(text.slice(start, index)),
    match: clean(text.slice(index, index + length)),
    after: clean(text.slice(index + length, end)) + (end < text.length ? "…" : ""),
  };
}

/**
 * Szuka zapytania w zaindeksowanych plikach.
 *
 * Kolejność wyników: najpierw pliki, których **tytuł** pasuje (trafienie
 * tytułowe jako pierwsze), potem pozostałe — a w obrębie listy zachowana jest
 * kolejność dokumentów przekazana przez wywołującego (czyli kolejność
 * z manifestu: rozdziały, potem notatki). Trafienia w treści idą w kolejności
 * występowania w pliku.
 */
export function searchDocs(docs: IndexedDoc[], query: string): SearchHit[] {
  // Zapytanie zwężamy do jednej linii — wklejony fragment z twardym enterem
  // nigdy nie pasowałby do niczego.
  const needle = fold(query.replace(/\s+/g, " ").trim());
  if (!needle) return [];

  const titleHits: SearchHit[] = [];
  const bodyHits: SearchHit[] = [];

  for (const doc of docs) {
    const inTitle = doc.foldedTitle.includes(needle);
    const own: SearchHit[] = [];

    if (inTitle) {
      own.push({
        kind: doc.kind,
        id: doc.id,
        title: doc.title,
        file: doc.file,
        index: null,
        occurrence: 0,
        before: "",
        match: "",
        after: "",
      });
    }

    let from = 0;
    let found = 0;
    while (found < MAX_PER_DOC) {
      const at = doc.foldedText.indexOf(needle, from);
      if (at === -1) break;
      own.push({
        kind: doc.kind,
        id: doc.id,
        title: doc.title,
        file: doc.file,
        index: at,
        occurrence: found,
        ...buildSnippet(doc.text, at, needle.length),
      });
      from = at + needle.length;
      found++;
    }

    if (inTitle) titleHits.push(...own);
    else bodyHits.push(...own);
  }

  return [...titleHits, ...bodyHits].slice(0, MAX_HITS);
}
