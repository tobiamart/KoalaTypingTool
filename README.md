# Narwhal

A desktop writing app for long-form, chaptered text — books, theses, papers —
with AI-assisted verification of what you wrote.

Writing tools usually check spelling and grammar. The harder problems in a long
manuscript are elsewhere: a date that contradicts your notes, a lantern that was
extinguished two chapters ago and is burning again, a sequence of events that
cannot physically happen. Narwhal checks the chapter you are working on against
your other chapters and your author notes, and reports what does not add up.

## What it does

- **Chaptered projects** — a project is a folder of chapters plus author notes
  (world description, characters, bibliography). Reorder chapters by dragging.
- **Fact-checking on demand** — one button sends the current chapter, the other
  chapters and the notes for verification. Findings arrive one by one as the
  model produces them, not in a batch at the end.
- **Three categories of finding** — `consistency` (a fact contradicting the rest
  of the material), `logic` (impossible sequences, broken rules of the world),
  and `grammar`. Categorised by the nature of the problem, not by where the
  contradicting fact came from.
- **Findings shown in place** — each one underlines the quoted fragment in the
  editor and appears as a card in a side panel, with a description and a
  suggestion. Editing a fragment clears its highlight immediately.
- **Dismissing findings** — anything you disagree with can be ignored; ignored
  findings are stored per project and can be restored later.
- **Full-text search** — ⌘K / Ctrl+K across chapter and note titles and content,
  diacritic- and case-insensitive, jumping to the occurrence in the editor.
- **Native spell checking** — uses the system dictionaries through the webview,
  so it follows whatever languages your OS has installed.
- **Answers in the language you write in** — the language is detected per
  chapter, so an English chapter gets English feedback even when the author
  notes are written in another language.

## How your text is stored

Plain **Markdown files on disk**, not a database. A project is an ordinary
folder:

```
my-book/
  project.json         manifest: title, chapter order, note list
  chapters/*.md
  notes/*.md
  ignored-issues.json  findings you dismissed
```

You can open, edit, back up, version or move these files with any other tool.
There is no proprietary format and nothing to export.

## Tech stack

- **Tauri 2** (Rust shell) + **React 19** + **TypeScript** + **Vite 7**
- **TipTap 3** as the editor, serialising to Markdown
- **Zustand** for state; editor and layout preferences in localStorage
- File I/O through the official Tauri plugins (`plugin-fs`, `plugin-dialog`)
- **Cloudflare Worker + Hono** for the AI proxy
- **Claude** (Anthropic API) for the verification itself

## Repository layout

- `app/src` — React frontend: editor, sidebar, verification panel, search
- `app/src-tauri` — Tauri (Rust) shell: window, plugins, permissions
- `server/` — AI proxy (Cloudflare Worker). Holds the API key; the desktop app
  never sees it. Streams findings back as NDJSON

## Development

Requirements: Node.js, Rust, and the Tauri system dependencies — Xcode Command
Line Tools on macOS, the MSVC toolchain with VS Build Tools 2022 on Windows.

Install dependencies in both packages:

```
cd app    && npm install
cd server && npm install
```

Run the app:

```
cd app
npm run tauri dev     # development, hot reload
npm run tauri build   # release bundles (.dmg / .msi)
npm test              # unit tests (vitest)
```

Run the AI proxy in a second terminal:

```
cd server
npm run dev           # http://localhost:8787
```

Without an API key the proxy runs in **mock mode** and returns sample findings,
which is enough for working on the interface and costs nothing. To use the real
API, copy `server/.dev.vars.example` to `server/.dev.vars` and put your key
there. On Windows there are double-click helpers in the repository root:
`dev.bat`, `build.bat` and `server-dev.bat`.

Release bundles cannot be cross-compiled: `.dmg` requires macOS with Xcode,
`.msi` requires Windows with MSVC.

## API key handling

The Anthropic API key never ships inside the desktop app. It lives only on the
proxy in `server/` — locally in `.dev.vars` (git-ignored), in production as a
Cloudflare secret. The app talks to the proxy and nothing else. The proxy is
rate limited per IP and caps request size.

## Status

Work in progress; not released yet. The app builds and runs on macOS and
Windows, and verification works against the deployed proxy. Installers are not
signed or notarised yet, so an unsigned build triggers a Gatekeeper or
SmartScreen warning.
