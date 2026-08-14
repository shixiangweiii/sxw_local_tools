import type { StateCreator } from 'zustand'
import type { StoreState, UiSlice } from './types'
import { getByteLength } from '../components/markdown/perfThresholds'

export const createUiSlice: StateCreator<StoreState, [['zustand/subscribeWithSelector', never]], [], UiSlice> = (set) => ({
  theme: (typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light') as 'dark' | 'light',
  wordWrap: 'on',
  windowNumber: 1,
  searchQuery: '',
  searchOptions: {
    mode: 'text',
    caseSensitive: false,
    regex: false,
    searchKeys: true,
    searchValues: true
  },
  matchedIds: [],
  currentMatchIndex: -1,
  searchError: null,
  toastMessage: null,
  toastType: null,
  editorMode: 'json',
  filePathByMode: { json: null, markdown: null, html: null },
  markdownText: '',
  markdownPreviewText: '',
  markdownPreviewCommittedAt: 0,
  markdownByteLength: 0,
  htmlText: '',
  htmlSanitizedText: '',
  isPreviewFullscreen: false,
  isTocVisible: true,

  toggleTheme: () =>
    set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),

  toggleWordWrap: () =>
    set((state) => ({ wordWrap: state.wordWrap === 'on' ? 'off' : 'on' })),

  setSearchQuery: (query) => set({ searchQuery: query, currentMatchIndex: -1, searchError: null }),

  setSearchOptions: (options) =>
    set((state) => ({
      searchOptions: { ...state.searchOptions, ...options }
    })),

  setMatchedIds: (ids) =>
    set({ matchedIds: ids, currentMatchIndex: ids.length > 0 ? 0 : -1 }),

  navigateMatch: (direction) =>
    set((state) => {
      if (state.matchedIds.length === 0) return {}
      const len = state.matchedIds.length
      const next =
        direction === 'next'
          ? (state.currentMatchIndex + 1) % len
          : (state.currentMatchIndex - 1 + len) % len
      return { currentMatchIndex: next }
    }),

  setSearchError: (error) => set({ searchError: error }),

  showToast: (message, type) => set({ toastMessage: message, toastType: type }),
  clearToast: () => set({ toastMessage: null, toastType: null }),

  setEditorMode: (mode) => set({ editorMode: mode }),
  setFilePath: (path) =>
    set((state) => ({
      filePathByMode: { ...state.filePathByMode, [state.editorMode]: path }
    })),
  setWindowNumber: (num) => set({ windowNumber: num }),
  setMarkdownText: (text) => set({ markdownText: text, markdownByteLength: getByteLength(text) }),
  commitMarkdownPreview: () =>
    set((state) => ({
      markdownPreviewText: state.markdownText,
      markdownPreviewCommittedAt: Date.now()
    })),
  setHtmlText: (text) => set({ htmlText: text }),
  setHtmlSanitizedText: (text) => set({ htmlSanitizedText: text }),
  togglePreviewFullscreen: () =>
    set((state) => ({ isPreviewFullscreen: !state.isPreviewFullscreen })),
  toggleToc: () =>
    set((state) => ({ isTocVisible: !state.isTocVisible }))
})
