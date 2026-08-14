import { contextBridge, ipcRenderer } from 'electron'
import type { FileFilter } from 'electron'
import { IPC_CHANNELS } from '../shared/constants'

const electronAPI = {
  openFile: (filters?: FileFilter[]): Promise<{ path: string; content: string } | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.FILE_OPEN, filters),
  saveFile: (content: string, filters?: FileFilter[]): Promise<{ path: string } | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.FILE_SAVE, content, filters),
  newWindow: (config?: { theme: string; editorMode: string }): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.WINDOW_NEW, config),
  setWindowTitle: (source: { filePath: string | null; theme: string; editorMode: string }): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.WINDOW_SET_TITLE, source),
  getInitConfig: (): Promise<{ windowNumber: number; theme?: string; editorMode?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.WINDOW_GET_INIT_CONFIG)
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
