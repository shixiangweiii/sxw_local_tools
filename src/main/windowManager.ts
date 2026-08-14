import { BrowserWindow } from 'electron'
import { basename } from 'path'

interface WindowConfig {
  theme: 'dark' | 'light'
  editorMode: 'json' | 'markdown' | 'html'
}

interface WindowEntry {
  win: BrowserWindow
  title: string
  number: number
  // 当前模式下打开/保存的文件完整路径；不放进 config，避免被新窗口继承
  filePath: string | null
  config: WindowConfig
}

const windows = new Map<number, WindowEntry>()
let onChangeCallback: (() => void) | null = null
let nextWindowNumber = 1

const MODE_LABELS: Record<WindowConfig['editorMode'], string> = {
  json: 'JSON',
  markdown: 'Markdown',
  html: 'HTML'
}

// 有文件时只显示文件名，仅当与其他窗口重名时才追加窗口编号；无文件时沿用「JSON Parse - 模式 - 编号」
function composeTitle(entry: WindowEntry): string {
  if (!entry.filePath) {
    return `JSON Parse - ${MODE_LABELS[entry.config.editorMode]} - ${entry.number}`
  }
  const name = basename(entry.filePath)
  const duplicated = [...windows.values()].some(
    (other) => other !== entry && other.filePath !== null && basename(other.filePath) === name
  )
  return duplicated ? `${name} - ${entry.number}` : name
}

// 重名消歧需要全局视角：任一窗口的文件名/模式变化或窗口开关，都要重算所有窗口标题
function recomputeAllTitles(): void {
  for (const entry of windows.values()) {
    if (entry.win.isDestroyed()) continue
    const next = composeTitle(entry)
    if (next === entry.title) continue
    entry.title = next
    entry.win.setTitle(next)
  }
  onChangeCallback?.()
}

export function registerWindow(win: BrowserWindow, config?: WindowConfig): void {
  const id = win.id
  const num = nextWindowNumber++
  windows.set(id, {
    win,
    title: 'JSON Parse',
    number: num,
    filePath: null,
    config: config ?? { theme: 'light', editorMode: 'json' }
  })
  win.on('closed', () => {
    windows.delete(id)
    recomputeAllTitles()
  })
  win.on('focus', () => {
    onChangeCallback?.()
  })
  recomputeAllTitles()
}

export function setWindowFilePath(winId: number, filePath: string | null): void {
  const entry = windows.get(winId)
  if (!entry || entry.win.isDestroyed()) return
  entry.filePath = filePath
  entry.win.setRepresentedFilename(filePath ?? '')
  recomputeAllTitles()
}

export function updateWindowConfig(winId: number, config: Partial<WindowConfig>): void {
  const entry = windows.get(winId)
  if (entry) Object.assign(entry.config, config)
}

export function getFocusedWindowConfig(): WindowConfig {
  const focused = BrowserWindow.getFocusedWindow()
  if (focused) {
    const entry = windows.get(focused.id)
    if (entry) return { ...entry.config }
  }
  // fallback: 取最近活跃窗口的配置
  const last = [...windows.values()].pop()
  return last?.config ? { ...last.config } : { theme: 'light', editorMode: 'json' }
}

export function getWindowList(): Array<{ id: number; title: string; focused: boolean }> {
  const focusedId = BrowserWindow.getFocusedWindow()?.id
  return [...windows.entries()].map(([id, entry]) => ({
    id,
    title: entry.title,
    focused: id === focusedId
  }))
}

export function focusWindow(id: number): void {
  const entry = windows.get(id)
  if (entry) {
    entry.win.show()
    entry.win.focus()
  }
}

export function getWindowNumber(winId: number): number {
  return windows.get(winId)?.number ?? 1
}

export function onWindowsChange(cb: () => void): void {
  onChangeCallback = cb
}
