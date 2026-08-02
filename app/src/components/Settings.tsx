// Okno ustawień aplikacji (modal). Na razie: wybór czcionki obszaru pisania.
// Kolejne opcje można dokładać jako następne sekcje.

import { useEffect, useRef } from "react";
import { useStore } from "../store/useStore";
import type { FontChoice } from "../types";

const FONTS: { value: FontChoice; label: string; sample: string; family: string }[] = [
  { value: "sans", label: "Sans-serif", sample: "Ag", family: "var(--font-sans)" },
  { value: "serif", label: "Serif", sample: "Ag", family: "var(--font-serif)" },
  { value: "mono", label: "Monospace", sample: "Ag", family: "var(--font-mono)" },
];

export function Settings() {
  const settingsOpen = useStore((s) => s.settingsOpen);
  const toggleSettings = useStore((s) => s.toggleSettings);
  const editorFont = useStore((s) => s.editorFont);
  const setEditorFont = useStore((s) => s.setEditorFont);

  const panelRef = useRef<HTMLDivElement>(null);

  // Escape zamyka okno, Tab krąży wewnątrz panelu, a po zamknięciu focus wraca
  // tam, skąd przyszedł. Bez tego klawiatura po zamknięciu lądowała na początku
  // strony, a jedynym wyjściem z modala była mysz.
  useEffect(() => {
    if (!settingsOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        toggleSettings();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    panelRef.current?.querySelector<HTMLElement>("button")?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [settingsOpen, toggleSettings]);

  if (!settingsOpen) return null;

  return (
    <div className="modal" onClick={toggleSettings}>
      <div
        className="modal__panel"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__head">
          <h2 id="settings-title">Settings</h2>
          <button
            className="modal__close"
            onClick={toggleSettings}
            title="Close"
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        <div className="settings__section">
          <div className="settings__label">Editor font</div>
          <div className="fontpick">
            {FONTS.map((f) => (
              <button
                key={f.value}
                className={"fontpick__opt" + (editorFont === f.value ? " fontpick__opt--active" : "")}
                onClick={() => setEditorFont(f.value)}
              >
                <span className="fontpick__sample" style={{ fontFamily: f.family }}>
                  {f.sample}
                </span>
                <span className="fontpick__name">{f.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
