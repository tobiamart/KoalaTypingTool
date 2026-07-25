// Ekran startowy: tworzenie nowego projektu, otwieranie istniejącego,
// lista ostatnio używanych projektów.

import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useStore } from "../store/useStore";

export function StartScreen() {
  const { recent, newProject, openFolder, error, clearError } = useStore();
  // Czy pokazujemy formularz nowego projektu (zamiast kafelków startowych).
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");

  async function handleCreate() {
    if (!title.trim()) return;
    const parent = await open({ directory: true, title: "Choose project location" });
    if (!parent || Array.isArray(parent)) return;
    await newProject(parent, title.trim());
  }

  async function handleOpen() {
    const folder = await open({ directory: true, title: "Open project folder" });
    if (!folder || Array.isArray(folder)) return;
    await openFolder(folder);
  }

  return (
    <div className="start">
      <div className="start__inner">
        <header className="start__header">
          <div className="start__logo">🐨</div>
          <h1>Koala</h1>
          <p className="start__tagline">Fact-checking writing tool</p>
        </header>

        {error && (
          <div className="banner banner--error" onClick={clearError}>
            {error} <span className="banner__dismiss">✕</span>
          </div>
        )}

        {!creating ? (
          <div className="start__actions">
            <button className="tile" onClick={() => setCreating(true)}>
              <span className="tile__icon">📚</span>
              <span className="tile__title">New project</span>
              <span className="tile__desc">Chapters and author's notes, stored as Markdown</span>
            </button>
            <button className="tile tile--ghost" onClick={handleOpen}>
              <span className="tile__icon">📂</span>
              <span className="tile__title">Open project</span>
              <span className="tile__desc">Load an existing project folder</span>
            </button>
          </div>
        ) : (
          <div className="start__form">
            <h2>New project</h2>
            <label className="field">
              <span>Title</span>
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                placeholder="e.g. Northern Chronicles"
              />
            </label>
            <p className="hint">
              You'll pick a folder where a project subfolder with Markdown files will be created.
            </p>
            <div className="start__form-actions">
              <button className="btn btn--ghost" onClick={() => { setCreating(false); setTitle(""); }}>
                Back
              </button>
              <button className="btn btn--primary" disabled={!title.trim()} onClick={handleCreate}>
                Create and choose location
              </button>
            </div>
          </div>
        )}

        {recent.length > 0 && !creating && (
          <section className="recent">
            <h3>Recent projects</h3>
            <ul>
              {recent.map((r) => (
                <li key={r.path}>
                  <button className="recent__item" onClick={() => openFolder(r.path)}>
                    <span className="recent__icon">📚</span>
                    <span className="recent__meta">
                      <span className="recent__title">{r.title}</span>
                      <span className="recent__path">{r.path}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
