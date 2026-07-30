// Edytor tekstu oparty na TipTap z serializacją do Markdown.
// Źródłem prawdy treści jest store (pole `content`); zmiany użytkownika spływają
// do store i są autozapisywane z opóźnieniem.
//
// Każdy plik dostaje WŁASNĄ instancję edytora (komponent FileEditor z `key`
// po id pliku). Dzięki temu historia undo nie przecieka między plikami —
// bez tego Ctrl+Z po przełączeniu pliku mógłby wstrzyknąć treść poprzedniego
// pliku do bieżącego (i autozapis utrwaliłby to na dysku).

import { useEffect, useState } from "react";
import { useEditor, EditorContent, useEditorState } from "@tiptap/react";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import { Markdown } from "tiptap-markdown";
import { useStore, findRef } from "../store/useStore";
import { EditorToolbar } from "./EditorToolbar";
import { findFragmentRanges, type TextSegment } from "../lib/highlight";
import type { Issue } from "../lib/ai";

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

const issueHighlightKey = new PluginKey<DecorationSet>("issueHighlight");

/** Buduje dekoracje podświetleń z wyników weryfikacji. */
function buildIssueDecorations(doc: PMNode, issues: Issue[]): DecorationSet {
  // Zbierz węzły tekstowe dokumentu z ich pozycjami.
  const segments: TextSegment[] = [];
  doc.descendants((node, pos) => {
    if (node.isText && node.text) segments.push({ text: node.text, pos });
    return true;
  });

  const decorations: Decoration[] = [];
  for (const issue of issues) {
    for (const range of findFragmentRanges(segments, issue.fragment)) {
      decorations.push(
        Decoration.inline(range.from, range.to, {
          class: "issue-hl issue-hl--" + issue.type,
          "data-issue-type": issue.type,
          "data-issue-desc": issue.description,
          "data-issue-sugg": issue.suggestion,
        }),
      );
    }
  }
  return DecorationSet.create(doc, decorations);
}

/**
 * Rozszerzenie podświetlające fragmenty zgłoszone przez fact-check.
 * Dekoracje ProseMirror NIE zmieniają dokumentu — podświetlenia nie brudzą
 * treści, historii undo ani autozapisu. Nowe wyniki wjeżdżają przez
 * tr.setMeta(issueHighlightKey, issues); przy zwykłej edycji istniejące
 * dekoracje są mapowane na nowe pozycje.
 */
const IssueHighlight = Extension.create({
  name: "issueHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: issueHighlightKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) {
            const issues = tr.getMeta(issueHighlightKey) as Issue[] | undefined;
            if (issues !== undefined) return buildIssueDecorations(tr.doc, issues);
            return old.map(tr.mapping, tr.doc);
          },
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

/** Stan tooltipa nad podświetleniem. */
interface IssueTip {
  x: number;
  y: number;
  type: string;
  desc: string;
  sugg: string;
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

  // Tooltip nad podświetlonym błędem (null = ukryty).
  const [tip, setTip] = useState<IssueTip | null>(null);

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
      Placeholder.configure({ placeholder: "Start writing…" }),
      CharacterCount,
      Markdown.configure({ html: false, transformPastedText: true }),
    ],
    content: initialContent,
    onUpdate: ({ editor }) => {
      updateContent(getMarkdown(editor));
    },
  });

  // Przekaż wyniki weryfikacji do pluginu dekoracji (także pustą listę —
  // czyści podświetlenia po zmianie pliku albo zignorowaniu błędu).
  useEffect(() => {
    if (!editor) return;
    editor.view.dispatch(editor.state.tr.setMeta(issueHighlightKey, issues));
    setTip(null);
  }, [editor, issues]);

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

  // Tooltip przez delegację zdarzeń — dekoracje to zwykłe spany w DOM.
  function onMouseOver(e: React.MouseEvent) {
    const el = (e.target as HTMLElement).closest(".issue-hl");
    if (!(el instanceof HTMLElement)) return;
    const rect = el.getBoundingClientRect();
    setTip({
      x: rect.left,
      y: rect.bottom + 6,
      type: el.dataset.issueType ?? "",
      desc: el.dataset.issueDesc ?? "",
      sugg: el.dataset.issueSugg ?? "",
    });
  }
  function onMouseOut(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest(".issue-hl")) setTip(null);
  }

  return (
    <div className={"editor editor--font-" + editorFont}>
      <EditorToolbar editor={editor} />
      <div className="editor__scroll" onMouseOver={onMouseOver} onMouseOut={onMouseOut}>
        <div className="editor__title">{title}</div>
        <EditorContent editor={editor} className="editor__content" />
      </div>
      {tip && (
        <div className="issue-tip" style={{ left: tip.x, top: tip.y }}>
          <div className={"issue-tip__type issue-tip__type--" + tip.type}>{tip.type}</div>
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
