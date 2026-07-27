// Mapowanie fragmentów z fact-checku na zakresy pozycji w dokumencie edytora.
// Czysta logika (bez zależności od ProseMirror) — testowalna jednostkowo.
//
// Model zwraca "fragment" jako dokładny cytat z tekstu, ale dokument edytora
// jest podzielony na węzły tekstowe (bloki, formatowanie). Sklejamy segmenty
// w jeden ciąg z mapą offset → pozycja dokumentu i szukamy cytatu w całości.

/** Węzeł tekstowy dokumentu: treść + pozycja startowa w dokumencie. */
export interface TextSegment {
  text: string;
  /** Pozycja pierwszego znaku w dokumencie (ProseMirror pos). */
  pos: number;
}

/** Zakres dokumentu do podświetlenia. */
export interface Range {
  from: number;
  to: number;
}

/** Separator wstawiany między segmentami przy sklejaniu — blokuje fałszywe
 *  dopasowania fragmentu w poprzek granicy bloków (fragment to cytat z jednego
 *  akapitu, więc nie zawiera znaku nowej linii). */
const SEP = "\n";

/**
 * Znajduje wszystkie wystąpienia fragmentu w posegmentowanym tekście.
 * Zwraca zakresy pozycji dokumentu (może być wiele — fragment może się
 * powtarzać). Fragment musi mieścić się w jednym segmencie logicznym
 * (akapicie), ale może przecinać granice formatowania (bold/italic),
 * o ile segmenty sąsiadują bez przerwy (pos ciągłe).
 */
export function findFragmentRanges(segments: TextSegment[], fragment: string): Range[] {
  if (!fragment) return [];

  // Sklej sąsiadujące segmenty (pos ciągłe = to samo zdanie przecięte
  // formatowaniem); między nieciągłymi wstaw separator.
  let joined = "";
  // offsets[i] = pozycja dokumentu znaku joined[i] (lub -1 dla separatora).
  const offsets: number[] = [];

  let prevEnd = -1;
  for (const seg of segments) {
    if (prevEnd !== -1 && seg.pos !== prevEnd) {
      joined += SEP;
      offsets.push(-1);
    }
    for (let i = 0; i < seg.text.length; i++) {
      joined += seg.text[i];
      offsets.push(seg.pos + i);
    }
    prevEnd = seg.pos + seg.text.length;
  }

  const ranges: Range[] = [];
  let idx = joined.indexOf(fragment);
  while (idx !== -1) {
    const from = offsets[idx];
    const to = offsets[idx + fragment.length - 1] + 1;
    ranges.push({ from, to });
    idx = joined.indexOf(fragment, idx + 1);
  }
  return ranges;
}
