import { ipcMain, dialog, BrowserWindow } from 'electron'
import type { FileFilter } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { IPC_CHANNELS } from '../shared/constants'
import { createWindow, consumePendingConfig } from './window'
import { setWindowFilePath, updateWindowConfig, getFocusedWindowConfig, getWindowNumber } from './windowManager'

const DEFAULT_JSON_FILTERS: FileFilter[] = [{ name: 'JSON', extensions: ['json'] }]

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.FILE_OPEN, async (event, filters?: FileFilter[]) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      filters: filters ?? DEFAULT_JSON_FILTERS,
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const content = await readFile(result.filePaths[0], 'utf-8')
    return { path: result.filePaths[0], content }
  })

  ipcMain.handle(IPC_CHANNELS.FILE_SAVE, async (event, content: string, filters?: FileFilter[]) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showSaveDialog(win!, {
      filters: filters ?? DEFAULT_JSON_FILTERS
    })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, content, 'utf-8')
    return { path: result.filePath }
  })

  ipcMain.handle(IPC_CHANNELS.WINDOW_NEW, (_event, config?: { theme: string; editorMode: string }) => {
    const finalConfig = config ?? getFocusedWindowConfig()
    createWindow(finalConfig)
  })

  ipcMain.handle(
    IPC_CHANNELS.WINDOW_SET_TITLE,
    (event, source: { filePath: string | null; theme: string; editorMode: string }) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return
      // 标题组装依赖 config.editorMode，必须先同步配置再重算标题，否则模式切换时标题会落后一拍
      // 只挑 theme/editorMode 落入 config：filePath 一旦混入就会被新窗口继承
      updateWindowConfig(win.id, {
        theme: source.theme as 'dark' | 'light',
        editorMode: source.editorMode as 'json' | 'markdown' | 'html'
      })
      setWindowFilePath(win.id, source.filePath)
    }
  )

  ipcMain.handle(IPC_CHANNELS.WINDOW_GET_INIT_CONFIG, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { windowNumber: 1 }
    const pendingConfig = consumePendingConfig(win.id)
    return {
      windowNumber: getWindowNumber(win.id),
      ...(pendingConfig ?? {})
    }
  })
}
