// Dekoracje podświetlające fragmenty zgłoszone przez fact-check.
//
// Osobno od Editor.tsx, bo to warstwa ProseMirror bez Reacta i bez store'u —
// da się ją przetestować na samym EditorState, bez DOM-u (testy w
// `issueHighlight.test.ts`). Sam plugin wpina Editor.tsx.

import { PluginKey } from "@tiptap/pm/state";
import type { Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { findFragmentRanges, type TextSegment } from "./highlight";
import { issueKey, type TrackedIssue } from "./ai";

/** Klucz pluginu — po nim Editor.tsx wysyła nowe wyniki (`tr.setMeta`)
 *  i czyta bieżący zbiór dekoracji. */
export const issueHighlightKey = new PluginKey<DecorationSet>("issueHighlight");

/** Buduje dekoracje podświetleń z wyników weryfikacji.
 *  Zgłoszenia dotknięte edycją pomijamy — cytat opisuje tekst, którego już nie
 *  ma, więc podświetlenie nie ma czego wskazywać (patrz `edited` w lib/ai.ts). */
export function buildIssueDecorations(doc: PMNode, issues: TrackedIssue[]): DecorationSet {
  // Zbierz węzły tekstowe dokumentu z ich pozycjami.
  const segments: TextSegment[] = [];
  doc.descendants((node, pos) => {
    if (node.isText && node.text) segments.push({ text: node.text, pos });
    return true;
  });

  const decorations: Decoration[] = [];
  for (const issue of issues) {
    if (issue.edited) continue;
    for (const range of findFragmentRanges(segments, issue.fragment)) {
      decorations.push(
        Decoration.inline(
          range.from,
          range.to,
          {
            class: "issue-hl issue-hl--" + issue.type,
            "data-issue-type": issue.type,
            "data-issue-desc": issue.description,
            "data-issue-sugg": issue.suggestion,
            "data-issue-key": issueKey(issue),
          },
          // Klucz w specyfikacji, nie tylko w DOM: po nim rozpoznajemy, które
          // zgłoszenia straciły podświetlenie przy edycji.
          { issueKey: issueKey(issue) },
        ),
      );
    }
  }
  return DecorationSet.create(doc, decorations);
}

/**
 * Dekoracje, których dotknęła ta transakcja. Krok po kroku bierzemy zmienione
 * zakresy i przeliczamy je na pozycje w dokumencie po zmianie; `find` traktuje
 * krańce włącznie, więc liczy się też dopisanie tuż przy granicy fragmentu
 * (dopisana litera na końcu cytowanego słowa to nadal edycja tego słowa).
 */
export function touchedDecorations(set: DecorationSet, tr: Transaction): Decoration[] {
  const hits: Decoration[] = [];
  tr.mapping.maps.forEach((map, i) => {
    const rest = tr.mapping.slice(i + 1);
    map.forEach((_fromA, _toA, fromB, toB) => {
      hits.push(...set.find(rest.map(fromB, -1), rest.map(toB, 1)));
    });
  });
  return hits;
}

/** Nowy zbiór dekoracji po transakcji: pozycje przemapowane, a podświetlenia
 *  ruszone przez użytkownika zgaszone. Kolejność argumentów jak w `StateField`
 *  ProseMirror, żeby dało się to podstawić wprost jako `apply`. */
export function applyIssueDecorations(tr: Transaction, set: DecorationSet): DecorationSet {
  const issues = tr.getMeta(issueHighlightKey) as TrackedIssue[] | undefined;
  if (issues !== undefined) return buildIssueDecorations(tr.doc, issues);
  const mapped = set.map(tr.mapping, tr.doc);
  if (!tr.docChanged) return mapped;
  const touched = touchedDecorations(mapped, tr);
  return touched.length ? mapped.remove(touched) : mapped;
}

/** Klucze zgłoszeń, które mają teraz podświetlenie w dokumencie. */
export function decoratedKeys(set: DecorationSet | undefined): Set<string> {
  const keys = new Set<string>();
  for (const deco of set?.find() ?? []) {
    const key = (deco.spec as { issueKey?: string }).issueKey;
    if (key) keys.add(key);
  }
  return keys;
}
