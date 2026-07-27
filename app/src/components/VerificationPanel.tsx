// Prawy panel: weryfikacja AI aktywnego rozdziału/dokumentu.
// Zbiera treść i notatki, wywołuje warstwę AI (na razie atrapę) i pokazuje wyniki.

import { useState } from "react";
import { useStore, findRef } from "../store/useStore";
import { verifyText, type IssueType, type VerifyUsage } from "../lib/ai";
import * as storage from "../lib/storage";

/** Formatuje liczbę tokenów zwięźle: 850, 1.2k, 15k. */
function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return (k < 10 ? k.toFixed(1) : Math.round(k).toString()) + "k";
}

type Status = "idle" | "checking" | "done";

const TYPE_META: Record<IssueType, { label: string; className: string }> = {
  grammar: { label: "Grammar", className: "issue--grammar" },
  consistency: { label: "Consistency", className: "issue--consistency" },
  logic: { label: "Logic", className: "issue--logic" },
};

export function VerificationPanel() {
  const project = useStore((s) => s.project);
  const active = useStore((s) => s.active);
  const content = useStore((s) => s.content);
  const toggleVerify = useStore((s) => s.toggleVerify);
  // Wyniki żyją w store — edytor podświetla z nich fragmenty.
  const issues = useStore((s) => s.issues);
  const setIssues = useStore((s) => s.setIssues);
  const ignoreIssue = useStore((s) => s.ignoreIssue);

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  // true = serwer odpowiedział danymi przykładowymi (działa bez klucza API).
  const [mockMode, setMockMode] = useState(false);
  // Zużycie tokenów ostatniej weryfikacji (brak w trybie atrapy).
  const [usage, setUsage] = useState<VerifyUsage | null>(null);

  const activeRef = findRef(project, active);
  const canCheck = !!activeRef && status !== "checking";

  async function handleVerify() {
    if (!project) return;
    setStatus("checking");
    setIssues([]);
    setError(null);
    // Błąd (odczyt notatki, w przyszłości sieć do serwera proxy) nie może
    // zostawić panelu w wiecznym stanie "Checking…".
    try {
      // Zbierz notatki autora jako kontekst dla AI.
      const notes: { title: string; content: string }[] = [];
      for (const n of project.notes) {
        notes.push({ title: n.title, content: await storage.readFile(project, n) });
      }
      // Zbierz pozostałe rozdziały jako kontekst spójności (bez weryfikowanego).
      const chapters: { title: string; content: string }[] = [];
      for (const ch of project.chapters) {
        if (active?.kind === "chapter" && ch.id === active.id) continue;
        chapters.push({ title: ch.title, content: await storage.readFile(project, ch) });
      }
      const result = await verifyText({ text: content, notes, chapters });
      // Odfiltruj błędy, które użytkownik wcześniej zignorował w tym pliku.
      const activeRefNow = findRef(project, active);
      const ignored = await storage.loadIgnoredIssues(project);
      const visible = result.issues.filter(
        (issue) =>
          !ignored.some(
            (e) =>
              e.file === activeRefNow?.file &&
              e.type === issue.type &&
              e.fragment === issue.fragment,
          ),
      );
      setIssues(visible);
      setMockMode(result.mock);
      setUsage(result.usage ?? null);
      setStatus("done");
    } catch (e) {
      setError(String(e));
      setStatus("idle");
    }
  }

  return (
    <section className="verify">
      <div className="verify__head">
        <button className="verify__close" onClick={toggleVerify} title="Hide panel">
          ›
        </button>
        <h3>Fact-check</h3>
        <button className="btn btn--primary btn--sm" disabled={!canCheck} onClick={handleVerify}>
          {status === "checking" ? "Checking…" : "Check text"}
        </button>
      </div>

      <div className="verify__note">
        Checks grammar, consistency with the other chapters, and logical alignment with the author's notes.
      </div>

      <div className="verify__body">
        {error && <p className="verify__error">⚠ Verification failed: {error}</p>}
        {status === "idle" && !error && (
          <p className="verify__placeholder">
            Click "Check text" to analyze the current file.
          </p>
        )}
        {status === "checking" && <p className="verify__placeholder">Analyzing text…</p>}
        {status === "done" && issues.length === 0 && (
          <p className="verify__ok">✓ No issues found.</p>
        )}
        {status === "done" &&
          issues.map((issue, i) => {
            const meta = TYPE_META[issue.type];
            return (
              <div key={i} className={"issue " + meta.className}>
                <div className="issue__head">
                  <div className="issue__type">{meta.label}</div>
                  <button
                    className="issue__ignore"
                    title="Ignore this issue (won't be reported again)"
                    onClick={() => void ignoreIssue(issue)}
                  >
                    Ignore
                  </button>
                </div>
                <div className="issue__fragment">"{issue.fragment}"</div>
                <div className="issue__desc">{issue.description}</div>
                <div className="issue__suggestion">💡 {issue.suggestion}</div>
              </div>
            );
          })}
      </div>

      {status === "done" && usage && (
        <div className="verify__usage">
          Tokens: {fmtTokens(usage.cacheRead)} cached · {fmtTokens(usage.input + usage.cacheWrite)} in · {fmtTokens(usage.output)} out
        </div>
      )}

      {status === "done" && mockMode && (
        <div className="verify__disclaimer">
          ⚠️ The server is running without an API key — results are sample data.
        </div>
      )}
    </section>
  );
}
