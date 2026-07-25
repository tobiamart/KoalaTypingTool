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

/** Buduje absolutną ścieżkę pliku wewnątrz projektu z jego ścieżki względnej. */
async function absPath(project: OpenProject, relative: string): Promise<string> {
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

/** Wczytuje istniejący projekt z folderu. */
export async function loadProject(folderPath: string): Promise<OpenProject> {
  const manifestPath = await join(folderPath, MANIFEST_NAME);
  if (!(await exists(manifestPath))) {
    throw new Error("This is not a Koala project folder (missing project.json).");
  }
  const raw = await readTextFile(manifestPath);
  const manifest = JSON.parse(raw) as ProjectManifest;
  return { ...manifest, path: folderPath };
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

/** Przesuwa rozdział lub notatkę o jedną pozycję w górę (-1) lub w dół (+1). */
export async function moveRef(
  project: OpenProject,
  kind: "chapter" | "note",
  id: string,
  delta: -1 | 1,
): Promise<OpenProject> {
  const list = [...(kind === "chapter" ? project.chapters : project.notes)];
  const i = list.findIndex((r) => r.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return project;
  [list[i], list[j]] = [list[j], list[i]];
  const updated: OpenProject =
    kind === "chapter" ? { ...project, chapters: list } : { ...project, notes: list };
  await saveManifest(updated);
  return updated;
}
