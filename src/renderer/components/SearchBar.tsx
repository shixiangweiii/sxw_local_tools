import { useCallback, useEffect, useRef, useState } from 'react'
import { Search, ChevronUp, ChevronDown, CaseSensitive, Regex, ChevronRight, AlertCircle } from 'lucide-react'
import { useStore } from '../store'
import { useSearchWorker } from '../hooks/useSearchWorker'
import { IconButton } from './common/IconButton'

const MODES = [
  { value: 'text' as const, label: '文本' },
  { value: 'jsonpath' as const, label: 'JSONPath' }
]

export function SearchBar(): JSX.Element {
  const searchQuery = useStore((s) => s.searchQuery)
  const setSearchQuery = useStore((s) => s.setSearchQuery)
  const searchOptions = useStore((s) => s.searchOptions)
  const setSearchOptions = useStore((s) => s.setSearchOptions)
  const matchedIds = useStore((s) => s.matchedIds)
  const currentMatchIndex = useStore((s) => s.currentMatchIndex)
  const navigateMatch = useStore((s) => s.navigateMatch)
  const searchError = useStore((s) => s.searchError)
  const setSearchError = useStore((s) => s.setSearchError)

  const [showModeMenu, setShowModeMenu] = useState(false)

  const { search } = useSearchWorker()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isJsonPathMode = searchOptions.mode === 'jsonpath'

  // Use refs for values used inside the debounced search to avoid dependency churn
  const searchOptionsRef = useRef(searchOptions)
  searchOptionsRef.current = searchOptions

  const doSearch = useCallback(
    (query: string) => {
      const store = useStore.getState()
      const tree = store.parsedTree
      if (!query || !tree) {
        store.setMatchedIds([])
        store.setSearchError(null)
        return
      }
      // For JSONPath mode, pass rawText so Worker can parse full JSON (including lazy nodes)
      const rawText = searchOptionsRef.current.mode === 'jsonpath' ? store.rawText : undefined
      search(tree, query, searchOptionsRef.current, rawText).then(({ matchIds, error }) => {
        const s = useStore.getState()
        s.setMatchedIds(matchIds)
        s.setSearchError(error ?? null)
      })
    },
    [search]
  )

  // Debounced search trigger (text mode only)
  useEffect(() => {
    if (isJsonPathMode) return // JSONPath mode uses Enter to trigger
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(searchQuery), 200)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [searchQuery, searchOptions, doSearch, isJsonPathMode])

  const handleModeSwitch = useCallback(
    (mode: 'text' | 'jsonpath') => {
      setShowModeMenu(false)
      if (mode === searchOptions.mode) return
      // Clear state on mode switch
      setSearchQuery('')
      useStore.getState().setMatchedIds([])
      setSearchError(null)
      setSearchOptions({ mode })
    },
    [searchOptions.mode, setSearchQuery, setSearchOptions, setSearchError]
  )

  const currentModeLabel = MODES.find((m) => m.value === searchOptions.mode)?.label ?? '文本'

  return (
    <div className="flex items-center gap-1 px-2 py-1 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
      {/* Mode selector */}
      <div className="relative flex-shrink-0">
        <button
          className="flex items-center gap-0.5 px-1.5 py-0.5 text-xs rounded
            bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300
            hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
          onClick={() => setShowModeMenu((v) => !v)}
        >
          {currentModeLabel}
          <ChevronRight size={10} className={`transition-transform ${showModeMenu ? 'rotate-90' : ''}`} />
        </button>
        {showModeMenu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowModeMenu(false)} />
            <div className="absolute top-full left-0 mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded shadow-lg py-0.5 min-w-[80px]">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  className={`block w-full text-left px-3 py-1 text-xs hover:bg-gray-100 dark:hover:bg-gray-700 ${
                    m.value === searchOptions.mode
                      ? 'text-blue-500 font-medium'
                      : 'text-gray-700 dark:text-gray-300'
                  }`}
                  onClick={() => handleModeSwitch(m.value)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <Search size={14} className="text-gray-400 flex-shrink-0" />
      <input
        className={`flex-1 min-w-0 px-1 py-0.5 text-xs bg-transparent outline-none placeholder-gray-400 ${
          searchError ? 'text-red-500' : ''
        }`}
        placeholder={isJsonPathMode ? '输入 JSONPath，如 $.store.book[*].author' : '搜索 JSON...'}
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (isJsonPathMode) {
              if (matchedIds.length > 0) {
                // Already have results: navigate
                e.shiftKey ? navigateMatch('prev') : navigateMatch('next')
              } else {
                // No results yet: trigger search
                doSearch(searchQuery)
              }
            } else {
              e.shiftKey ? navigateMatch('prev') : navigateMatch('next')
            }
          }
        }}
      />

      {/* Error indicator */}
      {searchError && (
        <span className="flex-shrink-0" title={searchError}>
          <AlertCircle size={14} className="text-red-500" />
        </span>
      )}

      {matchedIds.length > 0 && (
        <span className="text-xs text-gray-400 whitespace-nowrap">
          {currentMatchIndex + 1}/{matchedIds.length}
        </span>
      )}

      <IconButton
        icon={<ChevronUp size={14} />}
        label="上一个"
        onClick={() => navigateMatch('prev')}
        disabled={matchedIds.length === 0}
      />
      <IconButton
        icon={<ChevronDown size={14} />}
        label="下一个"
        onClick={() => {
          if (isJsonPathMode && matchedIds.length === 0 && searchQuery) {
            // First click in JSONPath mode with no results yet: trigger search
            doSearch(searchQuery)
          } else {
            navigateMatch('next')
          }
        }}
        disabled={matchedIds.length === 0 && !isJsonPathMode}
      />

      {/* Only show text-search specific options in text mode */}
      {!isJsonPathMode && (
        <>
          <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 mx-0.5" />

          <IconButton
            icon={<CaseSensitive size={14} />}
            label="区分大小写"
            active={searchOptions.caseSensitive}
            onClick={() => setSearchOptions({ caseSensitive: !searchOptions.caseSensitive })}
          />
          <IconButton
            icon={<Regex size={14} />}
            label="正则表达式"
            active={searchOptions.regex}
            onClick={() => setSearchOptions({ regex: !searchOptions.regex })}
          />
        </>
      )}
    </div>
  )
}
