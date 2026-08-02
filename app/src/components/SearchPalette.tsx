// Wyszukiwarka projektu — paleta w stylu Spotlighta (⌘K / Ctrl+K).
// Szuka po tytułach i treści wszystkich rozdziałów oraz notatek; wybranie wyniku
// otwiera plik i przewija edytor do trafienia.
//
// Indeks powstaje RAZ, przy otwarciu palety: treść czytamy z dysku, a dla
// aktualnie otwartego pliku bierzemy wersję ze store'u, żeby świeżo napisane
// (jeszcze niezapisane) zdanie też dawało się znaleźć.

import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store/useStore";
import * as storage from "../lib/storage";
import { indexDoc, searchDocs, type IndexedDoc, type SearchHit } from "../lib/search";
import type { ActiveKind, FileRef } from "../types";

/** Wynik dla pustego zapytania: sam plik jako cel skoku (bez podglądu treści). */
function jumpHit(doc: IndexedDoc): SearchHit {
  return {
    kind: doc.kind,
    id: doc.id,
    title: doc.title,
    file: doc.file,
    index: null,
    occurrence: 0,
    before: "",
    match: "",
    after: "",
  };
}

export function SearchPalette() {
  const searchOpen = useStore((s) => s.searchOpen);
  const project = useStore((s) => s.project);
  const setSearchOpen = useStore((s) => s.setSearchOpen);
  const openSearchHit = useStore((s) => s.openSearchHit);

  const [query, setQuery] = useState("");
  const [docs, setDocs] = useState<IndexedDoc[] | null>(null);
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  // Po zamknięciu palety focus wraca tam, skąd przyszedł (przycisk w sidebarze
  // albo edytor) — inaczej klawiatura lądowała na początku dokumentu.
  // Wybranie wyniku samo przenosi focus do edytora, więc wtedy nic nie robimy.
  useEffect(() => {
    if (!searchOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    return () => {
      if (document.activeElement === document.body) previous?.focus();
    };
  }, [searchOpen]);

  // Wczytaj treść wszystkich plików projektu przy otwarciu palety.
  useEffect(() => {
    if (!searchOpen || !project) return;
    let cancelled = false;
    setQuery("");
    setSelected(0);
    setDocs(null);

    const refs: { kind: ActiveKind; ref: FileRef }[] = [
      ...project.chapters.map((ref) => ({ kind: "chapter" as const, ref })),
      ...project.notes.map((ref) => ({ kind: "note" as const, ref })),
    ];
    const { active, content } = useStore.getState();

    void Promise.all(
      refs.map(async ({ kind, ref }) => {
        const isActive = active?.kind === kind && active.id === ref.id;
        // Plik mógł zniknąć z dysku albo być nieczytelny — wtedy zostaje sam
        // tytuł. Wyszukiwarka nie jest miejscem na zgłaszanie błędów I/O.
        const text = isActive ? content : await storage.readFile(project, ref).catch(() => "");
        return indexDoc({ kind, id: ref.id, title: ref.title, file: ref.file, text });
      }),
    ).then((indexed) => {
      if (!cancelled) setDocs(indexed);
    });

    return () => {
      cancelled = true;
    };
  }, [searchOpen, project]);

  const results = useMemo(() => {
    if (!docs) return [];
    return query.trim() ? searchDocs(docs, query) : docs.map(jumpHit);
  }, [docs, query]);

  // Zaznaczenie zawsze w zakresie listy — zapytanie mogło ją skrócić.
  const activeIndex = Math.min(selected, Math.max(0, results.length - 1));

  // Przewiń zaznaczony wiersz do widoku (klawiatura potrafi zejść poniżej krawędzi).
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, results]);

  if (!searchOpen || !project) return null;

  function choose(hit: SearchHit) {
    void openSearchHit(hit.kind, hit.id, hit.match, hit.occurrence);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      setSearchOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected(results.length ? (activeIndex + 1) % results.length : 0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected(results.length ? (activeIndex - 1 + results.length) % results.length : 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = results[activeIndex];
      if (hit) choose(hit);
    }
  }

  const searching = query.trim().length > 0;

  return (
    // mousedown zamiast click: klik w tło po zaznaczeniu tekstu w polu kończy
    // się poza panelem i zamykałby paletę w środku zaznaczania.
    <div className="palette" onMouseDown={() => setSearchOpen(false)}>
      <div
        className="palette__panel"
        role="dialog"
        aria-modal="true"
        aria-label="Search project"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="palette__field">
          <span className="palette__icon" aria-hidden="true">
            ⌕
          </span>
          <input
            className="palette__input"
            autoFocus
            value={query}
            placeholder="Search chapters and notes…"
            aria-label="Search chapters and notes"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={results[activeIndex] ? `palette-opt-${activeIndex}` : undefined}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            onKeyDown={onKeyDown}
          />
          {!docs && <span className="spinner spinner--sm" aria-label="Indexing project" />}
        </div>

        {results.length > 0 && (
          <ul className="palette__results" id="palette-results" role="listbox" ref={listRef}>
            {results.map((hit, i) => (
              <li
                key={hit.kind + hit.id + (hit.index ?? "title") + i}
                id={`palette-opt-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                data-selected={i === activeIndex}
                className={"phit" + (i === activeIndex ? " phit--active" : "")}
              >
                <button
                  className="phit__btn"
                  onMouseMove={() => setSelected(i)}
                  onClick={() => choose(hit)}
                >
                  <span className="phit__top">
                    <span className="phit__kind">{hit.kind === "chapter" ? "Chapter" : "Note"}</span>
                    <span className="phit__title">{hit.title}</span>
                  </span>
                  {hit.index !== null && (
                    <span className="phit__snippet">
                      {hit.before}
                      <mark className="phit__mark">{hit.match}</mark>
                      {hit.after}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        {docs && searching && results.length === 0 && (
          <div className="palette__empty">No matches for “{query.trim()}”</div>
        )}

        <div className="palette__footer">
          <span>↑↓ navigate · ↵ open · esc close</span>
          {docs && searching && (
            <span>
              {results.length} {results.length === 1 ? "result" : "results"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
