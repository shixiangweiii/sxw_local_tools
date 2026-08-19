import { Suspense, startTransition, useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from './store'
import { Toolbar } from './components/Toolbar'
import { SplitPanel } from './components/SplitPanel'
import { MonacoEditor } from './components/editor/MonacoEditor'
import { TreeView } from './components/tree/TreeView'
import { SearchBar } from './components/SearchBar'
import { MarkdownPreview } from './components/markdown/MarkdownPreview'
import { TocSidebar } from './components/markdown/TocSidebar'
import { HtmlSanitizedView } from './components/html/HtmlSanitizedView'
import { formatBytes, pickStrategy } from './components/markdown/perfThresholds'
import type { HeadingItem } from './utils/tocParser'
import { useJsonWorker } from './hooks/useJsonWorker'
import { sanitizeHtml } from './utils/htmlSanitize'

const MARKDOWN_FILTERS = [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
const HTML_FILTERS = [{ name: 'HTML', extensions: ['html', 'htm'] }]

function Toast(): JSX.Element | null {
  const message = useStore((s) => s.toastMessage)
  const type = useStore((s) => s.toastType)
  const clearToast = useStore((s) => s.clearToast)

  useEffect(() => {
    if (!message) return
    const timer = setTimeout(clearToast, 3000)
    return () => clearTimeout(timer)
  }, [message, clearToast])

  if (!message) return null

  return (
    <div
      className={`fixed bottom-4 right-4 px-4 py-2 rounded-lg shadow-lg text-sm text-white z-50 ${
        type === 'success' ? 'bg-green-500' : 'bg-red-500'
      }`}
    >
      {message}
    </div>
  )
}

function App(): JSX.Element {
  const theme = useStore((s) => s.theme)
  const editorMode = useStore((s) => s.editorMode)
  const currentFilePath = useStore((s) => s.filePathByMode[s.editorMode])
  const { parse, format, minify, validate } = useJsonWorker()
  const parseVersionRef = useRef(0)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  // 初始化时读取继承配置
  useEffect(() => {
    window.electronAPI?.getInitConfig().then((result) => {
      const store = useStore.getState()
      store.setWindowNumber(result.windowNumber)
      if (result.theme && result.theme !== store.theme) store.toggleTheme()
      if (result.editorMode) store.setEditorMode(result.editorMode as 'json' | 'markdown' | 'html')
    })
  }, [])

  // 文件/模式/主题变化时上报状态，窗口标题由主进程统一组装
  useEffect(() => {
    window.electronAPI?.setWindowTitle({ filePath: currentFilePath, theme, editorMode })
  }, [currentFilePath, editorMode, theme])

  // When editor content changes, route by mode: markdown -> setMarkdownText only; html -> sanitize; json -> original parse flow
  const handleEditorChange = useCallback(
    async (text: string) => {
      const store = useStore.getState()
      if (store.editorMode === 'markdown') {
        // Wrap in startTransition so the resulting preview re-render can be interrupted
        startTransition(() => {
          store.setMarkdownText(text)
        })
        return
      }
      if (store.editorMode === 'html') {
        store.setHtmlText(text)
        // sanitize 同步开销在大文档下可能上百毫秒，包进 startTransition 让右侧渲染可被打断
        startTransition(() => {
          try {
            store.setHtmlSanitizedText(sanitizeHtml(text))
          } catch (err) {
            console.warn('sanitizeHtml failed:', err)
            store.setHtmlSanitizedText(text)
          }
        })
        return
      }

      // Prevent loop: if this update came from tree sync, skip
      if (store.syncSource === 'tree') return

      store.setRawText(text, 'editor')
      if (!text.trim()) {
        store.setParsedTree(null)
        store.setValidationErrors([])
        return
      }

      const version = ++parseVersionRef.current
      try {
        const result = await parse(text)
        // Stale check: only apply if this is still the latest parse
        if (version !== parseVersionRef.current) return
        store.setParsedTree(result.tree)
        store.setValidationErrors(result.errors)
        // Auto-expand first 2 levels for small trees
        if (result.tree && result.allIds.length <= 200) {
          store.expandAll(result.allIds)
        }
      } catch {
        // Invalid JSON, ignore parse errors
      }
    },
    [parse]
  )

  // When tree changes, sync back to editor
  const handleTreeChange = useCallback((json: string) => {
    useStore.getState().setRawText(json, 'tree')
  }, [])

  const handleOpen = useCallback(async () => {
    const mode = useStore.getState().editorMode
    if (mode === 'markdown') {
      const result = await window.electronAPI?.openFile(MARKDOWN_FILTERS)
      if (!result) return
      // 放在 startTransition 之外，避免标题更新被延后
      useStore.getState().setFilePath(result.path)
      startTransition(() => {
        useStore.getState().setMarkdownText(result.content)
      })
      return
    }
    if (mode === 'html') {
      const result = await window.electronAPI?.openFile(HTML_FILTERS)
      if (!result) return
      const content = result.content
      useStore.getState().setFilePath(result.path)
      useStore.getState().setHtmlText(content)
      try {
        useStore.getState().setHtmlSanitizedText(sanitizeHtml(content))
      } catch (err) {
        console.warn('sanitizeHtml failed:', err)
        useStore.getState().setHtmlSanitizedText(content)
      }
      return
    }

    const result = await window.electronAPI?.openFile()
    if (!result) return

    const content = result.content
    useStore.getState().setFilePath(result.path)
    if (!content.trim()) {
      useStore.getState().setRawText(content, 'tree')
      useStore.getState().setParsedTree(null)
      useStore.getState().setValidationErrors([])
      return
    }

    const version = ++parseVersionRef.current
    useStore.getState().setRawText(content, 'tree')
    try {
      const parseResult = await parse(content)
      if (version !== parseVersionRef.current) return
      useStore.getState().setParsedTree(parseResult.tree)
      useStore.getState().setValidationErrors(parseResult.errors)
      if (parseResult.tree && parseResult.allIds.length <= 200) {
        useStore.getState().expandAll(parseResult.allIds)
      }
    } catch {
      // Invalid JSON, ignore parse errors
    }
  }, [parse])

  const handleFormat = useCallback(async () => {
    const text = useStore.getState().rawText
    if (!text.trim()) return
    try {
      const result = await format(text)
      useStore.getState().setRawText(result, 'tree')
      useStore.getState().showToast('格式化成功', 'success')
    } catch {
      useStore.getState().showToast('JSON 格式错误，无法格式化', 'error')
    }
  }, [format])

  const handleMinify = useCallback(async () => {
    const text = useStore.getState().rawText
    if (!text.trim()) return
    try {
      const result = await minify(text)
      useStore.getState().setRawText(result, 'tree')
      useStore.getState().showToast('压缩成功', 'success')
    } catch {
      useStore.getState().showToast('JSON 格式错误，无法压缩', 'error')
    }
  }, [minify])

  const handleValidate = useCallback(async () => {
    const text = useStore.getState().rawText
    if (!text.trim()) {
      useStore.getState().showToast('请输入 JSON', 'error')
      return
    }
    const result = await validate(text)
    if (result.valid) {
      useStore.getState().showToast('JSON 格式正确', 'success')
    } else {
      useStore.getState().showToast(`JSON 错误: ${result.errors[0]?.message}`, 'error')
    }
  }, [validate])

  const isMarkdown = editorMode === 'markdown'
  const isHtml = editorMode === 'html'
  const isPreviewFullscreen = useStore((s) => s.isPreviewFullscreen)
  const editorLanguage: 'json' | 'markdown' | 'html' = isMarkdown ? 'markdown' : isHtml ? 'html' : 'json'

  // Escape 键退出全屏
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      // 灯箱打开时由灯箱自行处理 Esc，不退出全屏预览
      if (document.querySelector('[data-mermaid-lightbox]')) return
      if (useStore.getState().isPreviewFullscreen) {
        useStore.getState().togglePreviewFullscreen()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const markdownPanel = (
    <Suspense
      fallback={
        <div className="h-full flex items-center justify-center text-gray-400 text-sm">加载预览...</div>
      }
    >
      <MarkdownTextSubscriber />
    </Suspense>
  )

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-900">
      <Toolbar onFormat={handleFormat} onMinify={handleMinify} onValidate={handleValidate} onOpen={handleOpen} />

      <div className="flex-1 overflow-hidden">
        {isPreviewFullscreen && isMarkdown ? (
          // 全屏模式：仅渲染预览面板
          markdownPanel
        ) : (
          <SplitPanel
            left={
              <MonacoEditor
                language={editorLanguage}
                mode={editorMode}
                onContentChange={handleEditorChange}
              />
            }
            right={
              isMarkdown ? (
                markdownPanel
              ) : isHtml ? (
                <HtmlSanitizedView />
              ) : (
                <div className="h-full flex flex-col">
                  <SearchBar />
                  <div className="flex-1 overflow-hidden">
                    <TreeView onTreeChange={handleTreeChange} />
                  </div>
                </div>
              )
            }
          />
        )}
      </div>

      <Toast />
    </div>
  )
}

/**
 * 仅在 markdown 模式下挂载，独立订阅 markdownText 与预览快照，避免 App 重渲染影响 JSON 路径。
 * 根据文档大小选择 live / manual / disabled 策略。
 * 集成 TOC 侧栏。
 */
function MarkdownTextSubscriber(): JSX.Element {
  const markdownText = useStore((s) => s.markdownText)
  const markdownPreviewText = useStore((s) => s.markdownPreviewText)
  const commitMarkdownPreview = useStore((s) => s.commitMarkdownPreview)
  const isTocVisible = useStore((s) => s.isTocVisible)
  const markdownByteLength = useStore((s) => s.markdownByteLength)
  const strategy = pickStrategy(markdownByteLength)
  const [headings, setHeadings] = useState<HeadingItem[]>([])
  const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(null)

  // live 模式下自动提交快照；manual / disabled 不自动提交
  useEffect(() => {
    if (strategy === 'live') {
      startTransition(() => {
        commitMarkdownPreview()
      })
    }
  }, [markdownText, strategy, commitMarkdownPreview])

  const handleHeadingsChange = useCallback((nextHeadings: HeadingItem[]) => {
    setHeadings((previousHeadings) => {
      if (
        previousHeadings.length === nextHeadings.length &&
        previousHeadings.every((heading, index) => {
          const nextHeading = nextHeadings[index]
          return heading.id === nextHeading.id &&
            heading.text === nextHeading.text &&
            heading.level === nextHeading.level
        })
      ) {
        return previousHeadings
      }
      return nextHeadings
    })
  }, [])

  if (strategy === 'disabled') {
    return (
      <div className="h-full flex flex-col items-center justify-center text-gray-400 text-sm p-6 text-center bg-white dark:bg-gray-900">
        <div className="text-2xl mb-2">⚠️</div>
        <div className="font-medium text-gray-500 dark:text-gray-300">
          文档过大（{formatBytes(markdownByteLength)}），已禁用预览
        </div>
        <div className="mt-1 text-xs">请使用左侧编辑器查看内容，或截取片段后重试。</div>
      </div>
    )
  }

  return (
    <div className="h-full flex">
      {isTocVisible && headings.length > 0 && (
        <TocSidebar headings={headings} scrollContainer={scrollContainer} />
      )}
      <div className="flex-1 overflow-hidden" ref={setScrollContainer}>
        <MarkdownPreview text={markdownPreviewText} onHeadingsChange={handleHeadingsChange} />
      </div>
    </div>
  )
}

export default App
