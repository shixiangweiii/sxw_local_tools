interface ElectronFileFilter {
  name: string
  extensions: string[]
}

interface ElectronAPI {
  openFile: (filters?: ElectronFileFilter[]) => Promise<{ path: string; content: string } | null>
  saveFile: (content: string, filters?: ElectronFileFilter[]) => Promise<{ path: string } | null>
  newWindow: (config?: { theme: string; editorMode: string }) => Promise<void>
  setWindowTitle: (source: { filePath: string | null; theme: string; editorMode: string }) => Promise<void>
  getInitConfig: () => Promise<{ windowNumber: number; theme?: string; editorMode?: string }>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
