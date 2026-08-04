# Narwhal

Desktop app for writing long-form, chaptered text — books, theses, papers — with
AI-assisted verification of the manuscript.

A project is a folder of chapters plus author notes (world description,
characters, bibliography). Verification checks the chapter you are editing
against the other chapters and the notes, and reports three kinds of finding:

| Category | What it covers |
| --- | --- |
| `consistency` | a fact contradicting the rest of the material |
| `logic` | impossible sequences, broken rules of the world |
| `grammar` | grammar and usage |

Categories follow the nature of the problem, not the source of the contradicting
fact — a date clashing with the notes is `consistency`, the same as one clashing
with another chapter.

## Editor

- TipTap 3, serialising to Markdown; one editor instance per file, so undo does
  not leak between chapters
- Findings are ProseMirror decorations, not document changes — they leave undo
  and autosave untouched, and a fragment's highlight clears as soon as you edit
  it
- Findings can be dismissed; dismissals are stored per project and restorable
- Full-text search (⌘K / Ctrl+K) over titles and content, case- and
  diacritic-insensitive, jumping to the occurrence
- Spell checking uses the webview's native mechanism, i.e. the system
  dictionaries — nothing bundled

## Storage

Plain Markdown files on disk, no database:

```
my-book/
  project.json         manifest: title, chapter order, note list
  chapters/*.md
  notes/*.md
  ignored-issues.json  dismissed findings
```

Chapter order lives in the manifest, so reordering never renames files on disk.

## Stack

- Tauri 2 (Rust shell) + React 19 + TypeScript + Vite 7
- TipTap 3 for the editor, Zustand for state
- File I/O through the official Tauri plugins (`plugin-fs`, `plugin-dialog`) —
  no custom Rust commands
- Claude (Anthropic API) for verification, reached through a proxy

## Layout

- `app/src` — React frontend: editor, sidebar, verification panel, search
- `app/src-tauri` — Tauri shell: window, plugins, permissions

## Build

Requires Node.js, Rust, and the Tauri system dependencies — Xcode Command Line
Tools on macOS, MSVC with VS Build Tools 2022 on Windows.

```
cd app
npm install
npm run tauri dev     # development, hot reload
npm run tauri build   # release bundles (.dmg / .msi)
npm test              # unit tests (vitest)
```

Bundles cannot be cross-compiled: `.dmg` needs macOS, `.msi` needs Windows.
They are not signed or notarised, so a self-made build triggers a Gatekeeper or
SmartScreen warning.

## Verification backend

Writing works offline. Verification does not: the app sends the chapter, the
other chapters and the notes to a proxy, which calls the Anthropic API and
streams findings back as NDJSON, one at a time.

**The proxy is not part of this repository and is access-controlled**, so a build
made from this source runs as an editor but has "Check text" rejected. That is
expected, not a broken setup. The split exists because a desktop binary cannot
hold a secret — the API key stays server-side and never ships with the app.

To point the app at your own backend, change `PROXY_URL` in `app/src/lib/ai.ts`;
it needs to accept `POST /verify` with `{text, notes, chapters}` and reply with
an NDJSON stream.

## Status

Work in progress, not released. Builds and runs on macOS and Windows.
