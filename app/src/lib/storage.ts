// Warstwa dostępu do dysku: tworzenie i wczytywanie projektów oraz plików treści.
// Korzysta z oficjalnego pluginu @tauri-apps/plugin-fs (żadnych własnych komend Rust).

import {
  readTextFile,
  writeTextFile,
  mkdir,
  exists,
  remove,
  rename,
} from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import type { FileRef, OpenProject, ProjectManifest } from "../types";

const MANIFEST_NAME = "project.json";

/** Zamienia tytuł na bezpieczną nazwę pliku (slug): małe litery, myślniki, bez znaków specjalnych.
 *  Znaki diakrytyczne (w tym polskie) są transliterowane, więc tytuły spoza ASCII też działają. */
export function slugify(input: string): string {
  const map: Record<string, string> = {
    ą: "a", ć: "c", ę: "e", ł: "l", ń: "n",
    ó: "o", ś: "s", ź: "z", ż: "z",
  };
  const base = input
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (ch) => map[ch] ?? ch)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "untitled";
}

/**
 * Czy ścieżka względna z manifestu wskazuje plik **wewnątrz** folderu projektu?
 *
 * `project.json` jest wejściem niezaufanym: leży na dysku obok treści, więc
 * przychodzi razem z każdym folderem projektu, który użytkownik dostał od kogoś
 * innego. Bez tego sprawdzenia wpis `"file": "../../.zshrc"` daje odczyt
 * i **nadpisanie** dowolnego pliku w katalogu domowym — natywny `join()`
 * skraca „..” leksykalnie (Component::ParentDir → pop), a scope pluginu fs
 * (`$HOME/**` w capabilities) taką ścieżkę przepuszcza.
 *
 * Odrzucamy trzy rzeczy:
 *  - segment `..` — jedyny sposób na wyjście w górę,
 *  - odwrotny ukośnik — na Windows jest **separatorem**, więc `chapters\..\..\x`
 *    ucieka mimo rozbijania po „/”,
 *  - wiodący ukośnik — ścieżka absolutna zamiast względnej.
 *
 * Świadomie **nie** wymuszamy prefiksu `chapters/` ani `notes/`: projekty
 * z najstarszej wersji trzymały treść w pliku w korzeniu i mają się dalej
 * otwierać.
 */
export function isSafeRelPath(relative: string): boolean {
  if (!relative || relative.includes("\\")) return false;
  if (relative.startsWith("/")) return false;
  return relative.split("/").every((s) => s !== "..");
}

/** Buduje absolutną ścieżkę pliku wewnątrz projektu z jego ścieżki względnej. */
async function absPath(project: OpenProject, relative: string): Promise<string> {
  if (!isSafeRelPath(relative)) {
    throw new Error(`Invalid file path in project manifest: ${relative}`);
  }
  // Ścieżki względne trzymamy z "/" — rozbijamy i łączymy przez natywny join.
  const segments = relative.split("/").filter(Boolean);
  return join(project.path, ...segments);
}

/** Wczytuje treść pliku wskazanego referencją. */
export async function readFile(project: OpenProject, ref: FileRef): Promise<string> {
  const path = await absPath(project, ref.file);
  if (!(await exists(path))) return "";
  return readTextFile(path);
}

/** Zapisuje treść pliku wskazanego referencją. */
export async function writeFile(
  project: OpenProject,
  ref: FileRef,
  content: string,
): Promise<void> {
  const path = await absPath(project, ref.file);
  await writeTextFile(path, content);
}

/** Zapisuje manifest project.json na dysku. */
export async function saveManifest(project: OpenProject): Promise<void> {
  const manifest: ProjectManifest = {
    title: project.title,
    createdAt: project.createdAt,
    chapters: project.chapters,
    notes: project.notes,
  };
  const path = await join(project.path, MANIFEST_NAME);
  await writeTextFile(path, JSON.stringify(manifest, null, 2));
}

/** Czy pod tą ścieżką nadal leży projekt Narwhala? Używane do sprzątania listy
 *  ostatnich projektów: folder mógł zostać przeniesiony albo usunięty. */
export async function isProjectFolder(folderPath: string): Promise<boolean> {
  try {
    return await exists(await join(folderPath, MANIFEST_NAME));
  } catch {
    // Brak uprawnień albo odmontowany dysk — nie twierdzimy, że projekt zniknął.
    return true;
  }
}

/**
 * Przepuszcza tylko te wpisy manifestu, które da się bezpiecznie otworzyć.
 *
 * Odsiewamy zamiast odmawiać otwarcia całego projektu: uszkodzony albo
 * spreparowany wpis nie może odciąć autora od pozostałych rozdziałów. Wpis
 * z ucieczką ze ścieżki nie powstaje w aplikacji nigdy, więc jego zniknięcie
 * nie jest utratą treści użytkownika.
 */
function safeRefs(list: unknown): FileRef[] {
  if (!Array.isArray(list)) return [];
  return list.filter(
    (r): r is FileRef =>
      !!r && typeof r.file === "string" && isSafeRelPath(r.file),
  );
}

/** Wczytuje istniejący projekt z folderu. */
export async function loadProject(folderPath: string): Promise<OpenProject> {
  const manifestPath = await join(folderPath, MANIFEST_NAME);
  if (!(await exists(manifestPath))) {
    throw new Error("This is not a Narwhal project folder (missing project.json).");
  }
  const raw = await readTextFile(manifestPath);
  const manifest = JSON.parse(raw) as ProjectManifest;
  // Manifest pochodzi z dysku, więc kształt jest sprawdzany, nie zakładany.
  return {
    ...manifest,
    chapters: safeRefs(manifest.chapters),
    notes: safeRefs(manifest.notes),
    path: folderPath,
  };
}

/**
 * Tworzy nowy projekt w podanym folderze nadrzędnym.
 * Powstaje podfolder o nazwie zeslugowanego tytułu, a w nim struktura plików.
 */
export async function createProject(
  parentDir: string,
  title: string,
): Promise<OpenProject> {
  const folderName = slugify(title);
  const projectPath = await join(parentDir, folderName);

  if (await exists(projectPath)) {
    throw new Error(`A folder "${folderName}" already exists in this location.`);
  }

  await mkdir(projectPath, { recursive: true });
  await mkdir(await join(projectPath, "notes"), { recursive: true });
  await mkdir(await join(projectPath, "chapters"), { recursive: true });

  const firstChapter: FileRef = {
    id: crypto.randomUUID(),
    title: "Chapter 1",
    file: "chapters/01-chapter-1.md",
  };
  await writeTextFile(
    await join(projectPath, ...firstChapter.file.split("/")),
    "",
  );

  const project: OpenProject = {
    title,
    createdAt: new Date().toISOString(),
    chapters: [firstChapter],
    notes: [],
    path: projectPath,
  };

  await saveManifest(project);
  return project;
}

/** Dobiera wolną nazwę pliku — dokleja numer, dopóki trafia na istniejący plik.
 *  Chroni przed nadpisaniem treści, gdy rozdziały/notatki mają ten sam tytuł. */
async function freeFileName(
  project: OpenProject,
  build: (n: number) => string,
  startAt: number,
): Promise<string> {
  for (let n = startAt; ; n++) {
    const candidate = build(n);
    if (!(await exists(await absPath(project, candidate)))) return candidate;
  }
}

/** Dodaje nowy rozdział. Zwraca zaktualizowany projekt. */
export async function addChapter(
  project: OpenProject,
  title: string,
): Promise<{ project: OpenProject; ref: FileRef }> {
  // Projekty założone w starszej wersji mogły nie mieć folderu chapters/.
  await mkdir(await join(project.path, "chapters"), { recursive: true });

  const slug = slugify(title);
  const file = await freeFileName(
    project,
    (n) => `chapters/${String(n).padStart(2, "0")}-${slug}.md`,
    project.chapters.length + 1,
  );
  const ref: FileRef = { id: crypto.randomUUID(), title, file };
  await writeTextFile(await absPath(project, ref.file), "");
  const updated: OpenProject = {
    ...project,
    chapters: [...project.chapters, ref],
  };
  await saveManifest(updated);
  return { project: updated, ref };
}

/** Dodaje nową notatkę autora. Zwraca zaktualizowany projekt. */
export async function addNote(
  project: OpenProject,
  title: string,
): Promise<{ project: OpenProject; ref: FileRef }> {
  await mkdir(await join(project.path, "notes"), { recursive: true });

  const slug = slugify(title);
  const file = await freeFileName(
    project,
    (n) => (n === 1 ? `notes/${slug}.md` : `notes/${slug}-${n}.md`),
    1,
  );
  const ref: FileRef = { id: crypto.randomUUID(), title, file };
  await writeTextFile(await absPath(project, ref.file), "");
  const updated: OpenProject = {
    ...project,
    notes: [...project.notes, ref],
  };
  await saveManifest(updated);
  return { project: updated, ref };
}

/** Usuwa rozdział lub notatkę (plik z dysku + wpis z manifestu). */
export async function deleteRef(
  project: OpenProject,
  kind: "chapter" | "note",
  id: string,
): Promise<OpenProject> {
  const list = kind === "chapter" ? project.chapters : project.notes;
  const ref = list.find((r) => r.id === id);
  if (!ref) return project;

  const path = await absPath(project, ref.file);
  if (await exists(path)) await remove(path);

  const updated: OpenProject =
    kind === "chapter"
      ? { ...project, chapters: project.chapters.filter((r) => r.id !== id) }
      : { ...project, notes: project.notes.filter((r) => r.id !== id) };

  await saveManifest(updated);
  return updated;
}

/** Zmienia tytuł rozdziału lub notatki i dostosowuje nazwę pliku na dysku,
 *  żeby nazwy plików nie rozjeżdżały się z tytułami widocznymi w UI.
 *  Numer porządkowy rozdziału (prefiks "NN-") zostaje zachowany. */
export async function renameRef(
  project: OpenProject,
  kind: "chapter" | "note",
  id: string,
  newTitle: string,
): Promise<OpenProject> {
  const list = kind === "chapter" ? project.chapters : project.notes;
  const current = list.find((r) => r.id === id);
  if (!current) return project;

  const slug = slugify(newTitle);
  let newFile = current.file;

  // Docelowa nazwa pliku wynikająca z nowego tytułu.
  let desired: (n: number) => string;
  if (kind === "chapter") {
    const prefix =
      current.file.match(/^chapters\/(\d+)-/)?.[1] ??
      String(list.indexOf(current) + 1).padStart(2, "0");
    desired = (n) =>
      n === 1
        ? `chapters/${prefix}-${slug}.md`
        : `chapters/${prefix}-${slug}-${n}.md`;
  } else {
    desired = (n) => (n === 1 ? `notes/${slug}.md` : `notes/${slug}-${n}.md`);
  }

  if (desired(1) !== current.file) {
    newFile = await freeFileName(project, desired, 1);
    const oldPath = await absPath(project, current.file);
    // Plik mógł zniknąć z dysku (usunięty ręcznie) — wtedy tylko aktualizujemy
    // manifest; treść odtworzy się przy najbliższym zapisie.
    if (await exists(oldPath)) {
      await rename(oldPath, await absPath(project, newFile));
    }
  }

  const apply = (l: FileRef[]) =>
    l.map((r) => (r.id === id ? { ...r, title: newTitle, file: newFile } : r));
  const updated: OpenProject =
    kind === "chapter"
      ? { ...project, chapters: apply(project.chapters) }
      : { ...project, notes: apply(project.notes) };
  await saveManifest(updated);
  return updated;
}

/* ------------------------------------------------------------------ */
/* Ignorowane błędy fact-checku                                        */
/* ------------------------------------------------------------------ */

const IGNORED_NAME = "ignored-issues.json";

/** Wpis ignorowanego błędu — identyfikowany przez plik, typ i cytat.
 *  (Opis pomijamy: model może go sformułować inaczej przy kolejnym sprawdzeniu,
 *  a typ + dokładny cytat wystarczają do rozpoznania tego samego zgłoszenia.) */
export interface IgnoredIssue {
  /** Ścieżka względna pliku, którego dotyczy (np. "chapters/01-x.md"). */
  file: string;
  type: string;
  fragment: string;
}

/** Wczytuje listę ignorowanych błędów projektu (brak pliku = pusta lista). */
export async function loadIgnoredIssues(project: OpenProject): Promise<IgnoredIssue[]> {
  const path = await join(project.path, IGNORED_NAME);
  if (!(await exists(path))) return [];
  try {
    const parsed = JSON.parse(await readTextFile(path)) as unknown;
    return Array.isArray(parsed) ? (parsed as IgnoredIssue[]) : [];
  } catch {
    // Uszkodzony plik nie może blokować weryfikacji — traktuj jak pusty.
    return [];
  }
}

/** Dodaje wpis do ignorowanych (bez duplikatów) i zapisuje plik na dysku. */
export async function addIgnoredIssue(
  project: OpenProject,
  entry: IgnoredIssue,
): Promise<IgnoredIssue[]> {
  const list = await loadIgnoredIssues(project);
  const dup = list.some(
    (e) => e.file === entry.file && e.type === entry.type && e.fragment === entry.fragment,
  );
  const updated = dup ? list : [...list, entry];
  if (!dup) {
    const path = await join(project.path, IGNORED_NAME);
    await writeTextFile(path, JSON.stringify(updated, null, 2));
  }
  return updated;
}

/** Usuwa wpis z ignorowanych (przywraca błąd — wróci przy kolejnym sprawdzeniu). */
export async function removeIgnoredIssue(
  project: OpenProject,
  entry: IgnoredIssue,
): Promise<IgnoredIssue[]> {
  const list = await loadIgnoredIssues(project);
  const updated = list.filter(
    (e) => !(e.file === entry.file && e.type === entry.type && e.fragment === entry.fragment),
  );
  if (updated.length !== list.length) {
    const path = await join(project.path, IGNORED_NAME);
    await writeTextFile(path, JSON.stringify(updated, null, 2));
  }
  return updated;
}

/**
 * Zwraca projekt z rozdziałem lub notatką przestawioną na wskazaną pozycję.
 *
 * **Czysta funkcja — nie dotyka dysku.** Zapis (`saveManifest`) należy do
 * wywołującego, bo sidebar musi przerysować listę natychmiast po puszczeniu
 * elementu, a dopiero potem utrwalić zmianę; czekanie na IPC przed renderem
 * dawało odczuwalne opóźnienie.
 *
 * `toIndex` to docelowy indeks **w liście po przeniesieniu** — taki, jaki
 * element ma ostatecznie zająć. Wartość poza zakresem jest przycinana, a brak
 * ruchu zwraca ten sam obiekt (wywołujący pozna to po tożsamości referencji).
 *
 * Kolejność żyje wyłącznie w manifeście: nazwy plików z prefiksem „NN-"
 * zostają nietknięte, bo zmiana nazw przy każdym przeciągnięciu oznaczałaby
 * lawinę operacji na dysku i ryzyko dla treści.
 */
export function reorderRefs(
  project: OpenProject,
  kind: "chapter" | "note",
  id: string,
  toIndex: number,
): OpenProject {
  const list = [...(kind === "chapter" ? project.chapters : project.notes)];
  const from = list.findIndex((r) => r.id === id);
  if (from < 0) return project;

  const to = Math.max(0, Math.min(list.length - 1, toIndex));
  if (from === to) return project;

  const [ref] = list.splice(from, 1);
  list.splice(to, 0, ref);

  return kind === "chapter" ? { ...project, chapters: list } : { ...project, notes: list };
}
