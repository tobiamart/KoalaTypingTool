// Globalny stan aplikacji (Zustand): otwarty projekt, aktywny plik i jego treść,
// lista ostatnio otwieranych projektów. Warstwa dyskowa jest w lib/storage.ts.

import { create } from "zustand";
import type {
  ActiveFile,
  ActiveKind,
  FileRef,
  FontChoice,
  OpenProject,
  ProjectType,
  RecentProject,
} from "../types";
import * as storage from "../lib/storage";

const RECENT_KEY = "koala.recentProjects";
const FONT_KEY = "koala.editorFont";
const MAX_RECENT = 10;

function loadFont(): FontChoice {
  const v = localStorage.getItem(FONT_KEY);
  return v === "serif" || v === "mono" ? v : "sans";
}

function loadRecent(): RecentProject[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as RecentProject[]) : [];
  } catch {
    return [];
  }
}

function saveRecent(list: RecentProject[]): void {
  localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
}

function rememberProject(project: OpenProject, prev: RecentProject[]): RecentProject[] {
  const entry: RecentProject = {
    path: project.path,
    title: project.title,
    type: project.type,
    openedAt: new Date().toISOString(),
  };
  const deduped = prev.filter((r) => r.path !== project.path);
  const next = [entry, ...deduped].slice(0, MAX_RECENT);
  saveRecent(next);
  return next;
}

interface AppState {
  project: OpenProject | null;
  active: ActiveFile | null;
  /** Markdown aktualnie otwartego pliku (źródło prawdy dla edytora). */
  content: string;
  /** Czy bieżąca treść ma niezapisane zmiany. */
  dirty: boolean;
  loading: boolean;
  error: string | null;
  recent: RecentProject[];
  /** Czy panel weryfikacji (fact-check) jest wysunięty. */
  verifyOpen: boolean;
  /** Wybrany krój czcionki obszaru pisania. */
  editorFont: FontChoice;
  /** Czy okno ustawień jest otwarte. */
  settingsOpen: boolean;

  newProject: (parentDir: string, title: string, type: ProjectType) => Promise<void>;
  openFolder: (path: string) => Promise<void>;
  closeProject: () => void;
  selectFile: (kind: ActiveKind, id: string) => Promise<void>;
  updateContent: (markdown: string) => void;
  saveActive: () => Promise<void>;
  createChapter: (title: string) => Promise<string | null>;
  createNote: (title: string) => Promise<string | null>;
  removeRef: (kind: ActiveKind, id: string) => Promise<void>;
  renameFile: (kind: ActiveKind, id: string, title: string) => Promise<void>;
  clearError: () => void;
  toggleVerify: () => void;
  setEditorFont: (font: FontChoice) => void;
  toggleSettings: () => void;
}

/** Zwraca referencję pliku wskazywaną przez `active` w danym projekcie. */
export function findRef(project: OpenProject | null, active: ActiveFile | null): FileRef | null {
  if (!project || !active) return null;
  const list = active.kind === "chapter" ? project.chapters : project.notes;
  return list.find((r) => r.id === active.id) ?? null;
}

export const useStore = create<AppState>((set, get) => ({
  project: null,
  active: null,
  content: "",
  dirty: false,
  loading: false,
  error: null,
  recent: loadRecent(),
  verifyOpen: false,
  editorFont: loadFont(),
  settingsOpen: false,

  newProject: async (parentDir, title, type) => {
    set({ loading: true, error: null });
    try {
      const project = await storage.createProject(parentDir, title, type);
      const recent = rememberProject(project, get().recent);
      const firstRef = project.chapters[0] ?? null;
      set({
        project,
        recent,
        active: firstRef ? { kind: "chapter", id: firstRef.id } : null,
        content: "",
        dirty: false,
        loading: false,
      });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  openFolder: async (path) => {
    set({ loading: true, error: null });
    try {
      const project = await storage.loadProject(path);
      const recent = rememberProject(project, get().recent);
      const firstRef = project.chapters[0] ?? null;
      let content = "";
      if (firstRef) content = await storage.readFile(project, firstRef);
      set({
        project,
        recent,
        active: firstRef ? { kind: "chapter", id: firstRef.id } : null,
        content,
        dirty: false,
        loading: false,
      });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  closeProject: () => {
    set({ project: null, active: null, content: "", dirty: false });
  },

  selectFile: async (kind, id) => {
    const { project, dirty } = get();
    if (!project) return;
    // Zapisz bieżący plik zanim przełączysz, jeśli są zmiany.
    if (dirty) await get().saveActive();

    const list = kind === "chapter" ? project.chapters : project.notes;
    const ref = list.find((r) => r.id === id);
    if (!ref) return;
    const content = await storage.readFile(project, ref);
    set({ active: { kind, id }, content, dirty: false });
  },

  updateContent: (markdown) => {
    set({ content: markdown, dirty: true });
  },

  saveActive: async () => {
    const { project, active, content } = get();
    const ref = findRef(project, active);
    if (!project || !ref) return;
    await storage.writeFile(project, ref, content);
    set({ dirty: false });
  },

  createChapter: async (title) => {
    const { project } = get();
    if (!project) return null;
    if (get().dirty) await get().saveActive();
    const { project: updated, ref } = await storage.addChapter(project, title);
    const content = await storage.readFile(updated, ref);
    set({ project: updated, active: { kind: "chapter", id: ref.id }, content, dirty: false });
    return ref.id;
  },

  createNote: async (title) => {
    const { project } = get();
    if (!project) return null;
    if (get().dirty) await get().saveActive();
    const { project: updated, ref } = await storage.addNote(project, title);
    const content = await storage.readFile(updated, ref);
    set({ project: updated, active: { kind: "note", id: ref.id }, content, dirty: false });
    return ref.id;
  },

  removeRef: async (kind, id) => {
    const { project, active } = get();
    if (!project) return;
    const updated = await storage.deleteRef(project, kind, id);
    // Jeśli usunięto aktywny plik, przełącz na pierwszy dostępny rozdział.
    let patch: Partial<AppState> = { project: updated };
    if (active && active.kind === kind && active.id === id) {
      const fallback = updated.chapters[0] ?? null;
      if (fallback) {
        const content = await storage.readFile(updated, fallback);
        patch = { ...patch, active: { kind: "chapter", id: fallback.id }, content, dirty: false };
      } else {
        patch = { ...patch, active: null, content: "", dirty: false };
      }
    }
    set(patch);
  },

  renameFile: async (kind, id, title) => {
    const { project } = get();
    if (!project) return;
    const updated = await storage.renameRef(project, kind, id, title);
    set({ project: updated });
  },

  clearError: () => set({ error: null }),

  toggleVerify: () => set((s) => ({ verifyOpen: !s.verifyOpen })),

  setEditorFont: (font) => {
    localStorage.setItem(FONT_KEY, font);
    set({ editorFont: font });
  },

  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),
}));
