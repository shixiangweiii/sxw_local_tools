# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start electron-vite dev server with HMR
npm run build     # Type-check + build main/preload/renderer
npm run preview   # Run the built app
npm run package   # Build + package macOS .dmg into dist/
```

No test runner or linter is configured. Type-checking happens as part of `npm run build` via electron-vite (uses `tsconfig.node.json` for main/preload and `tsconfig.web.json` for renderer).

## Architecture

Three-process Electron app (electron-vite) with a strict process boundary:

- **`src/main/`** — Node-side. `index.ts` boots the app and builds the menu; `window.ts` creates `BrowserWindow` instances (titleBarStyle `hiddenInset`, contextIsolation on, nodeIntegration off); `ipc.ts` registers handlers for file open/save and new-window.
- **`src/preload/index.ts`** — Exposes a minimal `electronAPI` (`openFile`, `saveFile`, `newWindow`) on `window` via `contextBridge`. All renderer↔main communication goes through this surface; channel names live in `src/shared/constants.ts`.
- **`src/renderer/`** — React 18 + Zustand + Monaco + Tailwind UI. Path alias `@` → `src/renderer` (configured in `electron.vite.config.ts`).

### JSON processing pipeline (the part worth reading multiple files to understand)

All JSON work happens in a dedicated Web Worker (`src/renderer/workers/json.worker.ts`) accessed through the `useJsonWorker` hook (`src/renderer/hooks/useJsonWorker.ts`). The worker is **stateful** — it holds `workerTree` (the canonical parsed tree, including lazy subtrees) and a `lazyValueStore` Map. The renderer's Zustand store only mirrors a *projection* of this tree.

Key consequences:
- The worker is the source of truth for serializing back to JSON text (`stringify` action walks `workerTree`, splicing in `lazyValueStore` raw values).
- Every tree mutation (`editNode`, `addNode`, `addJsonNode`, `deleteNode`) must be sent to the worker so its mirror stays in sync — otherwise `stringify` produces stale output.
- **Lazy parsing**: `parse` chooses `maxDepth` based on input size (2 for >1MB, 4 for >100KB, 100 otherwise). Deeper subtrees are stashed in `lazyValueStore` and materialized on `expand`. This is what makes large files openable.
- **Auto-expand** only fires when `allIds.length <= 200` (see `App.tsx`); larger trees stay collapsed.

Search runs in a separate worker (`src/renderer/workers/search.worker.ts`) via `useSearchWorker`.

### Editor ↔ Tree bidirectional sync (loop prevention)

The Monaco editor (left) and the TreeView (right) are both editable and both feed into `store.rawText`. To prevent infinite update loops:

- `setRawText(text, source)` records `syncSource` as `'editor'` or `'tree'`.
- In `App.handleEditorChange`, if `syncSource === 'tree'` the editor change is ignored (it was caused by tree edits propagating back).
- Editor input is debounced 300ms before re-parsing.
- `parseVersionRef` in `App.tsx` gates async parse results — only the latest version is applied, older parses are dropped (stale check).

When changing this flow, preserve both the `syncSource` guard and the version counter.

### State management

Zustand store split into two slices, composed in `src/renderer/store/index.ts` with the `subscribeWithSelector` middleware:

- `jsonSlice.ts` — `rawText`, `parsedTree`, `validationErrors`, `expandedIds`, `syncSource` and their setters.
- `uiSlice.ts` — theme, search query/options, matched IDs, current match index, toast.

Types for the combined store live in `store/types.ts` as `StoreState = JsonSlice & UiSlice`.

## Conventions

- UI strings and menu labels are Chinese (zh-CN). Match existing tone when adding new copy.
- macOS-first: shortcuts use `Cmd`, the menu uses `hiddenInset` chrome, `npm run package` only builds `--mac`.
- Tailwind with dark-mode `class` strategy — toggle via `document.documentElement.classList.toggle('dark', ...)` driven by the store's `theme`.
- When adding worker actions, update the `WorkerMessage` union in `json.worker.ts` AND add a wrapper in `useJsonWorker.ts` — the hook is the only place renderer code talks to the worker.
