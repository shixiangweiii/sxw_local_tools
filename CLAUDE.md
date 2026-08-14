# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start electron-vite dev server with HMR
npm run build     # Type-check + build main/preload/renderer
npm run preview   # Run the built app
npm run package   # Build + package macOS .dmg into dist/
```

No test runner or linter is configured — `npm run build` (type-check + build) is the only verification. Type-checking uses `tsconfig.node.json` for main/preload/shared and `tsconfig.web.json` for renderer/shared.

`.npmrc` pins the registry and the Electron/electron-builder binary mirrors to npmmirror because the lockfile originated on an internal registry. Don't replace it with the public npmjs registry.

`AGENTS.md` is a condensed copy of this file for other agents; keep the two consistent when architecture notes change.

## Architecture

Three-process Electron app (electron-vite) with a strict process boundary:

- **`src/main/`** — `index.ts` boots the app and rebuilds the menu whenever the window set changes; `window.ts` creates `BrowserWindow`s (`hiddenInset` title bar, contextIsolation on, nodeIntegration off) and stashes each new window's inherited config in `pendingConfigs`; `windowManager.ts` owns window registry, numbering and title composition; `ipc.ts` registers the handlers.
- **`src/preload/index.ts`** — exposes `electronAPI` (`openFile`, `saveFile`, `newWindow`, `setWindowTitle`, `getInitConfig`) via `contextBridge`. This is the entire renderer↔main surface; channel names live in `src/shared/constants.ts`.
- **`src/renderer/`** — React 18 + Zustand + Monaco + Tailwind. Path alias `@` → `src/renderer` (`electron.vite.config.ts`); renderer workers are bundled as ES modules (`worker.format: 'es'`).

### Three editor modes share one window

`uiSlice.editorMode` is `'json' | 'markdown' | 'html'`, toggled from the Toolbar. Each mode has its **own text buffer and its own file path** — `rawText` / `markdownText` / `htmlText`, and `filePathByMode`. Switching modes never converts content between buffers.

The left pane is a single `MonacoEditor` instance reused across modes (`components/editor/MonacoEditor.tsx`). Two things keep it in sync:

- A `useStore.subscribe` with an explicit `equalityFn` pushes *external* text changes into the editor (`setValue` guarded by `isUpdatingFromExternal`). Which field it watches depends on `editorMode`.
- A `mode`-keyed effect flushes the pending debounce and swaps the editor content to the new mode's buffer. Without that flush, a keystroke in one mode lands in the next mode's buffer.

`App.handleEditorChange` routes by mode: markdown → `setMarkdownText` inside `startTransition`; html → `setHtmlText` + `sanitizeHtml` inside `startTransition`; json → the parse pipeline below. The right pane is TreeView (json), `MarkdownPreview` (markdown) or `HtmlSanitizedView` (html).

### JSON processing pipeline (worth reading several files to understand)

All JSON work happens in a dedicated Web Worker (`workers/json.worker.ts`) reached through `hooks/useJsonWorker.ts`. The worker is **stateful** — it holds `workerTree` (the canonical parsed tree) plus a `lazyValueStore` Map of unmaterialized raw subtrees. The Zustand store holds only a projection of that tree.

Consequences:
- The worker is the source of truth for serializing back to JSON (`stringify` walks `workerTree`, splicing in `lazyValueStore` raw values). `TreeView.syncTreeToEditor` calls it and only falls back to main-thread `treeToJson` when the tree provably has no lazy nodes.
- Every tree mutation (`editNode`, `addNode`, `addJsonNode`, `deleteNode`) must also be sent to the worker so its mirror stays in sync — otherwise `stringify` returns stale output. `TreeView` fires these as unawaited promises alongside the main-thread `treeHelpers` update; both sides must apply the same change.
- **Lazy parsing**: `parse` picks `maxDepth` from input size (2 for >1MB, 4 for >100KB, else 100). Deeper subtrees go to `lazyValueStore` and are materialized on `expand` (two more levels at a time).
- **Auto-expand** only fires when `allIds.length <= 200` (`App.tsx`); larger trees stay collapsed.
- `useJsonWorker.parse` calls `cancelPending`, which *rejects* every in-flight request — including unrelated ones. Callers must tolerate a `cancelled` rejection.

Search runs in a separate worker (`workers/search.worker.ts`) via `useSearchWorker`, in text mode (substring/regex, debounced 200ms) or JSONPath mode (`jsonpath-plus`, triggered by Enter). JSONPath is evaluated against `store.rawText`, not the tree, because lazy nodes make the tree incomplete; results come back as JSON Pointers and are resolved to node ids by walking the tree.

### Editor ↔ Tree bidirectional sync (loop prevention)

In JSON mode the Monaco editor and the TreeView are both editable and both write `store.rawText`:

- `setRawText(text, source)` records `syncSource` as `'editor'` or `'tree'`.
- `App.handleEditorChange` returns early when `syncSource === 'tree'` (the change was tree edits propagating back).
- Editor input is debounced by size: 300ms, 500ms >100KB, 800ms >1MB.
- `parseVersionRef` in `App.tsx` gates async parse results — only the latest version is applied.

Preserve both the `syncSource` guard and the version counter when touching this flow.

### Markdown preview performance system

`components/markdown/perfThresholds.ts` is the single source of truth for every size limit; Toolbar, `MarkdownTextSubscriber` and MonacoEditor all read from it. `pickStrategy(byteLength)` returns:

- `live` (<300KB) — `commitMarkdownPreview()` runs automatically in a transition.
- `manual` (300KB–5MB) — the preview only updates when the user clicks refresh in the Toolbar; `markdownPreviewText` deliberately lags `markdownText`.
- `disabled` (≥5MB) — the preview pane is replaced by a notice.

So the preview always renders `markdownPreviewText`, never `markdownText`. `MarkdownPreview` is `React.lazy` so mermaid/react-markdown stay out of the main chunk and never load in JSON mode. `MermaidBlock` adds viewport-lazy rendering (IntersectionObserver), a global lazy-loaded mermaid singleton re-initialized on theme change, a `MERMAID_MAX_CONCURRENCY` semaphore, and a per-block size cap. Tables over 100 rows render incrementally via `LazyTable`.

### HTML mode

`utils/htmlSanitize.ts` is not a security sanitizer — it's an aggressive structure extractor aimed at RAG/LLM input: a minimal attribute allowlist, a tag blacklist (nav/header/footer/forms/media/embeds), unwrapping of decorative and single-child containers, short-text-container heuristics, and empty-element pruning. It deliberately only *removes* wrappers, reconstructing `<html>/<head>/<body>` in the output only if the input had them. The right pane shows the result in a read-only Monaco; "复制为 MD" converts it with turndown + GFM (`utils/htmlToMarkdown.ts`).

### Window titles and config inheritance

Titles are assembled in the main process, never by the renderer. The renderer reports `{ filePath, theme, editorMode }` through `setWindowTitle` on every relevant change; `windowManager.updateWindowConfig` applies theme/mode first, then `setWindowFilePath` recomputes **all** window titles (filename-only, with a window number appended only when two windows show the same basename). Config must be applied before the title recompute or the title lags a mode switch by one tick.

New windows inherit `{ theme, editorMode }` from the focused window — but never `filePath`, which is why filePath is kept outside `WindowConfig`. The child reads it once via `getInitConfig` (`consumePendingConfig` deletes it) and also learns its window number there.

### State management

Zustand store composed in `store/index.ts` with `subscribeWithSelector`:

- `jsonSlice.ts` — `rawText`, `parsedTree`, `validationErrors`, `expandedIds`, `syncSource`.
- `uiSlice.ts` — everything else: theme, wordWrap, window number, search query/options/matches, toast, `editorMode`, `filePathByMode`, markdown buffers + byte length, html buffers, preview fullscreen, TOC visibility.

Combined type is `StoreState = JsonSlice & UiSlice` in `store/types.ts`.

## Conventions

- UI strings, menu labels, code comments and commit messages are Chinese (zh-CN). Match the existing tone when adding copy.
- macOS-first: `Cmd` shortcuts, `hiddenInset` chrome (`.titlebar-drag` / `.titlebar-no-drag` classes in the Toolbar), `npm run package` builds `--mac` only.
- Tailwind with the `class` dark-mode strategy, toggled by `document.documentElement.classList.toggle('dark', ...)` from the store's `theme`.
- When adding a worker action, update the `WorkerMessage` union in `json.worker.ts` **and** add a wrapper in `useJsonWorker.ts` — the hook is the only place renderer code talks to the worker.
- New size/perf limits belong in `perfThresholds.ts`, not inline in components.
