export interface TreeNode {
  id: string
  key: string | number
  value: unknown
  type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'
  children?: TreeNode[]
  depth: number
  path: string
  childCount?: number
  lazy?: boolean
}

export interface FlatNode extends TreeNode {
  hasChildren: boolean
  expanded: boolean
  highlighted: boolean
}

export interface ValidationError {
  line: number
  column: number
  message: string
}

export interface SearchOptions {
  mode: 'text' | 'jsonpath'
  caseSensitive: boolean
  regex: boolean
  searchKeys: boolean
  searchValues: boolean
}

export interface JsonSlice {
  rawText: string
  parsedTree: TreeNode | null
  validationErrors: ValidationError[]
  expandedIds: Set<string>
  syncSource: 'editor' | 'tree' | null

  setRawText: (text: string, source?: 'editor' | 'tree') => void
  setParsedTree: (tree: TreeNode | null) => void
  setValidationErrors: (errors: ValidationError[]) => void
  toggleExpanded: (id: string) => void
  expandAll: (ids: string[]) => void
  collapseAll: () => void
  setSyncSource: (source: 'editor' | 'tree' | null) => void
}

export interface UiSlice {
  theme: 'dark' | 'light'
  wordWrap: 'on' | 'off'
  windowNumber: number
  searchQuery: string
  searchOptions: SearchOptions
  matchedIds: string[]
  currentMatchIndex: number
  searchError: string | null
  toastMessage: string | null
  toastType: 'success' | 'error' | null
  editorMode: 'json' | 'markdown' | 'html'
  // 各模式的文本缓冲彼此独立，文件路径也必须按模式隔离
  filePathByMode: { json: string | null; markdown: string | null; html: string | null }
  markdownText: string
  markdownPreviewText: string
  markdownPreviewCommittedAt: number
  markdownByteLength: number
  htmlText: string
  htmlSanitizedText: string
  isPreviewFullscreen: boolean
  isTocVisible: boolean

  toggleTheme: () => void
  toggleWordWrap: () => void
  setSearchQuery: (query: string) => void
  setSearchOptions: (options: Partial<SearchOptions>) => void
  setMatchedIds: (ids: string[]) => void
  navigateMatch: (direction: 'next' | 'prev') => void
  setSearchError: (error: string | null) => void
  showToast: (message: string, type: 'success' | 'error') => void
  clearToast: () => void
  setEditorMode: (mode: 'json' | 'markdown' | 'html') => void
  setFilePath: (path: string | null) => void
  setWindowNumber: (num: number) => void
  setMarkdownText: (text: string) => void
  commitMarkdownPreview: () => void
  setHtmlText: (text: string) => void
  setHtmlSanitizedText: (text: string) => void
  togglePreviewFullscreen: () => void
  toggleToc: () => void
}

export type StoreState = JsonSlice & UiSlice
