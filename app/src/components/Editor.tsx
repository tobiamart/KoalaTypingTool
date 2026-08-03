// Edytor tekstu oparty na TipTap z serializacją do Markdown.
// Źródłem prawdy treści jest store (pole `content`); zmiany użytkownika spływają
// do store i są autozapisywane z opóźnieniem.
//
// Każdy plik dostaje WŁASNĄ instancję edytora (komponent FileEditor z `key`
// po id pliku). Dzięki temu historia undo nie przecieka między plikami —
// bez tego Ctrl+Z po przełączeniu pliku mógłby wstrzyknąć treść poprzedniego
// pliku do bieżącego (i autozapis utrwaliłby to na dysku).

import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent, useEditorState } from "@tiptap/react";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import { Markdown } from "tiptap-markdown";
import { useStore, findRef } from "../store/useStore";
import { EditorToolbar } from "./EditorToolbar";
import { findFragmentRanges, type TextSegment } from "../lib/highlight";
import { issueKey } from "../lib/ai";
import {
  applyIssueDecorations,
  decoratedKeys,
  issueHighlightKey,
} from "../lib/issueHighlight";

/**
 * Pobiera Markdown z edytora. tiptap-markdown (pisany pod TipTap 2) nie dostarcza
 * deklaracji typów dla `storage.markdown` w v3, więc sięgamy po nią przez rzutowanie.
 */
function getMarkdown(editor: TiptapEditor): string {
  const storage = editor.storage as unknown as {
    markdown: { getMarkdown: () => string };
  };
  return storage.markdown.getMarkdown();
}

/* ------------------------------------------------------------------ */
/* Podświetlanie błędów fact-checku                                     */
/* ------------------------------------------------------------------ */

/**
 * Rozszerzenie podświetlające fragmenty zgłoszone przez fact-check (logika
 * dekoracji w `lib/issueHighlight.ts`).
 * Dekoracje ProseMirror NIE zmieniają dokumentu — podświetlenia nie brudzą
 * treści, historii undo ani autozapisu. Nowe wyniki wjeżdżają przez
 * tr.setMeta(issueHighlightKey, issues); przy zwykłej edycji istniejące
 * dekoracje są mapowane na nowe pozycje, a te ruszone przez użytkownika gasną
 * od razu — po przepisaniu zdania cytat modelu przestaje pasować do tekstu,
 * więc podświetlenie wskazywałoby na coś, czego już nie ma. Zgłoszenie zostaje
 * w panelu (przygaszone), bo sugestia przydaje się właśnie w trakcie poprawki.
 */
const IssueHighlight = Extension.create({
  name: "issueHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: issueHighlightKey,
        state: {
          init: () => DecorationSet.empty,
          apply: applyIssueDecorations,
        },
        props: {
          decorations(state) {
            return issueHighlightKey.getState(state);
          },
        },
      }),
    ];
  },
});

/* ------------------------------------------------------------------ */
/* Podświetlenie trafienia z wyszukiwarki                               */
/* ------------------------------------------------------------------ */

const searchRevealKey = new PluginKey<DecorationSet>("searchReveal");

/**
 * Znaczy miejsce, do którego przeskoczyła wyszukiwarka. Osobny plugin od
 * `IssueHighlight`, bo to podświetlenie jest chwilowe (gaśnie po kilku
 * sekundach) i nie ma nic wspólnego z wynikami fact-checku — trzymane razem
 * kasowałyby się nawzajem.
 */
const SearchReveal = Extension.create({
  name: "searchReveal",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: searchRevealKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) {
            const range = tr.getMeta(searchRevealKey) as { from: number; to: number } | null | undefined;
            if (range === null) return DecorationSet.empty;
            if (range) {
              return DecorationSet.create(tr.doc, [
                Decoration.inline(range.from, range.to, { class: "search-hl" }),
              ]);
            }
            return old.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return searchRevealKey.getState(state);
          },
        },
      }),
    ];
  },
});

/** Stan tooltipa nad podświetleniem. */
interface IssueTip {
  x: number;
  y: number;
  type: string;
  desc: string;
  sugg: string;
  /** Klucz zgłoszenia (`issueKey`) — po nim dymek wie, co zignorować. */
  key: string;
}

/** Klucze zgłoszeń, które mają teraz podświetlenie w dokumencie. */
function highlightedKeys(editor: TiptapEditor): Set<string> {
  return decoratedKeys(issueHighlightKey.getState(editor.state));
}

/**
 * Wyjście z cytatu (blockquote): naciśnięcie Enter na pustym akapicie wewnątrz
 * cytatu wyciąga akapit na zewnątrz. Dzięki temu "podwójny Enter" kończy cytat.
 */
const BlockquoteExit = Extension.create({
  name: "blockquoteExit",
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { $from, empty } = this.editor.state.selection;
        if (!empty) return false;
        const inBlockquote = $from.node(-1)?.type.name === "blockquote";
        const emptyParagraph =
          $from.parent.type.name === "paragraph" && $from.parent.content.size === 0;
        if (inBlockquote && emptyParagraph) {
          return this.editor.commands.liftEmptyBlock();
        }
        return false;
      },
    };
  },
});

export function Editor() {
  const project = useStore((s) => s.project);
  const active = useStore((s) => s.active);
  const activeRef = findRef(project, active);

  if (!active || !activeRef) {
    return (
      <div className="editor editor--empty">
        <p>Select a chapter or note from the left panel to begin.</p>
      </div>
    );
  }

  // `key` wymusza nową instancję edytora (i czystą historię undo) na każdy plik.
  return <FileEditor key={active.kind + ":" + active.id} title={activeRef.title} />;
}

function FileEditor({ title }: { title: string }) {
  const dirty = useStore((s) => s.dirty);
  const content = useStore((s) => s.content);
  const editorFont = useStore((s) => s.editorFont);
  const updateContent = useStore((s) => s.updateContent);
  const saveActive = useStore((s) => s.saveActive);
  const issues = useStore((s) => s.issues);
  const markIssuesEdited = useStore((s) => s.markIssuesEdited);
  const ignoreIssue = useStore((s) => s.ignoreIssue);
  const reveal = useStore((s) => s.reveal);
  const clearReveal = useStore((s) => s.clearReveal);

  // Tooltip nad podświetlonym błędem (null = ukryty).
  const [tip, setTip] = useState<IssueTip | null>(null);
  // Zgaszenie dymka jest opóźnione, żeby dało się przejechać myszą z tekstu
  // na dymek (dzieli je kilka pikseli odstępu) i kliknąć w nim „Ignore".
  const hideTip = useRef<number | null>(null);

  // Klucze zgłoszeń, które miały podświetlenie po ostatnim przeliczeniu.
  // Różnica po edycji mówi, które fragmenty ruszył użytkownik.
  const highlighted = useRef<Set<string>>(new Set());

  // Treść pliku w chwili montowania — selectFile wczytał ją do store przed
  // przełączeniem, więc to zawsze aktualna zawartość z dysku.
  const [initialContent] = useState(() => useStore.getState().content);

  const editor = useEditor({
    // Wyłączamy natychmiastowy render — w React 19 StrictMode (podwójny montaż)
    // gwarantuje to poprawną rejestrację skrótów klawiszowych (Ctrl+B, Ctrl+I, ...).
    immediatelyRender: false,
    editorProps: {
      // Natywny sprawdzacz pisowni webview (WKWebView na macOS, WebView2 na
      // Windows) korzysta ze słowników systemowych — zero bajtów w instalatorze
      // i zero zobowiązań licencyjnych. Ani ProseMirror, ani TipTap nie ustawiają
      // tego atrybutu, więc podajemy go sami.
      //
      // Świadomie BEZ atrybutu `lang`: wpisanie tu jednego języka przypięłoby
      // sprawdzanie do niego na stałe. Bez niego system rozpoznaje język tekstu
      // sam, więc rozdział po polsku i notatka po angielsku działają obok siebie.
      attributes: { spellcheck: "true" },
    },
    extensions: [
      StarterKit,
      BlockquoteExit,
      IssueHighlight,
      SearchReveal,
      Placeholder.configure({ placeholder: "Start writing…" }),
      CharacterCount,
      Markdown.configure({ html: false, transformPastedText: true }),
    ],
    content: initialContent,
    onUpdate: ({ editor }) => {
      updateContent(getMarkdown(editor));
      // Podświetlenia, które zgasły przy tej zmianie — plugin zdjął je już
      // z dokumentu, tu tylko dopisujemy to do zgłoszeń w panelu.
      const now = highlightedKeys(editor);
      const gone = [...highlighted.current].filter((k) => !now.has(k));
      if (gone.length) {
        highlighted.current = now;
        markIssuesEdited(gone);
      }
    },
  });

  // Przekaż wyniki weryfikacji do pluginu dekoracji (także pustą listę —
  // czyści podświetlenia po zmianie pliku albo zignorowaniu błędu).
  useEffect(() => {
    if (!editor) return;
    editor.view.dispatch(editor.state.tr.setMeta(issueHighlightKey, issues));
    highlighted.current = highlightedKeys(editor);
    setTip(null);
  }, [editor, issues]);

  // Skok do trafienia z wyszukiwarki: zaznacz fragment, przewiń do niego
  // i podświetl go na chwilę. Fragment pochodzi z Markdownu, a dokument edytora
  // ma już zdjęte znaczniki — cytat przecinający np. **pogrubienie** się nie
  // odnajdzie i wtedy zostaje samo otwarcie pliku.
  useEffect(() => {
    if (!editor) return;
    if (!reveal) {
      editor.view.dispatch(editor.state.tr.setMeta(searchRevealKey, null));
      return;
    }

    const segments: TextSegment[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text) segments.push({ text: node.text, pos });
      return true;
    });
    // Wybrane wystąpienie, a nie pierwsze z brzegu — inaczej kliknięcie drugiego
    // trafienia w tym samym rozdziale przewijało zawsze do pierwszego.
    // Numeracja w Markdownie i w dokumencie edytora może się rozjechać
    // (znaczniki formatowania), więc przy braku dopasowania wracamy do pierwszego.
    const ranges = findFragmentRanges(segments, reveal.text, { loose: true });
    const range = ranges[reveal.occurrence] ?? ranges[0];
    if (range) {
      // Kursor PRZED trafieniem, a nie zaznaczenie całego fragmentu: widoczność
      // daje dekoracja, a zaznaczenie znaczyłoby, że pierwszy wpisany znak
      // kasuje znalezione słowo.
      editor.chain().focus().setTextSelection(range.from).scrollIntoView().run();
      editor.view.dispatch(editor.state.tr.setMeta(searchRevealKey, range));
    }

    // Podświetlenie gaśnie przy pierwszym ruchu użytkownika — kliknięciu albo
    // klawiszu. Wcześniej znikało po odliczeniu czasu, więc gasło w losowym
    // momencie czytania; teraz trzyma się dokładnie tak długo, jak trzeba.
    //
    // Nasłuch wchodzi dopiero po najbliższej klatce, bo Enter wybierający wynik
    // NADAL propaguje: React obsługuje go na swoim kontenerze, a mikrotaski
    // (przełączenie pliku, render, ten efekt) wykonują się, zanim zdarzenie
    // dojdzie do `document`. Bez opóźnienia ten sam Enter gasił podświetlenie
    // w tej samej chwili, w której je zapalił.
    const dismiss = () => clearReveal();
    const frame = requestAnimationFrame(() => {
      document.addEventListener("mousedown", dismiss);
      document.addEventListener("keydown", dismiss);
    });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
  }, [editor, reveal, clearReveal]);

  // Autozapis: 800 ms po ostatniej zmianie.
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => void saveActive(), 800);
    return () => clearTimeout(t);
  }, [content, dirty, saveActive]);

  // Reaktywny odczyt liczników — odświeża się przy każdej zmianie dokumentu,
  // inaczej licznik zostaje w tyle (TipTap 3 nie re-renderuje komponentów sam).
  const counts = useEditorState({
    editor,
    selector: (ctx) => ({
      words: ctx.editor?.storage.characterCount.words() ?? 0,
      chars: ctx.editor?.storage.characterCount.characters() ?? 0,
    }),
  });

  const words = counts?.words ?? 0;
  const chars = counts?.chars ?? 0;

  // Szerokość dymka z CSS (.issue-tip max-width) — potrzebna, by nie wyszedł
  // poza prawą krawędź okna. Wysokość jest przybliżona i służy tylko decyzji,
  // czy dymek zmieści się pod fragmentem, czy ma iść nad niego.
  const TIP_WIDTH = 340;
  const TIP_MARGIN = 12;
  const TIP_HEIGHT = 150;
  // Czas na przejechanie myszą przez odstęp między tekstem a dymkiem.
  const TIP_HIDE_DELAY = 160;

  function cancelHide() {
    if (hideTip.current !== null) {
      clearTimeout(hideTip.current);
      hideTip.current = null;
    }
  }
  function scheduleHide() {
    cancelHide();
    hideTip.current = window.setTimeout(() => setTip(null), TIP_HIDE_DELAY);
  }

  // Tooltip przez delegację zdarzeń — dekoracje to zwykłe spany w DOM.
  function onMouseOver(e: React.MouseEvent) {
    const el = (e.target as HTMLElement).closest(".issue-hl");
    if (!(el instanceof HTMLElement)) return;
    cancelHide();
    const rect = el.getBoundingClientRect();
    // Przy prawej krawędzi dosuwamy dymek do środka okna zamiast go uciąć,
    // a gdy brakuje miejsca pod fragmentem — pokazujemy go nad nim.
    const x = Math.min(rect.left, window.innerWidth - TIP_WIDTH - TIP_MARGIN);
    const below = rect.bottom + 6;
    const fitsBelow = below + TIP_HEIGHT < window.innerHeight;
    setTip({
      x: Math.max(TIP_MARGIN, x),
      y: fitsBelow ? below : Math.max(TIP_MARGIN, rect.top - 6 - TIP_HEIGHT),
      type: el.dataset.issueType ?? "",
      desc: el.dataset.issueDesc ?? "",
      sugg: el.dataset.issueSugg ?? "",
      key: el.dataset.issueKey ?? "",
    });
  }
  function onMouseOut(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest(".issue-hl")) scheduleHide();
  }

  // „Ignore" prosto z dymka — ta sama akcja co na karcie w panelu, tylko bez
  // szukania zgłoszenia wzrokiem na liście.
  function ignoreFromTip(key: string) {
    const issue = issues.find((i) => issueKey(i) === key);
    cancelHide();
    setTip(null);
    if (issue) void ignoreIssue(issue);
  }

  // Odmontowanie w trakcie odliczania zostawiłoby timer wołający setState.
  useEffect(() => cancelHide, []);

  return (
    <div className={"editor editor--font-" + editorFont}>
      <EditorToolbar editor={editor} />
      {/* Pozycja dymka jest liczona raz, względem okna. Przewijanie kółkiem nie
          odpala mouseout (kursor zostaje nad tekstem), więc dymek zawisłby
          w oderwaniu od fragmentu — dlatego chowamy go przy każdym scrollu. */}
      <div
        className="editor__scroll"
        onMouseOver={onMouseOver}
        onMouseOut={onMouseOut}
        onScroll={() => setTip(null)}
      >
        <div className="editor__title">{title}</div>
        <EditorContent editor={editor} className="editor__content" />
      </div>
      {tip && (
        // Dymek jest najeżdżalny (nie znika, gdy mysz zejdzie na niego z tekstu)
        // — inaczej nie dałoby się kliknąć w nim „Ignore".
        <div
          className="issue-tip"
          style={{ left: tip.x, top: tip.y }}
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
        >
          <div className="issue-tip__head">
            <div className={"issue-tip__type issue-tip__type--" + tip.type}>{tip.type}</div>
            <button
              className="issue__ignore"
              title="Ignore this issue (won't be reported again)"
              onClick={() => ignoreFromTip(tip.key)}
            >
              Ignore
            </button>
          </div>
          <div className="issue-tip__desc">{tip.desc}</div>
          {tip.sugg && <div className="issue-tip__sugg">💡 {tip.sugg}</div>}
        </div>
      )}
      <div className="editor__status">
        <span>{words} words · {chars} characters</span>
        <span>{dirty ? "Saving…" : "Saved"}</span>
      </div>
    </div>
  );
}
