import { useRef, useCallback, useEffect, useMemo } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { useStore } from '../../store'
import { PASTE_WARN_LIMIT, formatBytes } from '../markdown/perfThresholds'

interface MonacoEditorProps {
  language: 'json' | 'markdown' | 'html'
  mode: 'json' | 'markdown' | 'html'
  onContentChange: (value: string) => void
}

export function MonacoEditor({ language, mode, onContentChange }: MonacoEditorProps): JSX.Element {
  const theme = useStore((s) => s.theme)
  const rawTextLength = useStore((s) => s.rawText.length)
  const markdownTextLength = useStore((s) => s.markdownText.length)
  const htmlTextLength = useStore((s) => s.htmlText.length)
  const currentTextLength =
    mode === 'json' ? rawTextLength : mode === 'markdown' ? markdownTextLength : htmlTextLength
  const wordWrap = useStore((s) => s.wordWrap)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isUpdatingFromExternal = useRef(false)
  const modeRef = useRef(mode)

  // Keep modeRef in sync so onDidPaste closure reads latest mode
  useEffect(() => {
    modeRef.current = mode
  }, [mode])

  // Dynamic debounce based on file size (Task 6)
  const debounceTime = useMemo(() => {
    if (currentTextLength > 1_000_000) return 800
    if (currentTextLength > 100_000) return 500
    return 300
  }, [currentTextLength])

  // Dynamic Monaco options based on file size (Task 3)
  const isLargeFile = currentTextLength > 500_000

  const editorOptions = useMemo(() => ({
    fontSize: 13,
    lineNumbers: 'on',
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    tabSize: 2,
    wordWrap: isLargeFile ? 'off' : wordWrap,
    wrappingStrategy: isLargeFile || wordWrap === 'off' ? 'simple' : 'advanced',
    bracketPairColorization: { enabled: !isLargeFile },
    padding: { top: 8 },
    renderWhitespace: 'none',
    smoothScrolling: true,
    folding: !isLargeFile,
    links: !isLargeFile,
    renderValidationDecorations: isLargeFile ? 'off' : 'on',
    ...(isLargeFile && {
      quickSuggestions: false,
      suggestOnTriggerCharacters: false
    })
  }), [isLargeFile, wordWrap])

  const handleMount: OnMount = useCallback((ed) => {
    editorRef.current = ed
    ed.focus()

    // Paste size warning: only meaningful in markdown mode
    ed.onDidPaste((e) => {
      if (modeRef.current !== 'markdown') return
      const model = ed.getModel()
      if (!model) return
      const pastedSize = model.getValueLengthInRange(e.range)
      if (pastedSize >= PASTE_WARN_LIMIT) {
        useStore
          .getState()
          .showToast(
            `已粘贴 ${formatBytes(pastedSize)} 内容，预览已切换为手动刷新模式`,
            'success'
          )
      }
    })
  }, [])

  const handleChange = useCallback(
    (value: string | undefined) => {
      if (isUpdatingFromExternal.current) return
      if (value === undefined) return

      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        onContentChange(value)
      }, debounceTime)
    },
    [onContentChange, debounceTime]
  )

  // Listen for external text updates (json: rawText with syncSource==='tree'; markdown: markdownText; html: htmlText)
  useEffect(() => {
    const unsub = useStore.subscribe(
      (state) => ({
        rawText: state.rawText,
        markdownText: state.markdownText,
        htmlText: state.htmlText,
        syncSource: state.syncSource,
        editorMode: state.editorMode
      }),
      (curr, prev) => {
        if (!editorRef.current) return
        if (curr.editorMode === 'json') {
          if (curr.syncSource === 'tree' && curr.rawText !== prev.rawText) {
            if (editorRef.current.getValue() !== curr.rawText) {
              isUpdatingFromExternal.current = true
              editorRef.current.setValue(curr.rawText)
              requestAnimationFrame(() => {
                isUpdatingFromExternal.current = false
              })
            }
          }
        } else if (curr.editorMode === 'markdown') {
          // markdown mode: external markdownText change (e.g. open file)
          if (curr.markdownText !== prev.markdownText) {
            if (editorRef.current.getValue() !== curr.markdownText) {
              isUpdatingFromExternal.current = true
              editorRef.current.setValue(curr.markdownText)
              requestAnimationFrame(() => {
                isUpdatingFromExternal.current = false
              })
            }
          }
        } else {
          // html mode: external htmlText change (e.g. open file)
          if (curr.htmlText !== prev.htmlText) {
            if (editorRef.current.getValue() !== curr.htmlText) {
              isUpdatingFromExternal.current = true
              editorRef.current.setValue(curr.htmlText)
              requestAnimationFrame(() => {
                isUpdatingFromExternal.current = false
              })
            }
          }
        }
      },
      {
        equalityFn: (a, b) =>
          a.rawText === b.rawText &&
          a.markdownText === b.markdownText &&
          a.htmlText === b.htmlText &&
          a.syncSource === b.syncSource &&
          a.editorMode === b.editorMode
      }
    )
    return unsub
  }, [])

  // Mode switch guard: flush pending debounce, swap editor content from store
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    if (!editorRef.current) return
    const state = useStore.getState()
    const next =
      mode === 'json' ? state.rawText : mode === 'markdown' ? state.markdownText : state.htmlText
    if (editorRef.current.getValue() !== next) {
      isUpdatingFromExternal.current = true
      editorRef.current.setValue(next)
      requestAnimationFrame(() => {
        isUpdatingFromExternal.current = false
      })
    }
  }, [mode])

  return (
    <Editor
      height="100%"
      language={language}
      theme={theme === 'dark' ? 'vs-dark' : 'vs'}
      defaultValue=""
      onChange={handleChange}
      onMount={handleMount}
      options={editorOptions}
    />
  )
}
