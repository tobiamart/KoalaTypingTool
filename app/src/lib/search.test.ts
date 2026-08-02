// Testy wyszukiwania po projekcie (lib/search.ts).

import { describe, it, expect } from "vitest";
import { fold, indexDoc, searchDocs, type SearchDoc } from "./search";

function doc(partial: Partial<SearchDoc> & { id: string; text: string }): SearchDoc {
  return {
    kind: "chapter",
    title: partial.title ?? "Chapter " + partial.id,
    file: partial.file ?? `chapters/${partial.id}.md`,
    ...partial,
  };
}

function search(docs: SearchDoc[], query: string) {
  return searchDocs(docs.map(indexDoc), query);
}

describe("fold", () => {
  it("zdejmuje wielkość liter i znaki diakrytyczne", () => {
    // „ß" zostaje — nie ma jednoznakowego odpowiednika, a długość musi się zgadzać.
    expect(fold("Żółw ŁÓDŹ Grüße")).toBe("zolw lodz gruße");
  });

  it("nie zmienia długości tekstu — pozycje muszą pasować do oryginału", () => {
    for (const sample of ["Żółw", "ŁÓDŹ", "Grüße", "İstanbul", "ﬁnał", "ąęćńóśźż"]) {
      expect(fold(sample)).toHaveLength(sample.length);
    }
  });
});

describe("searchDocs", () => {
  it("puste zapytanie nie zwraca nic", () => {
    expect(search([doc({ id: "1", text: "cokolwiek" })], "   ")).toEqual([]);
  });

  it("znajduje fragment treści i pokazuje kontekst wokół niego", () => {
    const hits = search([doc({ id: "1", text: "W lesie mieszkał stary żółw." })], "żółw");
    expect(hits).toHaveLength(1);
    expect(hits[0].index).toBe(23);
    expect(hits[0].match).toBe("żółw");
    expect(hits[0].before).toBe("W lesie mieszkał stary ");
    expect(hits[0].after).toBe(".");
  });

  it("ignoruje wielkość liter i ogonki", () => {
    const hits = search([doc({ id: "1", text: "Stary ŻÓŁW spał." })], "zolw");
    expect(hits[0].match).toBe("ŻÓŁW"); // wycinek zawsze w oryginalnej pisowni
  });

  it("trafienie w tytule ma index null i idzie przed trafieniami w treści", () => {
    const hits = search(
      [
        doc({ id: "1", title: "Wstęp", text: "Nie ma tu nic o żółwiach." }),
        doc({ id: "2", title: "Żółw", text: "Żółw wyszedł z wody." }),
      ],
      "żółw",
    );
    expect(hits[0]).toMatchObject({ id: "2", index: null });
    expect(hits[1]).toMatchObject({ id: "2", index: 0 });
    expect(hits[2]).toMatchObject({ id: "1" });
  });

  it("z jednego pliku bierze najwyżej trzy trafienia", () => {
    const hits = search([doc({ id: "1", text: "kot ".repeat(10) })], "kot");
    expect(hits).toHaveLength(3);
  });

  it("numeruje wystąpienia w obrębie pliku (edytor przewija do właściwego)", () => {
    const hits = search(
      [
        doc({ id: "1", text: "kot spał. Potem kot wstał." }),
        doc({ id: "2", text: "inny kot" }),
      ],
      "kot",
    );
    expect(hits.map((h) => [h.id, h.occurrence])).toEqual([
      ["1", 0],
      ["1", 1],
      ["2", 0],
    ]);
  });

  it("zachowuje kolejność dokumentów przekazaną przez wywołującego", () => {
    const hits = search(
      [
        doc({ id: "a", text: "słowo" }),
        doc({ id: "b", text: "słowo" }),
        { ...doc({ id: "c", text: "słowo" }), kind: "note" },
      ],
      "słowo",
    );
    expect(hits.map((h) => h.id)).toEqual(["a", "b", "c"]);
  });

  it("zwija białe znaki w zapytaniu i w podglądzie", () => {
    const hits = search([doc({ id: "1", text: "pierwsza linia\ndruga linia" })], "linia  druga");
    expect(hits).toHaveLength(0); // spacja w zapytaniu nie pasuje do nowej linii
    const ok = search([doc({ id: "1", text: "pierwsza linia\ndruga linia" })], "linia");
    expect(ok[0].after).not.toContain("\n");
  });

  it("skraca długi kontekst wielokropkiem", () => {
    const filler = "x".repeat(200);
    const hits = search([doc({ id: "1", text: filler + "igła" + filler })], "igła");
    expect(hits[0].before.startsWith("…")).toBe(true);
    expect(hits[0].after.endsWith("…")).toBe(true);
  });
});
