// Prawy panel: weryfikacja AI aktywnego rozdziału/dokumentu.
// Zbiera treść i notatki, wywołuje warstwę AI (na razie atrapę) i pokazuje wyniki.

import { useEffect, useState } from "react";
import { useStore, findRef } from "../store/useStore";
import { verifyText, type Issue, type IssueType, type VerifyUsage } from "../lib/ai";
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
  const addIssue = useStore((s) => s.addIssue);
  const ignoreIssue = useStore((s) => s.ignoreIssue);

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  // true = serwer odpowiedział danymi przykładowymi (działa bez klucza API).
  const [mockMode, setMockMode] = useState(false);
  // Zużycie tokenów ostatniej weryfikacji (brak w trybie atrapy).
  const [usage, setUsage] = useState<VerifyUsage | null>(null);
  // Podgląd ignorowanych błędów (cały projekt) — rozwijany na dole panelu.
  const [ignoredOpen, setIgnoredOpen] = useState(false);
  const [ignoredList, setIgnoredList] = useState<storage.IgnoredIssue[]>([]);

  // Przełączenie pliku musi wyczyścić CAŁE podsumowanie, nie tylko listę błędów
  // (tę czyści store). Bez tego po zmianie rozdziału zostawało „No issues found"
  // i licznik tokenów z poprzedniego pliku — dane, które już go nie dotyczą.
  useEffect(() => {
    setStatus("idle");
    setError(null);
    setUsage(null);
    setMockMode(false);
  }, [active?.kind, active?.id]);

  // Wczytaj listę przy otwarciu projektu (licznik na przycisku) i odświeżaj
  // po każdym Ignore/Restore.
  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    void storage.loadIgnoredIssues(project).then((list) => {
      if (!cancelled) setIgnoredList(list);
    });
    return () => {
      cancelled = true;
    };
  }, [project]);

  async function refreshIgnored() {
    if (!project) return;
    setIgnoredList(await storage.loadIgnoredIssues(project));
  }

  async function restoreIgnored(entry: storage.IgnoredIssue) {
    if (!project) return;
    setIgnoredList(await storage.removeIgnoredIssue(project, entry));
  }

  const activeRef = findRef(project, active);
  const canCheck = !!activeRef && status !== "checking";

  /** Czy plik, dla którego ruszyło sprawdzanie, jest nadal otwarty. */
  function isStillActive(startedFor: typeof active): boolean {
    const now = useStore.getState().active;
    return now?.kind === startedFor?.kind && now?.id === startedFor?.id;
  }

  async function handleVerify() {
    if (!project) return;
    setStatus("checking");
    setIssues([]);
    setError(null);
    // Plik, którego dotyczy to sprawdzenie — także dla bloku catch, więc musi
    // być poza try (użytkownik może w tym czasie przełączyć rozdział).
    const startedFor = active;
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
      // Ignorowane błędy tego pliku — filtrowane na bieżąco ze strumienia.
      const activeRefNow = findRef(project, active);
      const ignored = await storage.loadIgnoredIssues(project);
      const isIgnored = (issue: Issue) =>
        ignored.some(
          (e) =>
            e.file === activeRefNow?.file &&
            e.type === issue.type &&
            e.fragment === issue.fragment,
        );

      // Wyniki spływają strumieniem — każdy błąd trafia do store od razu
      // (panel i podświetlenia w edytorze rosną na żywo). Gdyby użytkownik
      // przełączył plik w trakcie, spóźnione wyniki nie mogą go zaśmiecić.
      const result = await verifyText({ text: content, notes, chapters }, (issue) => {
        const nowActive = useStore.getState().active;
        if (nowActive?.kind !== startedFor?.kind || nowActive?.id !== startedFor?.id) return;
        if (!isIgnored(issue)) addIssue(issue);
      });
      // Sprawdzenie mogło się skończyć już po przełączeniu pliku — wtedy jego
      // podsumowanie należy do poprzedniego rozdziału i nie może tu wjechać.
      const stillSameFile = isStillActive(startedFor);
      if (!stillSameFile) return;
      setMockMode(result.mock);
      setUsage(result.usage ?? null);
      setStatus("done");
    } catch (e) {
      if (!isStillActive(startedFor)) return;
      setError(String(e));
      setStatus("idle");
    }
  }

  return (
    <section className="verify">
      <div className="verify__head">
        <button className="verify__close" onClick={toggleVerify} title="Hide panel" aria-label="Hide fact-check panel">
          ›
        </button>
        <h3>Fact-check</h3>
        <button className="btn btn--primary btn--sm" disabled={!canCheck} onClick={handleVerify}>
          {status === "checking" ? "Checking…" : "Check text"}
        </button>
      </div>

      <div className="verify__note">
        Checks grammar, factual consistency with the other chapters and your notes, and whether the events hold together logically.
      </div>

      {/* aria-live: wyniki spływają strumieniem, więc czytnik ekranu musi je
          ogłaszać sam — nikt tu nie klika, żeby je „odkryć". */}
      <div className="verify__body" aria-live="polite" aria-busy={status === "checking"}>
        {error && <p className="verify__error">⚠ Verification failed: {error}</p>}
        {status === "idle" && !error && (
          <p className="verify__placeholder">
            Click "Check text" to analyze the current file.
          </p>
        )}
        {status === "checking" && issues.length === 0 && (
          <div className="verify__spinner-wrap">
            <span className="spinner" />
            <p className="verify__placeholder">Analyzing text…</p>
          </div>
        )}
        {status === "done" && issues.length === 0 && (
          <p className="verify__ok">✓ No issues found.</p>
        )}
        {issues.length > 0 &&
          issues.map((issue, i) => {
            const meta = TYPE_META[issue.type];
            return (
              <div key={i} className={"issue " + meta.className}>
                <div className="issue__head">
                  <div className="issue__type">{meta.label}</div>
                  <button
                    className="issue__ignore"
                    title="Ignore this issue (won't be reported again)"
                    onClick={() => void ignoreIssue(issue).then(refreshIgnored)}
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
        {status === "checking" && issues.length > 0 && (
          <p className="verify__streaming">
            <span className="spinner spinner--sm" /> Analyzing…
          </p>
        )}
      </div>

      <div className="verify__ignored">
        <button
          className="verify__ignored-toggle"
          onClick={() => setIgnoredOpen((v) => !v)}
        >
          {ignoredOpen ? "▾" : "▸"} Ignored issues ({ignoredList.length})
        </button>
        {ignoredOpen &&
          (ignoredList.length === 0 ? (
            <p className="verify__ignored-empty">Nothing ignored yet.</p>
          ) : (
            <div className="verify__ignored-list">
              {ignoredList.map((e, i) => (
                <div key={i} className="ignored-row">
                  <div className="ignored-row__main">
                    <span className={"ignored-row__type ignored-row__type--" + e.type}>
                      {e.type}
                    </span>
                    <span className="ignored-row__fragment">"{e.fragment}"</span>
                  </div>
                  <div className="ignored-row__meta">
                    <span className="ignored-row__file">{e.file}</span>
                    <button
                      className="issue__ignore"
                      title="Stop ignoring — it will be reported again on the next check"
                      onClick={() => void restoreIgnored(e)}
                    >
                      Restore
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}
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
