import type { StateCreator } from 'zustand'
import type { StoreState, JsonSlice } from './types'

export const createJsonSlice: StateCreator<StoreState, [['zustand/subscribeWithSelector', never]], [], JsonSlice> = (set) => ({
  rawText: '',
  parsedTree: null,
  validationErrors: [],
  expandedIds: new Set<string>(),
  syncSource: null,

  setRawText: (text, source = null) =>
    set({ rawText: text, syncSource: source }),

  setParsedTree: (tree) => set({ parsedTree: tree }),

  setValidationErrors: (errors) => set({ validationErrors: errors }),

  toggleExpanded: (id) =>
    set((state) => {
      const next = new Set(state.expandedIds)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return { expandedIds: next }
    }),

  expandAll: (ids) => set({ expandedIds: new Set(ids) }),

  collapseAll: () => set({ expandedIds: new Set<string>() }),

  setSyncSource: (source) => set({ syncSource: source })
})
