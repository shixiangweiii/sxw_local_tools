import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { registerWindow } from './windowManager'

const isDev = !app.isPackaged

// 临时存储新窗口的初始配置，窗口初始化后消费
const pendingConfigs = new Map<number, { theme: string; editorMode: string }>()

export function createWindow(config?: { theme: string; editorMode: string }): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 10 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (config) pendingConfigs.set(win.id, config)
  registerWindow(win, config as { theme: 'dark' | 'light'; editorMode: 'json' | 'markdown' | 'html' } | undefined)

  win.on('ready-to-show', () => {
    win.show()
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

export function consumePendingConfig(winId: number): { theme: string; editorMode: string } | null {
  const config = pendingConfigs.get(winId)
  pendingConfigs.delete(winId)
  return config ?? null
}
