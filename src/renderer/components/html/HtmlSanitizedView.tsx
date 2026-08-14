import { useMemo } from 'react'
import Editor from '@monaco-editor/react'
import { Copy, FileDown } from 'lucide-react'
import { useStore } from '../../store'
import { IconButton } from '../common/IconButton'
import { htmlToMarkdown } from '../../utils/htmlToMarkdown'

/**
 * HTML 解析模式右侧只读视图：
 * 渲染过滤后的 HTML 文本（HTML 语法高亮 + 复制按钮）。
 * 仅在 editorMode === 'html' 时被挂载，避免影响 JSON / Markdown 模式。
 */
export function HtmlSanitizedView(): JSX.Element {
  const text = useStore((s) => s.htmlSanitizedText)
  const theme = useStore((s) => s.theme)
  const wordWrap = useStore((s) => s.wordWrap)

  // 大文件选项降级（与左侧 MonacoEditor 保持一致的阈值与策略）
  const isLargeFile = text.length > 500_000

  const options = useMemo(
    () => ({
      readOnly: true,
      domReadOnly: true,
      fontSize: 13,
      lineNumbers: 'on' as const,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      tabSize: 2,
      wordWrap: isLargeFile ? ('off' as const) : wordWrap,
      wrappingStrategy: isLargeFile || wordWrap === 'off' ? ('simple' as const) : ('advanced' as const),
      bracketPairColorization: { enabled: !isLargeFile },
      folding: !isLargeFile,
      links: !isLargeFile,
      padding: { top: 8 },
      renderWhitespace: 'none' as const,
      smoothScrolling: true
    }),
    [wordWrap, isLargeFile]
  )

  const handleCopy = async (): Promise<void> => {
    if (!text) {
      useStore.getState().showToast('暂无可复制内容', 'error')
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      useStore.getState().showToast('已复制到剪贴板', 'success')
    } catch {
      useStore.getState().showToast('复制失败', 'error')
    }
  }

  const handleCopyAsMarkdown = async (): Promise<void> => {
    if (!text) {
      useStore.getState().showToast('暂无可复制内容', 'error')
      return
    }
    try {
      const md = htmlToMarkdown(text)
      if (!md) {
        useStore.getState().showToast('转换结果为空', 'error')
        return
      }
      await navigator.clipboard.writeText(md)
      useStore.getState().showToast('已复制 Markdown', 'success')
    } catch {
      useStore.getState().showToast('转换或复制失败', 'error')
    }
  }

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-900">
      <div className="flex items-center justify-between gap-1 px-2 py-1 border-b border-gray-200 dark:border-gray-700">
        <span className="text-xs text-gray-500 dark:text-gray-400 select-none">过滤后的 HTML（只读）</span>
        <div className="flex items-center gap-1">
          <IconButton icon={<FileDown size={14} />} label="复制为 MD" onClick={handleCopyAsMarkdown} />
          <IconButton icon={<Copy size={14} />} label="复制结果" onClick={handleCopy} />
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <Editor
          height="100%"
          language="html"
          theme={theme === 'dark' ? 'vs-dark' : 'vs'}
          value={text}
          options={options}
        />
      </div>
    </div>
  )
}
