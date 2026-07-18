// Typy domenowe aplikacji Koala.

/** Typ tworzonego projektu. */
export type ProjectType = "book" | "document";

/** Referencja do pojedynczego pliku treści w projekcie (rozdział, dokument lub notatka). */
export interface FileRef {
  /** Unikalny identyfikator (UUID) — stabilny nawet przy zmianie tytułu/nazwy pliku. */
  id: string;
  /** Tytuł wyświetlany w interfejsie. */
  title: string;
  /** Ścieżka względna do folderu projektu, z ukośnikami "/", np. "chapters/01-beginning.md". */
  file: string;
}

/** Zawartość pliku project.json — trwały opis projektu na dysku. */
export interface ProjectManifest {
  type: ProjectType;
  title: string;
  createdAt: string;
  /** Dla "book" — lista rozdziałów; dla "document" — dokładnie jeden wpis (document.md). */
  chapters: FileRef[];
  /** Notatki autora (opis świata, postacie, bibliografia) — wspólne dla obu typów. */
  notes: FileRef[];
}

/** Projekt otwarty w pamięci — manifest wzbogacony o absolutną ścieżkę folderu. */
export interface OpenProject extends ProjectManifest {
  /** Absolutna ścieżka folderu projektu na dysku. */
  path: string;
}

/** Wpis listy ostatnio otwieranych projektów (trzymany w localStorage). */
export interface RecentProject {
  path: string;
  title: string;
  type: ProjectType;
  openedAt: string;
}

/** Wybór kroju czcionki obszaru pisania. */
export type FontChoice = "sans" | "serif" | "mono";

/** Rodzaj aktywnego pliku w edytorze. */
export type ActiveKind = "chapter" | "note";

/** Wskazanie aktualnie otwartego pliku. */
export interface ActiveFile {
  kind: ActiveKind;
  id: string;
}
