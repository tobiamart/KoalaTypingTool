# Koala 🐨

Fact-checking writing tool — a desktop app for writing long-form, chaptered text
(books, papers) with AI-assisted verification of grammar, consistency, and logic.

Built with **Tauri 2**, **React 19**, **TypeScript**, and **TipTap**. Your content
is stored as plain **Markdown files on disk** — you own your data, no lock-in.

## Project layout

- `app/src` — React frontend (editor, sidebar, verification panel)
- `app/src-tauri` — Tauri (Rust) shell: window, plugins, permissions
- `server/` — AI proxy (Cloudflare Worker + Hono); holds the API key,
  the desktop app never sees it. Runs locally via `wrangler dev`
- Each writing project is a folder with `project.json`, `chapters/*.md`, `notes/*.md`

## Development

Requirements: Node.js, Rust (MSVC toolchain on Windows), VS Build Tools 2022.

On Windows, use the double-click scripts in the repo root:

- `dev.bat` — run the app in development mode (hot reload)
- `build.bat` — build the release installers
- `server-dev.bat` — run the local AI proxy server (http://localhost:8787);
  without an API key in `server/.dev.vars` it returns sample (mock) results

Or manually:

```
cd app
npm install
npm run tauri dev     # development
npm run tauri build   # release installers
npm test              # unit tests (vitest)
```

## Status

Work in progress. The app calls the proxy in `server/` for AI verification;
the Anthropic API key lives only on the server (locally in `server/.dev.vars`,
in production as a Cloudflare secret) and never ships inside the app.
See `TODO.md` for the roadmap.
