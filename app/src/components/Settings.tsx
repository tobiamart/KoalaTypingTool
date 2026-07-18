// Okno ustawień aplikacji (modal). Na razie: wybór czcionki obszaru pisania.
// Kolejne opcje można dokładać jako następne sekcje.

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

  if (!settingsOpen) return null;

  return (
    <div className="modal" onClick={toggleSettings}>
      <div className="modal__panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>Settings</h2>
          <button className="modal__close" onClick={toggleSettings} title="Close">
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
