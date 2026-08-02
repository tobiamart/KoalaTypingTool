// Pasek narzędzi formatowania dla edytora TipTap.
// useEditorState sprawia, że przyciski odświeżają swój stan (aktywny/nieaktywny)
// natychmiast po zmianie formatowania — także po skrócie klawiszowym (Ctrl+B),
// zanim użytkownik zacznie pisać.

import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { useStore } from "../store/useStore";

interface Props {
  editor: Editor | null;
}

export function EditorToolbar({ editor }: Props) {
  const verifyOpen = useStore((s) => s.verifyOpen);
  const toggleVerify = useStore((s) => s.toggleVerify);

  const state = useEditorState({
    editor,
    selector: (ctx) => {
      const e = ctx.editor;
      return {
        isH1: e?.isActive("heading", { level: 1 }) ?? false,
        isH2: e?.isActive("heading", { level: 2 }) ?? false,
        isH3: e?.isActive("heading", { level: 3 }) ?? false,
        isBold: e?.isActive("bold") ?? false,
        isItalic: e?.isActive("italic") ?? false,
        isStrike: e?.isActive("strike") ?? false,
        isBullet: e?.isActive("bulletList") ?? false,
        isOrdered: e?.isActive("orderedList") ?? false,
        isQuote: e?.isActive("blockquote") ?? false,
        canUndo: e?.can().undo() ?? false,
        canRedo: e?.can().redo() ?? false,
      };
    },
  });

  if (!editor || !state) return null;

  const btn = (active: boolean) => "tbtn" + (active ? " tbtn--active" : "");

  return (
    <div className="toolbar">
      <button
        className={btn(state.isH1)}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        title="Heading 1"
      >
        H1
      </button>
      <button
        className={btn(state.isH2)}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        title="Heading 2"
      >
        H2
      </button>
      <button
        className={btn(state.isH3)}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        title="Heading 3"
      >
        H3
      </button>
      <span className="toolbar__sep" />
      <button
        className={btn(state.isBold)}
        onClick={() => editor.chain().focus().toggleBold().run()}
        title="Bold (Ctrl+B)"
      >
        <b>B</b>
      </button>
      <button
        className={btn(state.isItalic)}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="Italic (Ctrl+I)"
      >
        <i>I</i>
      </button>
      <button
        className={btn(state.isStrike)}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        title="Strikethrough"
      >
        <s>S</s>
      </button>
      <span className="toolbar__sep" />
      <button
        className={btn(state.isBullet)}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        title="Bullet list"
      >
        • List
      </button>
      <button
        className={btn(state.isOrdered)}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        title="Numbered list"
      >
        1. List
      </button>
      <button
        className={btn(state.isQuote)}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        title="Quote"
      >
        ❝ Quote
      </button>
      <span className="toolbar__sep" />
      <button
        className="tbtn"
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!state.canUndo}
        title="Undo (Ctrl+Z)"
        aria-label="Undo"
      >
        ↶
      </button>
      <button
        className="tbtn"
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!state.canRedo}
        title="Redo (Ctrl+Y)"
        aria-label="Redo"
      >
        ↷
      </button>

      <button
        className={"tbtn tbtn--check" + (verifyOpen ? " tbtn--active" : "")}
        onClick={toggleVerify}
        title="Fact-check"
      >
        ✓ Fact-check
      </button>
    </div>
  );
}
