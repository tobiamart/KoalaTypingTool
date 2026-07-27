// Testy mapowania fragmentów fact-checku na zakresy dokumentu.

import { describe, it, expect } from "vitest";
import { findFragmentRanges, type TextSegment } from "./highlight";

describe("findFragmentRanges", () => {
  it("znajduje fragment w pojedynczym segmencie", () => {
    const segs: TextSegment[] = [{ text: "Ala ma kota i psa.", pos: 1 }];
    expect(findFragmentRanges(segs, "ma kota")).toEqual([{ from: 5, to: 12 }]);
  });

  it("zwraca pustą listę, gdy fragmentu nie ma", () => {
    const segs: TextSegment[] = [{ text: "Ala ma kota.", pos: 1 }];
    expect(findFragmentRanges(segs, "nie istnieje")).toEqual([]);
  });

  it("znajduje wszystkie wystąpienia", () => {
    const segs: TextSegment[] = [{ text: "kot i kot", pos: 0 }];
    expect(findFragmentRanges(segs, "kot")).toEqual([
      { from: 0, to: 3 },
      { from: 6, to: 9 },
    ]);
  });

  it("skleja sąsiadujące segmenty (fragment przecina formatowanie)", () => {
    // "Ala ma **kota** w domu" → trzy węzły tekstowe o ciągłych pozycjach.
    const segs: TextSegment[] = [
      { text: "Ala ma ", pos: 1 },
      { text: "kota", pos: 8 },
      { text: " w domu", pos: 12 },
    ];
    expect(findFragmentRanges(segs, "ma kota w")).toEqual([{ from: 5, to: 14 }]);
  });

  it("nie dopasowuje w poprzek granicy bloków (pozycje nieciągłe)", () => {
    // Dwa akapity: "…kot" | "pies…" — fragment "kot pies" nie może się dopasować.
    const segs: TextSegment[] = [
      { text: "W domu był kot", pos: 1 },
      { text: "pies szczekał", pos: 20 },
    ];
    expect(findFragmentRanges(segs, "kot pies")).toEqual([]);
  });

  it("uwzględnia przesunięcie pozycji między blokami", () => {
    const segs: TextSegment[] = [
      { text: "Pierwszy akapit.", pos: 1 },
      { text: "Drugi akapit z błędem.", pos: 19 },
    ];
    // "z błędem" zaczyna się na offsecie 13 segmentu: 19 + 13 = 32.
    expect(findFragmentRanges(segs, "z błędem")).toEqual([{ from: 32, to: 40 }]);
  });

  it("pusty fragment nie podświetla niczego", () => {
    const segs: TextSegment[] = [{ text: "Tekst.", pos: 1 }];
    expect(findFragmentRanges(segs, "")).toEqual([]);
  });
});
