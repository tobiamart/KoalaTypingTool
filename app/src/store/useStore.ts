// Globalny stan aplikacji (Zustand): otwarty projekt, aktywny plik i jego treść,
// lista ostatnio otwieranych projektów. Warstwa dyskowa jest w lib/storage.ts.

import { create } from "zustand";
import type {
  ActiveFile,
  ActiveKind,
  FileRef,
  FontChoice,
  OpenProject,
  RecentProject,
} from "../types";
import { issueKey, type Issue, type TrackedIssue } from "../lib/ai";
import * as storage from "../lib/storage";

const RECENT_KEY = "narwhal.recentProjects";
const FONT_KEY = "narwhal.editorFont";
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
  /** Wyniki ostatniej weryfikacji aktywnego pliku — źródło podświetleń
   *  w edytorze i kart w panelu. Czyszczone przy zmianie pliku. */
  issues: TrackedIssue[];
  /** Ignorowane błędy całego projektu (`ignored-issues.json`). Trzymane w store,
   *  bo „Ignore" klika się w dwóch miejscach — na karcie w panelu i w dymku nad
   *  fragmentem — a licznik na dole panelu musi zgadzać się z oboma. */
  ignored: storage.IgnoredIssue[];
  /** Wybrany krój czcionki obszaru pisania. */
  editorFont: FontChoice;
  /** Czy okno ustawień jest otwarte. */
  settingsOpen: boolean;
  /** Czy wyszukiwarka projektu (paleta) jest otwarta. */
  searchOpen: boolean;
  /** Fragment do pokazania w edytorze po wybraniu wyniku wyszukiwania.
   *  `occurrence` wskazuje, które wystąpienie fragmentu w pliku wybrano (plik
   *  może zawierać kilka), a `nonce` rośnie przy każdym wywołaniu, żeby dwa
   *  razy to samo trafienie też odpaliło przewinięcie. */
  reveal: { text: string; occurrence: number; nonce: number } | null;

  newProject: (parentDir: string, title: string) => Promise<void>;
  openFolder: (path: string) => Promise<void>;
  closeProject: () => Promise<void>;
  selectFile: (kind: ActiveKind, id: string) => Promise<void>;
  updateContent: (markdown: string) => void;
  /** Zapisuje aktywny plik. Zwraca false, gdy zapis się nie powiódł (błąd trafia do `error`). */
  saveActive: () => Promise<boolean>;
  createChapter: (title: string) => Promise<string | null>;
  createNote: (title: string) => Promise<string | null>;
  removeRef: (kind: ActiveKind, id: string) => Promise<void>;
  renameFile: (kind: ActiveKind, id: string, title: string) => Promise<void>;
  /** Przenosi rozdział lub notatkę na wskazaną pozycję (przeciąganie w sidebarze). */
  moveRefTo: (kind: ActiveKind, id: string, toIndex: number) => Promise<void>;
  clearError: () => void;
  toggleVerify: () => void;
  setIssues: (issues: Issue[]) => void;
  /** Dokłada pojedynczy błąd (strumieniowe wyniki weryfikacji). */
  addIssue: (issue: Issue) => void;
  /** Oznacza zgłoszenia (klucze z `issueKey`) jako dotknięte edycją. */
  markIssuesEdited: (keys: string[]) => void;
  /** Dodaje błąd do ignorowanych (plik ignored-issues.json) i chowa go z wyników. */
  ignoreIssue: (issue: Pick<Issue, "type" | "fragment">) => Promise<void>;
  /** Wczytuje listę ignorowanych błędów projektu z dysku. */
  loadIgnored: () => Promise<void>;
  /** Zdejmuje wpis z listy ignorowanych (błąd wróci przy następnym sprawdzeniu). */
  restoreIgnored: (entry: storage.IgnoredIssue) => Promise<void>;
  setEditorFont: (font: FontChoice) => void;
  toggleSettings: () => void;
  setSearchOpen: (open: boolean) => void;
  /** Otwiera plik i prosi edytor o przewinięcie do wskazanego fragmentu. */
  openSearchHit: (
    kind: ActiveKind,
    id: string,
    fragment: string,
    occurrence: number,
  ) => Promise<void>;
  clearReveal: () => void;
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
  issues: [],
  ignored: [],
  editorFont: loadFont(),
  settingsOpen: false,
  searchOpen: false,
  reveal: null,

  newProject: async (parentDir, title) => {
    set({ loading: true, error: null });
    try {
      const project = await storage.createProject(parentDir, title);
      const recent = rememberProject(project, get().recent);
      const firstRef = project.chapters[0] ?? null;
      set({
        project,
        recent,
        active: firstRef ? { kind: "chapter", id: firstRef.id } : null,
        content: "",
        dirty: false,
        issues: [],
        ignored: [],
        loading: false,
      });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  openFolder: async (path) => {
    set({ loading: true, error: null });
    try {
      // Wpis mógł zostać na liście po przeniesieniu albo usunięciu folderu.
      // Wtedy sprzątamy go od razu — inaczej wisiałby tam na zawsze, wyrzucając
      // ten sam błąd przy każdym kliknięciu.
      if (!(await storage.isProjectFolder(path))) {
        const recent = get().recent.filter((r) => r.path !== path);
        saveRecent(recent);
        set({
          recent,
          loading: false,
          error: "Project not found — the folder was moved or deleted. Removed from recent projects.",
        });
        return;
      }
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
        issues: [],
        ignored: [],
        loading: false,
      });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  closeProject: async () => {
    // Nie zamykaj projektu, dopóki niezapisane zmiany nie trafią na dysk —
    // inaczej ostatnie sekundy pisania przepadłyby bez ostrzeżenia.
    if (get().dirty) {
      const ok = await get().saveActive();
      if (!ok) return;
    }
    set({ project: null, active: null, content: "", dirty: false, issues: [], ignored: [] });
  },

  selectFile: async (kind, id) => {
    const { project, active, dirty } = get();
    if (!project) return;
    // Kliknięcie w już otwarty plik nie ma nic do zrobienia — bez tego dwuklik
    // (zmiana nazwy) niepotrzebnie zapisywał i wczytywał ten sam plik z dysku.
    if (active?.kind === kind && active.id === id) return;
    // Zapisz bieżący plik zanim przełączysz; przy nieudanym zapisie zostań na nim.
    if (dirty) {
      const ok = await get().saveActive();
      if (!ok) return;
    }

    const list = kind === "chapter" ? project.chapters : project.notes;
    const ref = list.find((r) => r.id === id);
    if (!ref) return;
    try {
      const content = await storage.readFile(project, ref);
      set({ active: { kind, id }, content, dirty: false, issues: [] });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  updateContent: (markdown) => {
    set({ content: markdown, dirty: true });
  },

  saveActive: async () => {
    const { project, active, content } = get();
    const ref = findRef(project, active);
    if (!project || !ref) return true;
    try {
      await storage.writeFile(project, ref, content);
      set({ dirty: false });
      return true;
    } catch (e) {
      // dirty zostaje true — pasek statusu nie skłamie, że zapisano.
      set({ error: "Saving failed: " + String(e) });
      return false;
    }
  },

  createChapter: async (title) => {
    const { project } = get();
    if (!project) return null;
    if (get().dirty && !(await get().saveActive())) return null;
    try {
      const { project: updated, ref } = await storage.addChapter(project, title);
      const content = await storage.readFile(updated, ref);
      set({ project: updated, active: { kind: "chapter", id: ref.id }, content, dirty: false, issues: [] });
      return ref.id;
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },

  createNote: async (title) => {
    const { project } = get();
    if (!project) return null;
    if (get().dirty && !(await get().saveActive())) return null;
    try {
      const { project: updated, ref } = await storage.addNote(project, title);
      set({ project: updated, active: { kind: "note", id: ref.id }, content: "", dirty: false, issues: [] });
      return ref.id;
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },

  removeRef: async (kind, id) => {
    const { project, active } = get();
    if (!project) return;
    try {
      const updated = await storage.deleteRef(project, kind, id);
      // Jeśli usunięto aktywny plik, przełącz na pierwszy dostępny rozdział.
      let patch: Partial<AppState> = { project: updated };
      if (active && active.kind === kind && active.id === id) {
        const fallback = updated.chapters[0] ?? null;
        if (fallback) {
          const content = await storage.readFile(updated, fallback);
          patch = { ...patch, active: { kind: "chapter", id: fallback.id }, content, dirty: false, issues: [] };
        } else {
          patch = { ...patch, active: null, content: "", dirty: false, issues: [] };
        }
      }
      set(patch);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  renameFile: async (kind, id, title) => {
    const { project } = get();
    if (!project) return;
    try {
      const updated = await storage.renameRef(project, kind, id, title);
      set({ project: updated });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  moveRefTo: async (kind, id, toIndex) => {
    const { project } = get();
    if (!project) return;

    const updated = storage.reorderRefs(project, kind, id, toIndex);
    // Ten sam obiekt = ruch bez efektu; nie ma po co ruszać widoku ani dysku.
    if (updated === project) return;

    // Najpierw widok, potem dysk. Zapis manifestu idzie przez IPC i trwa na tyle
    // długo, że lista zauważalnie „doganiała" mysz, gdy render czekał na zapis.
    set({ project: updated });
    try {
      await storage.saveManifest(updated);
    } catch (e) {
      // Zapis padł — cofamy kolejność, żeby widok nie kłamał o stanie dysku.
      set({ project, error: "Saving the new order failed: " + String(e) });
    }
  },

  clearError: () => set({ error: null }),

  toggleVerify: () => set((s) => ({ verifyOpen: !s.verifyOpen })),

  setIssues: (issues) => set({ issues }),

  addIssue: (issue) => set((s) => ({ issues: [...s.issues, issue] })),

  markIssuesEdited: (keys) =>
    set((s) => {
      // Nie ruszaj tablicy, gdy nic się nie zmienia — inaczej każde naciśnięcie
      // klawisza przerysowywałoby panel i (przez useEffect na `issues`)
      // przebudowywało wszystkie podświetlenia.
      if (!keys.some((k) => s.issues.some((i) => !i.edited && issueKey(i) === k))) return s;
      return {
        issues: s.issues.map((i) => (keys.includes(issueKey(i)) ? { ...i, edited: true } : i)),
      };
    }),

  ignoreIssue: async (issue) => {
    const { project, active } = get();
    const ref = findRef(project, active);
    if (!project || !ref) return;
    try {
      const ignored = await storage.addIgnoredIssue(project, {
        file: ref.file,
        type: issue.type,
        fragment: issue.fragment,
      });
      // Schowaj wszystkie zgłoszenia o tym samym typie i cytacie.
      set((s) => ({
        ignored,
        issues: s.issues.filter(
          (i) => !(i.type === issue.type && i.fragment === issue.fragment),
        ),
      }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  loadIgnored: async () => {
    const { project } = get();
    if (!project) return;
    const ignored = await storage.loadIgnoredIssues(project);
    // Projekt mógł się w tym czasie zmienić — nie wstawiaj listy z poprzedniego.
    if (get().project?.path === project.path) set({ ignored });
  },

  restoreIgnored: async (entry) => {
    const { project } = get();
    if (!project) return;
    try {
      set({ ignored: await storage.removeIgnoredIssue(project, entry) });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  setEditorFont: (font) => {
    localStorage.setItem(FONT_KEY, font);
    set({ editorFont: font });
  },

  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),

  // Otwarcie palety zamyka okno ustawień: modal ustawień trzyma focus w pułapce
  // (Tab krąży w jego panelu) i sam obsługuje Escape, więc oba naraz walczyłyby
  // o klawiaturę.
  setSearchOpen: (open) =>
    set(open ? { searchOpen: true, settingsOpen: false } : { searchOpen: false }),

  openSearchHit: async (kind, id, fragment, occurrence) => {
    // Najpierw przełącz plik (to zapisuje bieżący i wczytuje nowy), dopiero
    // potem poproś o przewinięcie — edytor montuje się na nowo przy zmianie
    // pliku i i tak przeczytałby `reveal` dopiero po zamontowaniu.
    await get().selectFile(kind, id);
    set({ searchOpen: false });
    if (fragment) {
      set((s) => ({
        reveal: { text: fragment, occurrence, nonce: (s.reveal?.nonce ?? 0) + 1 },
      }));
    }
  },

  clearReveal: () => set({ reveal: null }),
}));
