// Typy domenowe aplikacji Narwhal.

/** Referencja do pojedynczego pliku treści w projekcie (rozdział lub notatka). */
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
  title: string;
  createdAt: string;
  /** Rozdziały w kolejności wyświetlania. */
  chapters: FileRef[];
  /** Notatki autora (opis świata, postacie, bibliografia) — kontekst dla weryfikacji AI. */
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
