import { useRef, useCallback, useEffect, useMemo } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { useStore } from '../../store'
import { PASTE_WARN_LIMIT, formatBytes } from '../markdown/perfThresholds'
import { registerMarkdownFlush } from './editorFlush'

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
  const onContentChangeRef = useRef(onContentChange)
  onContentChangeRef.current = onContentChange

  // modeRef 在下方模式切换 effect 末尾更新，离开 Markdown 时才能读到旧模式。

  // 只在 Markdown 且防抖还没触发时读编辑器。先读出文本再清定时器，读失败则保留定时器。
  useEffect(() => {
    const flush = (): void => {
      if (modeRef.current !== 'markdown' || !debounceRef.current) return
      const editor = editorRef.current
      if (!editor) return
      let value: string
      try {
        value = editor.getValue()
      } catch {
        return
      }
      clearTimeout(debounceRef.current)
      debounceRef.current = null
      if (value !== useStore.getState().markdownText) {
        onContentChangeRef.current(value)
      }
    }
    registerMarkdownFlush(flush)
    return () => {
      flush()
      registerMarkdownFlush(null)
    }
  }, [])

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
    // Monaco 可能晚于 store 就绪，挂载时把已有文本填进去
    const state = useStore.getState()
    const next =
      modeRef.current === 'json' ? state.rawText : modeRef.current === 'markdown' ? state.markdownText : state.htmlText
    if (ed.getValue() !== next) {
      isUpdatingFromExternal.current = true
      ed.setValue(next)
      requestAnimationFrame(() => {
        isUpdatingFromExternal.current = false
      })
    }
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
      const timer = setTimeout(() => {
        if (debounceRef.current === timer) debounceRef.current = null
        onContentChange(value)
      }, debounceTime)
      debounceRef.current = timer
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
          // markdown mode: external markdownText change (e.g. open file, reload)
          if (curr.markdownText !== prev.markdownText) {
            // 先取消尚未触发的防抖，避免旧文本在 setValue 之后写回 store
            if (debounceRef.current) {
              clearTimeout(debounceRef.current)
              debounceRef.current = null
            }
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

  // 离开 Markdown 前先把未落库文本写入 store，再换成目标模式的缓冲
  useEffect(() => {
    const previousMode = modeRef.current
    const editor = editorRef.current
    if (debounceRef.current && editor && previousMode === 'markdown' && previousMode !== mode) {
      let value: string | undefined
      try {
        value = editor.getValue()
      } catch {
        value = undefined
      }
      clearTimeout(debounceRef.current)
      debounceRef.current = null
      if (value !== undefined && value !== useStore.getState().markdownText) {
        useStore.getState().setMarkdownText(value)
      }
    } else if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    modeRef.current = mode
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
