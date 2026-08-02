// Panel boczny: nawigacja po rozdziałach i notatkach autora.
// Umożliwia dodawanie, zmianę nazwy i usuwanie plików.

import { useRef, useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { useStore } from "../store/useStore";
import type { ActiveKind, FileRef } from "../types";

export function Sidebar() {
  const project = useStore((s) => s.project);
  const active = useStore((s) => s.active);
  const selectFile = useStore((s) => s.selectFile);
  const createChapter = useStore((s) => s.createChapter);
  const createNote = useStore((s) => s.createNote);
  const removeRef = useStore((s) => s.removeRef);
  const renameFile = useStore((s) => s.renameFile);
  const moveRefTo = useStore((s) => s.moveRefTo);
  const closeProject = useStore((s) => s.closeProject);
  const toggleSettings = useStore((s) => s.toggleSettings);

  const [adding, setAdding] = useState<ActiveKind | null>(null);
  const [newTitle, setNewTitle] = useState("");
  // Aktualnie zmieniana nazwa (dwuklik na elemencie), null gdy nic nie edytujemy.
  const [editing, setEditing] = useState<{ kind: ActiveKind; id: string } | null>(null);
  const [editTitle, setEditTitle] = useState("");
  // Klucz ostatnio zatwierdzonej zmiany nazwy — chroni przed podwójnym zapisem.
  const submittedRef = useRef<string | null>(null);

  // Przeciąganie: element trzymany w ręce i miejsce, w które trafi.
  const [drag, setDrag] = useState<{ kind: ActiveKind; id: string; index: number } | null>(null);
  const [dropAt, setDropAt] = useState<{ kind: ActiveKind; index: number; after: boolean } | null>(
    null,
  );

  function endDrag() {
    setDrag(null);
    setDropAt(null);
  }

  function handleDragOver(e: React.DragEvent, kind: ActiveKind, index: number) {
    // Rozdziały i notatki to osobne foldery na dysku — nie mieszamy ich.
    if (!drag || drag.kind !== kind) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const box = e.currentTarget.getBoundingClientRect();
    const after = e.clientY > box.top + box.height / 2;
    setDropAt((prev) =>
      prev && prev.kind === kind && prev.index === index && prev.after === after
        ? prev // ten sam cel — bez zbędnego renderu przy każdym ruchu myszy
        : { kind, index, after },
    );
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    if (!drag || !dropAt || drag.kind !== dropAt.kind) return endDrag();
    // Pozycja liczona w liście SPRZED wyjęcia elementu, więc przy ruchu w dół
    // trzeba ją cofnąć o jeden — inaczej element ląduje o pozycję za daleko.
    const insertAt = dropAt.index + (dropAt.after ? 1 : 0);
    const target = insertAt > drag.index ? insertAt - 1 : insertAt;
    void moveRefTo(drag.kind, drag.id, target);
    endDrag();
  }

  if (!project) return null;

  async function submitAdd() {
    const title = newTitle.trim();
    if (!title) return;
    if (adding === "chapter") await createChapter(title);
    else if (adding === "note") await createNote(title);
    setNewTitle("");
    setAdding(null);
  }

  function startRename(ref: FileRef, kind: ActiveKind) {
    submittedRef.current = null;
    setEditing({ kind, id: ref.id });
    setEditTitle(ref.title);
  }

  /** Zatwierdza zmianę nazwy. Enter i utrata focusu wołają to samo, a odmontowanie
   *  pola po Enterze samo odpala onBlur — bez znacznika zapis poszedłby dwa razy
   *  (`editing` w domknięciu tego renderu jest wtedy nadal niepuste). */
  async function submitRename() {
    if (!editing) return;
    const key = editing.kind + ":" + editing.id;
    if (submittedRef.current === key) return;
    submittedRef.current = key;

    const title = editTitle.trim();
    const target = editing;
    setEditing(null);
    if (title) await renameFile(target.kind, target.id, title);
  }

  // Usunięcie kasuje plik z dysku bezpowrotnie — zawsze pytamy o potwierdzenie.
  async function handleDelete(ref: FileRef, kind: ActiveKind) {
    const what = kind === "chapter" ? "chapter" : "note";
    const ok = await confirm(
      `Delete the ${what} "${ref.title}"?\nThe file will be permanently removed from disk.`,
      { title: "Delete " + what, kind: "warning" },
    );
    if (ok) await removeRef(kind, ref.id);
  }

  function renderItem(ref: FileRef, kind: ActiveKind, index: number, count: number) {
    const isActive = active?.kind === kind && active.id === ref.id;
    const isEditing = editing?.kind === kind && editing.id === ref.id;
    const isDragged = drag?.kind === kind && drag.id === ref.id;
    const marker =
      dropAt && dropAt.kind === kind && dropAt.index === index && !isDragged
        ? dropAt.after
          ? " navitem--drop-after"
          : " navitem--drop-before"
        : "";

    if (isEditing) {
      return (
        <li key={ref.id} className="navitem navitem--active">
          <input
            className="navitem__edit"
            autoFocus
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitRename();
              if (e.key === "Escape") setEditing(null);
            }}
            onBlur={submitRename}
          />
        </li>
      );
    }

    return (
      <li
        key={ref.id}
        className={
          "navitem" +
          (isActive ? " navitem--active" : "") +
          (isDragged ? " navitem--dragging" : "") +
          marker
        }
        draggable
        onDragStart={(e) => {
          setDrag({ kind, id: ref.id, index });
          e.dataTransfer.effectAllowed = "move";
          // Bez setData część przeglądarek w ogóle nie rozpoczyna przeciągania.
          e.dataTransfer.setData("text/plain", ref.id);
        }}
        onDragOver={(e) => handleDragOver(e, kind, index)}
        onDrop={handleDrop}
        onDragEnd={endDrag}
      >
        <button
          className="navitem__label"
          onClick={() => selectFile(kind, ref.id)}
          onDoubleClick={() => startRename(ref, kind)}
          // Przeciąganie myszą jest niedostępne z klawiatury, więc ten sam ruch
          // robi Alt + strzałka — inaczej kolejności nie dałoby się zmienić bez myszy.
          onKeyDown={(e) => {
            if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
            e.preventDefault();
            const target = e.key === "ArrowUp" ? index - 1 : index + 1;
            if (target < 0 || target >= count) return;
            void moveRefTo(kind, ref.id, target);
          }}
          title="Drag to reorder · double-click to rename"
        >
          {ref.title}
        </button>
        <button
          className="navitem__rename"
          title="Rename"
          aria-label={`Rename ${ref.title}`}
          onClick={() => startRename(ref, kind)}
        >
          ✎
        </button>
        <button
          className="navitem__del"
          title="Delete"
          aria-label={`Delete ${ref.title}`}
          onClick={() => handleDelete(ref, kind)}
        >
          ✕
        </button>
      </li>
    );
  }

  return (
    <aside className="sidebar">
      <div className="sidebar__head">
        <button className="sidebar__back" onClick={closeProject} title="Close project" aria-label="Close project">
          ‹
        </button>
        <div className="sidebar__project">
          <span className="sidebar__type">📚 Project</span>
          <span className="sidebar__title">{project.title}</span>
        </div>
      </div>

      <nav className="sidebar__nav">
        <div className="sidebar__section">
          <div className="sidebar__section-head">
            <span>Chapters</span>
            <button
              className="sidebar__add"
              title="Add chapter"
              aria-label="Add chapter"
              onClick={() => { setAdding("chapter"); setNewTitle(""); }}
            >
              +
            </button>
          </div>
          <ul>
            {project.chapters.map((c, i) =>
              renderItem(c, "chapter", i, project.chapters.length),
            )}
          </ul>
          {adding === "chapter" && (
            <AddInput
              value={newTitle}
              onChange={setNewTitle}
              onSubmit={submitAdd}
              onCancel={() => setAdding(null)}
              placeholder="Chapter title"
            />
          )}
        </div>

        <div className="sidebar__section">
          <div className="sidebar__section-head">
            <span>Author's notes</span>
            <button
              className="sidebar__add"
              title="Add note"
              aria-label="Add note"
              onClick={() => { setAdding("note"); setNewTitle(""); }}
            >
              +
            </button>
          </div>
          <ul>
            {project.notes.map((n, i) => renderItem(n, "note", i, project.notes.length))}
          </ul>
          {project.notes.length === 0 && adding !== "note" && (
            <p className="sidebar__empty">e.g. worldbuilding, characters, bibliography</p>
          )}
          {adding === "note" && (
            <AddInput
              value={newTitle}
              onChange={setNewTitle}
              onSubmit={submitAdd}
              onCancel={() => setAdding(null)}
              placeholder="Note title"
            />
          )}
        </div>
      </nav>

      <div className="sidebar__footer">
        <button className="sidebar__settings" onClick={toggleSettings} title="Settings">
          ⚙ Settings
        </button>
      </div>
    </aside>
  );
}

interface AddInputProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  placeholder: string;
}

function AddInput({ value, onChange, onSubmit, onCancel, placeholder }: AddInputProps) {
  // Utrata focusu ZATWIERDZA wpisany tytuł, a nie anuluje. Wcześniej kliknięcie
  // gdziekolwiek obok pola kasowało wpisany tekst — jedynym wyjściem był Enter.
  // Pusta nazwa dalej znaczy „rezygnuję". Znacznik chroni przed podwójnym
  // wywołaniem: po Enterze pole znika, co samo odpala onBlur.
  const done = useRef(false);
  const finish = (submit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (submit && value.trim()) onSubmit();
    else onCancel();
  };

  return (
    <div className="addinput">
      <input
        autoFocus
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") finish(true);
          if (e.key === "Escape") finish(false);
        }}
        onBlur={() => finish(true)}
      />
    </div>
  );
}
