// Warstwa dostępu do dysku: tworzenie i wczytywanie projektów oraz plików treści.
// Korzysta z oficjalnego pluginu @tauri-apps/plugin-fs (żadnych własnych komend Rust).

import {
  readTextFile,
  writeTextFile,
  mkdir,
  exists,
  remove,
} from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import type {
  FileRef,
  OpenProject,
  ProjectManifest,
  ProjectType,
} from "../types";

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
    type: project.type,
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
  type: ProjectType,
): Promise<OpenProject> {
  const folderName = slugify(title);
  const projectPath = await join(parentDir, folderName);

  if (await exists(projectPath)) {
    throw new Error(`A folder "${folderName}" already exists in this location.`);
  }

  await mkdir(projectPath, { recursive: true });
  await mkdir(await join(projectPath, "notes"), { recursive: true });

  const now = new Date().toISOString();
  let chapters: FileRef[];

  if (type === "book") {
    await mkdir(await join(projectPath, "chapters"), { recursive: true });
    const firstChapter: FileRef = {
      id: crypto.randomUUID(),
      title: "Chapter 1",
      file: "chapters/01-chapter-1.md",
    };
    chapters = [firstChapter];
    await writeTextFile(
      await join(projectPath, ...firstChapter.file.split("/")),
      "",
    );
  } else {
    // document: pojedynczy plik główny
    const mainDoc: FileRef = {
      id: crypto.randomUUID(),
      title: title,
      file: "document.md",
    };
    chapters = [mainDoc];
    await writeTextFile(await join(projectPath, "document.md"), "");
  }

  const project: OpenProject = {
    type,
    title,
    createdAt: now,
    chapters,
    notes: [],
    path: projectPath,
  };

  await saveManifest(project);
  return project;
}

/** Kolejny numer porządkowy dla nazwy pliku rozdziału (01, 02, ...). */
function nextIndex(count: number): string {
  return String(count + 1).padStart(2, "0");
}

/** Dodaje nowy rozdział (tylko dla projektów typu "book"). Zwraca zaktualizowany projekt. */
export async function addChapter(
  project: OpenProject,
  title: string,
): Promise<{ project: OpenProject; ref: FileRef }> {
  const idx = nextIndex(project.chapters.length);
  const ref: FileRef = {
    id: crypto.randomUUID(),
    title,
    file: `chapters/${idx}-${slugify(title)}.md`,
  };
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
  const ref: FileRef = {
    id: crypto.randomUUID(),
    title,
    file: `notes/${slugify(title)}.md`,
  };
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

/** Zmienia tytuł rozdziału lub notatki w manifeście (nazwa pliku pozostaje bez zmian). */
export async function renameRef(
  project: OpenProject,
  kind: "chapter" | "note",
  id: string,
  newTitle: string,
): Promise<OpenProject> {
  const rename = (list: FileRef[]) =>
    list.map((r) => (r.id === id ? { ...r, title: newTitle } : r));
  const updated: OpenProject =
    kind === "chapter"
      ? { ...project, chapters: rename(project.chapters) }
      : { ...project, notes: rename(project.notes) };
  await saveManifest(updated);
  return updated;
}
