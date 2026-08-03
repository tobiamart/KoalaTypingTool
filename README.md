# Narwhal 🐋

**[narwhal.ink](https://narwhal.ink)**

Fact-checking writing tool — a desktop app for writing long-form, chaptered text
(books, papers) with AI-assisted verification of grammar, consistency, and logic.

Built with **Tauri 2**, **React 19**, **TypeScript**, and **TipTap**. Your content
is stored as plain **Markdown files on disk** — you own your data, no lock-in.

## Project layout

- `app/src` — React frontend (editor, sidebar, verification panel)
- `app/src-tauri` — Tauri (Rust) shell: window, plugins, permissions
- `server/` — AI proxy (Cloudflare Worker + Hono); holds the API key,
  the desktop app never sees it. Runs locally via `wrangler dev`
- `web/` — the narwhal.ink landing page: one static HTML file served by its
  own Cloudflare Worker, no build step
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

## Branding

One graphic is the single source of truth: **`app/src/assets/narwhal.svg`**. It is
used both on the start screen and as the input for the app icon set:

```
cd app && npx tauri icon src/assets/narwhal.svg --ios-color "#0f1211"
```

That regenerates everything under `app/src-tauri/icons/` (all PNG sizes, `.icns`,
`.ico`, plus Android and iOS sets). Icon changes are build inputs, so the next
`npm run tauri dev` recompiles the Rust shell.

The current mark is a **placeholder** drawn from scratch (no third-party licence
attached). What to request from a designer replacing it:

| Item | Spec |
| --- | --- |
| Master source | **SVG** (or Figma/AI), shapes as paths, no external fonts, no embedded raster |
| Main export | **1024×1024 PNG**, transparent, sRGB, 32-bit with alpha (2048 also fine) |
| Framing | Artwork fills the square with ~8% padding — a mark floating in empty space renders tiny as an icon |
| Background | Transparent is fine and is what we ship — macOS composites the system theme (light/dark) behind the mark. An opaque rounded-square (squircle) is the alternative if a fixed look across every backdrop is wanted |
| Small-size variant | Simplified silhouette legible at 16×16 (drop hairline detail such as tusk stripes) |
| iOS | Opaque 1024×1024, no alpha, square corners (Apple applies the mask) |
| Android | Adaptive icon: separate foreground and background layers, safe zone respected |
| Rights | **Written transfer of copyright**, not just a usage licence — required to use the mark as a trademark |

`npx tauri icon` accepts a squared PNG **or** SVG, but its SVG parser rejects XML
comments before the root `<svg>` element — keep the file comment-free.

## Status

Work in progress. The app calls the proxy in `server/` for AI verification;
the Anthropic API key lives only on the server (locally in `server/.dev.vars`,
in production as a Cloudflare secret) and never ships inside the app.
See `TODO.md` for the roadmap.
