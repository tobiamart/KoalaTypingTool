// Edytor tekstu oparty na TipTap z serializacją do Markdown.
// Źródłem prawdy treści jest store (pole `content`); edytor synchronizuje się
// z nim przy zmianie aktywnego pliku, a zmiany użytkownika spływają z powrotem
// do store i są autozapisywane z opóźnieniem.

import { useEffect } from "react";
import { useEditor, EditorContent, useEditorState } from "@tiptap/react";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import { Markdown } from "tiptap-markdown";
import { useStore, findRef } from "../store/useStore";
import { EditorToolbar } from "./EditorToolbar";

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
  const dirty = useStore((s) => s.dirty);
  const content = useStore((s) => s.content);
  const editorFont = useStore((s) => s.editorFont);
  const updateContent = useStore((s) => s.updateContent);
  const saveActive = useStore((s) => s.saveActive);

  const activeRef = findRef(project, active);

  const editor = useEditor({
    // Wyłączamy natychmiastowy render — w React 19 StrictMode (podwójny montaż)
    // gwarantuje to poprawną rejestrację skrótów klawiszowych (Ctrl+B, Ctrl+I, ...).
    immediatelyRender: false,
    extensions: [
      StarterKit,
      BlockquoteExit,
      Placeholder.configure({ placeholder: "Start writing…" }),
      CharacterCount,
      Markdown.configure({ html: false, transformPastedText: true }),
    ],
    content: "",
    onUpdate: ({ editor }) => {
      updateContent(getMarkdown(editor));
    },
  });

  // Wczytaj treść do edytora przy zmianie aktywnego pliku (bez emitowania update).
  useEffect(() => {
    if (!editor) return;
    const md = useStore.getState().content;
    editor.commands.setContent(md, { emitUpdate: false });
  }, [editor, active?.kind, active?.id]);

  // Autozapis: 800 ms po ostatniej zmianie.
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => void saveActive(), 800);
    return () => clearTimeout(t);
  }, [content, dirty, saveActive]);

  // Reaktywny odczyt liczników — odświeża się przy każdej zmianie dokumentu,
  // także po przełączeniu pliku (setContent), inaczej licznik zostaje w tyle.
  const counts = useEditorState({
    editor,
    selector: (ctx) => ({
      words: ctx.editor?.storage.characterCount.words() ?? 0,
      chars: ctx.editor?.storage.characterCount.characters() ?? 0,
    }),
  });

  if (!activeRef) {
    return (
      <div className="editor editor--empty">
        <p>Select a chapter or note from the left panel to begin.</p>
      </div>
    );
  }

  const words = counts?.words ?? 0;
  const chars = counts?.chars ?? 0;

  return (
    <div className={"editor editor--font-" + editorFont}>
      <EditorToolbar editor={editor} />
      <div className="editor__scroll">
        <div className="editor__title">{activeRef.title}</div>
        <EditorContent editor={editor} className="editor__content" />
      </div>
      <div className="editor__status">
        <span>{words} words · {chars} characters</span>
        <span>{dirty ? "Saving…" : "Saved"}</span>
      </div>
    </div>
  );
}
