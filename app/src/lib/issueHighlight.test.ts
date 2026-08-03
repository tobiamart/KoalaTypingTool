// Testy podświetleń fact-checku na samym stanie ProseMirror (bez DOM-u):
// interesuje nas, kiedy podświetlenie ma zgasnąć, a kiedy przetrwać edycję.

import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, Plugin } from "@tiptap/pm/state";
import { DecorationSet } from "@tiptap/pm/view";
import {
  applyIssueDecorations,
  decoratedKeys,
  issueHighlightKey,
} from "./issueHighlight";
import type { TrackedIssue } from "./ai";

// Minimalny schemat: akapity z tekstem wystarczą do sprawdzenia zakresów.
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*", toDOM: () => ["p", 0] },
    text: {},
  },
});

function issue(fragment: string, extra: Partial<TrackedIssue> = {}): TrackedIssue {
  return {
    type: "consistency",
    fragment,
    description: "opis",
    suggestion: "sugestia",
    ...extra,
  };
}

/** Stan z wpiętym pluginem podświetleń i jednym akapitem tekstu. */
function makeState(text: string): EditorState {
  const doc = schema.node("doc", null, [schema.node("paragraph", null, [schema.text(text)])]);
  return EditorState.create({
    doc,
    plugins: [
      new Plugin<DecorationSet>({
        key: issueHighlightKey,
        state: { init: () => DecorationSet.empty, apply: applyIssueDecorations },
      }),
    ],
  });
}

/** Podaje zgłoszenia do pluginu (tak jak robi to Editor.tsx po weryfikacji). */
function withIssues(state: EditorState, issues: TrackedIssue[]): EditorState {
  return state.apply(state.tr.setMeta(issueHighlightKey, issues));
}

function decorations(state: EditorState) {
  return issueHighlightKey.getState(state)?.find() ?? [];
}

// Tekst testowy: "The quick brown fox jumps" zaczyna się na pozycji 1
// (0 to początek akapitu), więc "brown" leży na 11–16, a "fox" na 17–20.
const TEXT = "The quick brown fox jumps";

describe("podświetlenia fact-checku", () => {
  it("podświetla cytowany fragment", () => {
    const state = withIssues(makeState(TEXT), [issue("brown fox")]);
    expect(decorations(state)).toHaveLength(1);
    expect(decoratedKeys(issueHighlightKey.getState(state))).toEqual(
      new Set(["consistency|brown fox"]),
    );
  });

  it("gasi podświetlenie po edycji wewnątrz fragmentu", () => {
    const state = withIssues(makeState(TEXT), [issue("brown fox")]);
    const edited = state.apply(state.tr.insertText("!", 13));
    expect(decorations(edited)).toHaveLength(0);
  });

  it("gasi podświetlenie po skasowaniu części fragmentu", () => {
    const state = withIssues(makeState(TEXT), [issue("brown fox")]);
    // Usunięcie ostatniej litery cytatu ("fox" → "fo").
    const edited = state.apply(state.tr.delete(19, 20));
    expect(decorations(edited)).toHaveLength(0);
  });

  it("gasi podświetlenie po dopisaniu litery tuż na granicy fragmentu", () => {
    const state = withIssues(makeState(TEXT), [issue("brown fox")]);
    // Kursor na końcu "fox" — dopisana litera zmienia cytowane słowo.
    const edited = state.apply(state.tr.insertText("y", 20));
    expect(decorations(edited)).toHaveLength(0);
  });

  it("zostawia podświetlenie przy edycji w innym miejscu akapitu", () => {
    const state = withIssues(makeState(TEXT), [issue("brown fox")]);
    const edited = state.apply(state.tr.insertText("Very ", 1));
    expect(decorations(edited)).toHaveLength(1);
    // Zakres jedzie razem z tekstem: pięć dopisanych znaków przesuwa go w prawo.
    expect(decorations(edited)[0].from).toBe(16);
  });

  it("gasi tylko ruszone wystąpienie, gdy cytat powtarza się w tekście", () => {
    const state = withIssues(makeState("kot i kot"), [issue("kot")]);
    expect(decorations(state)).toHaveLength(2);
    // Edycja pierwszego "kot" (pozycje 1–4).
    const edited = state.apply(state.tr.insertText("y", 4));
    const left = decorations(edited);
    expect(left).toHaveLength(1);
    expect(left[0].from).toBe(8);
  });

  it("nie podświetla zgłoszeń oznaczonych jako edytowane", () => {
    // Fragment nadal jest w tekście, ale użytkownik już go ruszył — flaga
    // trzyma podświetlenie zgaszone także po przeliczeniu listy zgłoszeń.
    const state = withIssues(makeState(TEXT), [issue("brown fox", { edited: true })]);
    expect(decorations(state)).toHaveLength(0);
  });

  it("nie rusza podświetleń przy transakcji bez zmiany dokumentu", () => {
    const state = withIssues(makeState(TEXT), [issue("brown fox")]);
    const scrolled = state.apply(state.tr.scrollIntoView());
    expect(decorations(scrolled)).toHaveLength(1);
  });
});
