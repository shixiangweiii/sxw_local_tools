# AGENTS.md

This file provides guidance to the AI agent when working with code in this repository.

## Commands

```bash
npm run dev       # Start electron-vite dev server with HMR
npm run build     # Type-check + build (no separate tsc step needed)
npm run package   # Build + package macOS-only .dmg into dist/
```

No test runner or linter is configured. Type-checking is the only verification (`npm run build`).

## Critical Architecture

Three-process Electron app. The **Web Worker** (`src/renderer/workers/json.worker.ts`) is the source of truth for JSON data — not the Zustand store. The store holds only a projection.

- Every tree mutation must be sent to the worker; otherwise `stringify` produces stale output.
- When adding worker actions: update the `WorkerMessage` union in `json.worker.ts` AND add a wrapper in `src/renderer/hooks/useJsonWorker.ts`.

### Editor ↔ Tree sync (loop prevention)

`setRawText(text, source)` records `syncSource` (`'editor'` | `'tree'`). The counterpart skips updates when it detects it was the original source. A `parseVersionRef` counter gates stale async parse results. Do not break either guard.

## Conventions

- UI strings and commit messages are **Chinese (zh-CN)**.
- macOS-first: Cmd shortcuts, `hiddenInset` title bar, packaging targets mac only.
- Path alias: `@` → `src/renderer` (in `electron.vite.config.ts`).
- Tailwind dark mode via `class` strategy, toggled from Zustand store's `theme`.
- IPC channel names live in `src/shared/constants.ts`.
