# Koala 🐨

Fact-checking writing tool — a desktop app for writing long-form, chaptered text
(books, papers) with AI-assisted verification of grammar, consistency, and logic.

Built with **Tauri 2**, **React 19**, **TypeScript**, and **TipTap**. Your content
is stored as plain **Markdown files on disk** — you own your data, no lock-in.

## Project layout

- `app/src` — React frontend (editor, sidebar, verification panel)
- `app/src-tauri` — Tauri (Rust) shell: window, plugins, permissions
- Each writing project is a folder with `project.json`, `chapters/*.md`, `notes/*.md`

## Development

Requirements: Node.js, Rust (MSVC toolchain on Windows), VS Build Tools 2022.

On Windows, use the double-click scripts in the repo root:

- `dev.bat` — run in development mode (hot reload)
- `build.bat` — build the release installers

Or manually:

```
cd app
npm install
npm run tauri dev     # development
npm run tauri build   # release installers
npm test              # unit tests (vitest)
```

## Status

Work in progress. The AI verification layer is currently a mock
(`app/src/lib/ai.ts`) — it will call a proxy server that holds the API key
(the key never ships inside the app). See `TODO.md` for the roadmap.
