// Testy warstwy dyskowej (storage.ts) na atrapie systemu plików w pamięci.
// Pilnują przede wszystkim scenariuszy grożących utratą treści: kolizje nazw
// plików, zmiana nazwy na dysku, kolejność rozdziałów, round-trip manifestu.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Atrapa dysku: mapa ścieżka → treść + zbiór folderów.
const files = new Map<string, string>();
const dirs = new Set<string>();

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: async (p: string) => {
    if (!files.has(p)) throw new Error("not found: " + p);
    return files.get(p)!;
  },
  writeTextFile: async (p: string, c: string) => {
    files.set(p, c);
  },
  mkdir: async (p: string) => {
    dirs.add(p);
  },
  exists: async (p: string) => files.has(p) || dirs.has(p),
  remove: async (p: string) => {
    files.delete(p);
    dirs.delete(p);
  },
  rename: async (from: string, to: string) => {
    if (!files.has(from)) throw new Error("not found: " + from);
    files.set(to, files.get(from)!);
    files.delete(from);
  },
}));

vi.mock("@tauri-apps/api/path", () => ({
  join: async (...parts: string[]) => parts.join("/"),
}));

import * as storage from "./storage";

const PARENT = "C:/writing";

beforeEach(() => {
  files.clear();
  dirs.clear();
});

describe("slugify", () => {
  it("transliteruje polskie znaki", () => {
    expect(storage.slugify("Zażółć gęślą jaźń")).toBe("zazolc-gesla-jazn");
  });

  it("zamienia spacje i znaki specjalne na myślniki", () => {
    expect(storage.slugify("  Hello,  World! ")).toBe("hello-world");
    expect(storage.slugify("Chapter 1")).toBe("chapter-1");
  });

  it("zwraca 'untitled' dla pustego wyniku", () => {
    expect(storage.slugify("???")).toBe("untitled");
    expect(storage.slugify("")).toBe("untitled");
  });
});

describe("createProject / loadProject", () => {
  it("tworzy strukturę projektu z pierwszym rozdziałem", async () => {
    const p = await storage.createProject(PARENT, "My Book");
    expect(p.path).toBe(`${PARENT}/my-book`);
    expect(p.chapters).toHaveLength(1);
    expect(p.chapters[0].file).toBe("chapters/01-chapter-1.md");
    expect(files.has(`${PARENT}/my-book/chapters/01-chapter-1.md`)).toBe(true);
    expect(files.has(`${PARENT}/my-book/project.json`)).toBe(true);
  });

  it("round-trip: loadProject odczytuje to, co zapisał createProject", async () => {
    const created = await storage.createProject(PARENT, "My Book");
    const loaded = await storage.loadProject(created.path);
    expect(loaded.title).toBe("My Book");
    expect(loaded.chapters).toEqual(created.chapters);
    expect(loaded.notes).toEqual([]);
  });

  it("odmawia utworzenia projektu w istniejącym folderze", async () => {
    await storage.createProject(PARENT, "My Book");
    await expect(storage.createProject(PARENT, "My Book")).rejects.toThrow(
      /already exists/,
    );
  });

  it("loadProject odrzuca folder bez manifestu", async () => {
    await expect(storage.loadProject("C:/random")).rejects.toThrow(
      /not a Narwhal project/,
    );
  });
});

describe("addChapter", () => {
  it("numeruje kolejne rozdziały", async () => {
    let p = await storage.createProject(PARENT, "Book");
    const r1 = await storage.addChapter(p, "Intro");
    expect(r1.ref.file).toBe("chapters/02-intro.md");
    const r2 = await storage.addChapter(r1.project, "Middle");
    expect(r2.ref.file).toBe("chapters/03-middle.md");
  });

  it("NIE nadpisuje istniejącego pliku przy kolizji nazwy (ochrona treści)", async () => {
    let p = await storage.createProject(PARENT, "Book");
    // Rozdział "Intro" z treścią...
    const { project: p2, ref: intro } = await storage.addChapter(p, "Intro");
    await storage.writeFile(p2, intro, "PRECIOUS CONTENT");
    // ...usuwamy pierwszy rozdział, więc licznik (length+1) wskazałby zajęte "02".
    const p3 = await storage.deleteRef(p2, "chapter", p2.chapters[0].id);
    const { ref: intro2 } = await storage.addChapter(p3, "Intro");
    // Nowy plik musi dostać inną nazwę, a stara treść przetrwać.
    expect(intro2.file).not.toBe(intro.file);
    expect(files.get(`${p.path}/${intro.file}`)).toBe("PRECIOUS CONTENT");
  });
});

describe("addNote", () => {
  it("przy kolizji tytułów dokleja licznik", async () => {
    const p = await storage.createProject(PARENT, "Book");
    const { project: p2, ref: n1 } = await storage.addNote(p, "World");
    const { ref: n2 } = await storage.addNote(p2, "World");
    expect(n1.file).toBe("notes/world.md");
    expect(n2.file).toBe("notes/world-2.md");
  });
});

describe("renameRef", () => {
  it("zmienia tytuł i nazwę pliku na dysku, zachowując numer rozdziału", async () => {
    const p = await storage.createProject(PARENT, "Book");
    const ref = p.chapters[0];
    await storage.writeFile(p, ref, "chapter body");
    const updated = await storage.renameRef(p, "chapter", ref.id, "Opening");
    expect(updated.chapters[0].title).toBe("Opening");
    expect(updated.chapters[0].file).toBe("chapters/01-opening.md");
    expect(files.has(`${p.path}/chapters/01-chapter-1.md`)).toBe(false);
    expect(files.get(`${p.path}/chapters/01-opening.md`)).toBe("chapter body");
  });

  it("nie rusza pliku, gdy slug się nie zmienia", async () => {
    const p = await storage.createProject(PARENT, "Book");
    const ref = p.chapters[0];
    const updated = await storage.renameRef(p, "chapter", ref.id, "CHAPTER 1");
    expect(updated.chapters[0].title).toBe("CHAPTER 1");
    expect(updated.chapters[0].file).toBe("chapters/01-chapter-1.md");
  });

  it("przy kolizji nazw plików dokleja licznik zamiast nadpisać", async () => {
    const p = await storage.createProject(PARENT, "Book");
    const { project: p2, ref: intro } = await storage.addChapter(p, "Intro");
    await storage.writeFile(p2, intro, "intro body");
    // Zmieniamy nazwę rozdziału 1 tak, by celowała w zajęty slug "intro"
    // (inny numer, więc kolizji nie ma — ale sprawdźmy notatki, gdzie prefiksu brak).
    const { project: p3, ref: nA } = await storage.addNote(p2, "Alpha");
    const { project: p4, ref: nB } = await storage.addNote(p3, "Beta");
    await storage.writeFile(p4, nA, "alpha body");
    await storage.writeFile(p4, nB, "beta body");
    const updated = await storage.renameRef(p4, "note", nB.id, "Alpha");
    const renamed = updated.notes.find((n) => n.id === nB.id)!;
    expect(renamed.file).toBe("notes/alpha-2.md");
    expect(files.get(`${p.path}/notes/alpha.md`)).toBe("alpha body");
    expect(files.get(`${p.path}/notes/alpha-2.md`)).toBe("beta body");
  });
});

describe("reorderRefs", () => {
  /** Projekt z rozdziałami "1".."n" — ułatwia czytanie oczekiwanej kolejności. */
  async function withChapters(n: number) {
    let p = await storage.createProject(PARENT, "Book");
    for (let i = 2; i <= n; i++) p = (await storage.addChapter(p, `Ch ${i}`)).project;
    return p;
  }

  it("przesuwa rozdział w górę i utrwala kolejność w manifeście", async () => {
    const p = await withChapters(2);
    const [a, b] = p.chapters;
    const moved = storage.reorderRefs(p, "chapter", b.id, 0);
    expect(moved.chapters.map((c) => c.id)).toEqual([b.id, a.id]);
    // Kolejność musi przetrwać zapis i odczyt manifestu (zapis robi wywołujący).
    await storage.saveManifest(moved);
    const reloaded = await storage.loadProject(p.path);
    expect(reloaded.chapters.map((c) => c.id)).toEqual([b.id, a.id]);
  });

  it("przenosi element z początku na koniec (przeciągnięcie w dół)", async () => {
    const p = await withChapters(4);
    const ids = p.chapters.map((c) => c.id);
    const moved = storage.reorderRefs(p, "chapter", ids[0], 3);
    expect(moved.chapters.map((c) => c.id)).toEqual([ids[1], ids[2], ids[3], ids[0]]);
  });

  it("przenosi element z końca w środek (przeciągnięcie w górę)", async () => {
    const p = await withChapters(4);
    const ids = p.chapters.map((c) => c.id);
    const moved = storage.reorderRefs(p, "chapter", ids[3], 1);
    expect(moved.chapters.map((c) => c.id)).toEqual([ids[0], ids[3], ids[1], ids[2]]);
  });

  it("nie gubi ani nie duplikuje wpisów przy żadnym ruchu", async () => {
    const p = await withChapters(5);
    const ids = p.chapters.map((c) => c.id);
    for (let to = 0; to < 5; to++) {
      const moved = storage.reorderRefs(p, "chapter", ids[2], to);
      const got = moved.chapters.map((c) => c.id);
      expect(got).toHaveLength(5);
      expect(new Set(got)).toEqual(new Set(ids));
      expect(got[to]).toBe(ids[2]);
    }
  });

  it("przycina indeks poza zakresem i nie rusza listy bez potrzeby", async () => {
    const p = await withChapters(2);
    const ids = p.chapters.map((c) => c.id);
    // Indeks większy niż lista → koniec listy.
    const past = storage.reorderRefs(p, "chapter", ids[0], 99);
    expect(past.chapters.map((c) => c.id)).toEqual([ids[1], ids[0]]);
    // Ujemny → początek.
    const before = storage.reorderRefs(p, "chapter", ids[1], -5);
    expect(before.chapters.map((c) => c.id)).toEqual([ids[1], ids[0]]);
    // Ruch w to samo miejsce zwraca ten sam obiekt — to sygnał dla store,
    // że nie ma czego zapisywać.
    expect(storage.reorderRefs(p, "chapter", ids[0], 0)).toBe(p);
  });

  it("działa tak samo dla notatek", async () => {
    let p = await storage.createProject(PARENT, "Book");
    p = (await storage.addNote(p, "Alpha")).project;
    p = (await storage.addNote(p, "Beta")).project;
    const ids = p.notes.map((n) => n.id);
    const moved = storage.reorderRefs(p, "note", ids[1], 0);
    expect(moved.notes.map((n) => n.id)).toEqual([ids[1], ids[0]]);
    expect(moved.chapters).toEqual(p.chapters);
  });
});

describe("deleteRef", () => {
  it("usuwa plik z dysku i wpis z manifestu", async () => {
    const p = await storage.createProject(PARENT, "Book");
    const ref = p.chapters[0];
    const updated = await storage.deleteRef(p, "chapter", ref.id);
    expect(updated.chapters).toHaveLength(0);
    expect(files.has(`${p.path}/${ref.file}`)).toBe(false);
  });
});

describe("ignored issues", () => {
  it("brak pliku = pusta lista", async () => {
    const p = await storage.createProject(PARENT, "Book");
    expect(await storage.loadIgnoredIssues(p)).toEqual([]);
  });

  it("dodaje wpis i zapisuje plik ignored-issues.json", async () => {
    const p = await storage.createProject(PARENT, "Book");
    const entry = { file: "chapters/01-chapter-1.md", type: "grammar", fragment: "Ona poszli" };
    const list = await storage.addIgnoredIssue(p, entry);
    expect(list).toEqual([entry]);
    expect(await storage.loadIgnoredIssues(p)).toEqual([entry]);
    expect(files.has(`${p.path}/ignored-issues.json`)).toBe(true);
  });

  it("nie duplikuje identycznych wpisów", async () => {
    const p = await storage.createProject(PARENT, "Book");
    const entry = { file: "chapters/01-chapter-1.md", type: "logic", fragment: "słońce na zachodzie" };
    await storage.addIgnoredIssue(p, entry);
    const list = await storage.addIgnoredIssue(p, entry);
    expect(list).toHaveLength(1);
  });

  it("rozróżnia wpisy po pliku, typie i cytacie", async () => {
    const p = await storage.createProject(PARENT, "Book");
    await storage.addIgnoredIssue(p, { file: "a.md", type: "grammar", fragment: "x" });
    const list = await storage.addIgnoredIssue(p, { file: "b.md", type: "grammar", fragment: "x" });
    expect(list).toHaveLength(2);
  });

  it("uszkodzony plik traktuje jak pustą listę", async () => {
    const p = await storage.createProject(PARENT, "Book");
    files.set(`${p.path}/ignored-issues.json`, "not json{");
    expect(await storage.loadIgnoredIssues(p)).toEqual([]);
  });

  it("removeIgnoredIssue przywraca błąd (usuwa wpis, resztę zostawia)", async () => {
    const p = await storage.createProject(PARENT, "Book");
    const a = { file: "a.md", type: "grammar", fragment: "x" };
    const b = { file: "a.md", type: "logic", fragment: "y" };
    await storage.addIgnoredIssue(p, a);
    await storage.addIgnoredIssue(p, b);
    const list = await storage.removeIgnoredIssue(p, a);
    expect(list).toEqual([b]);
    expect(await storage.loadIgnoredIssues(p)).toEqual([b]);
  });
});
