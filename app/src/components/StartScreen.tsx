// Ekran startowy: wybór typu nowego projektu, otwieranie istniejącego,
// lista ostatnio używanych projektów.

import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useStore } from "../store/useStore";
import type { ProjectType } from "../types";

export function StartScreen() {
  const { recent, newProject, openFolder, error, clearError } = useStore();
  const [mode, setMode] = useState<ProjectType | null>(null);
  const [title, setTitle] = useState("");

  async function handleCreate() {
    if (!mode || !title.trim()) return;
    const parent = await open({ directory: true, title: "Choose project location" });
    if (!parent || Array.isArray(parent)) return;
    await newProject(parent, title.trim(), mode);
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

        {mode === null ? (
          <div className="start__actions">
            <button className="tile" onClick={() => setMode("book")}>
              <span className="tile__icon">📚</span>
              <span className="tile__title">New book</span>
              <span className="tile__desc">Multiple chapters, each a separate file</span>
            </button>
            <button className="tile" onClick={() => setMode("document")}>
              <span className="tile__icon">📄</span>
              <span className="tile__title">New document</span>
              <span className="tile__desc">A single text, e.g. a research paper</span>
            </button>
            <button className="tile tile--ghost" onClick={handleOpen}>
              <span className="tile__icon">📂</span>
              <span className="tile__title">Open project</span>
              <span className="tile__desc">Load an existing project folder</span>
            </button>
          </div>
        ) : (
          <div className="start__form">
            <h2>{mode === "book" ? "New book" : "New document"}</h2>
            <label className="field">
              <span>Title</span>
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                placeholder={mode === "book" ? "e.g. Northern Chronicles" : "e.g. Labor Market Analysis"}
              />
            </label>
            <p className="hint">
              You'll pick a folder where a project subfolder with Markdown files will be created.
            </p>
            <div className="start__form-actions">
              <button className="btn btn--ghost" onClick={() => { setMode(null); setTitle(""); }}>
                Back
              </button>
              <button className="btn btn--primary" disabled={!title.trim()} onClick={handleCreate}>
                Create and choose location
              </button>
            </div>
          </div>
        )}

        {recent.length > 0 && mode === null && (
          <section className="recent">
            <h3>Recent projects</h3>
            <ul>
              {recent.map((r) => (
                <li key={r.path}>
                  <button className="recent__item" onClick={() => openFolder(r.path)}>
                    <span className="recent__icon">{r.type === "book" ? "📚" : "📄"}</span>
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
