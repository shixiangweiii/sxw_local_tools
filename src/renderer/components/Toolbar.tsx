import {
  FileJson,
  FileText,
  Minimize2,
  Maximize2,
  CheckCircle,
  FolderOpen,
  Save,
  Sun,
  Moon,
  Braces,
  AppWindow,
  WrapText,
  RefreshCw,
  Code2,
  Eraser,
  List
} from 'lucide-react'
import { IconButton } from './common/IconButton'
import { useStore } from '../store'
import { pickStrategy } from './markdown/perfThresholds'

interface ToolbarProps {
  onFormat: () => void
  onMinify: () => void
  onValidate: () => void
  onOpen: () => void
}

const MARKDOWN_FILTERS = [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
const HTML_FILTERS = [{ name: 'HTML', extensions: ['html', 'htm'] }]

export function Toolbar({ onFormat, onMinify, onValidate, onOpen }: ToolbarProps): JSX.Element {
  const theme = useStore((s) => s.theme)
  const toggleTheme = useStore((s) => s.toggleTheme)
  const wordWrap = useStore((s) => s.wordWrap)
  const toggleWordWrap = useStore((s) => s.toggleWordWrap)
  const editorMode = useStore((s) => s.editorMode)
  const setEditorMode = useStore((s) => s.setEditorMode)
  const markdownByteLength = useStore((s) => s.markdownByteLength)
  const isPreviewStale = useStore((s) => s.markdownPreviewText !== s.markdownText)
  const commitMarkdownPreview = useStore((s) => s.commitMarkdownPreview)
  const isPreviewFullscreen = useStore((s) => s.isPreviewFullscreen)
  const togglePreviewFullscreen = useStore((s) => s.togglePreviewFullscreen)
  const isTocVisible = useStore((s) => s.isTocVisible)
  const toggleToc = useStore((s) => s.toggleToc)

  const isJson = editorMode === 'json'
  const isMarkdown = editorMode === 'markdown'
  const isHtml = editorMode === 'html'
  const previewStrategy = pickStrategy(markdownByteLength)
  const windowNumber = useStore((s) => s.windowNumber)
  const filePath = useStore((s) => s.filePathByMode[s.editorMode])
  const fileName = filePath?.split('/').pop() || null

  const handleSave = async (): Promise<void> => {
    const state = useStore.getState()
    let saved: { path: string } | null | undefined
    if (state.editorMode === 'markdown') {
      saved = await window.electronAPI?.saveFile(state.markdownText, MARKDOWN_FILTERS)
    } else if (state.editorMode === 'html') {
      saved = await window.electronAPI?.saveFile(state.htmlSanitizedText, HTML_FILTERS)
    } else {
      saved = await window.electronAPI?.saveFile(state.rawText)
    }
    // 另存为成功后标题跟随新文件名；取消对话框返回 null，保持原样
    if (saved) state.setFilePath(saved.path)
  }

  // 清空当前模式左侧输入（并联动清空该模式的派生状态）。
  const handleClear = (): void => {
    const state = useStore.getState()
    // 清空即与原文件解绑，标题回落到无名文案
    state.setFilePath(null)
    if (state.editorMode === 'markdown') {
      state.setMarkdownText('')
    } else if (state.editorMode === 'html') {
      state.setHtmlText('')
      state.setHtmlSanitizedText('')
    } else {
      // 以 'tree' 作为同步来源，触发 MonacoEditor 外部同步 setValue('')
      state.setRawText('', 'tree')
      state.setParsedTree(null)
      state.setValidationErrors([])
    }
  }

  return (
    <div className="titlebar-drag flex items-center gap-1 h-10 px-20 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
      <div className="titlebar-no-drag flex items-center gap-1">
        <IconButton icon={<AppWindow size={16} />} label="新建窗口" onClick={() => {
          const { theme, editorMode } = useStore.getState()
          window.electronAPI?.newWindow({ theme, editorMode })
        }} />

        <div className="flex items-center gap-0.5 ml-1">
          <IconButton
            icon={<Braces size={16} />}
            label="JSON 模式"
            active={isJson}
            onClick={() => setEditorMode('json')}
          />
          <IconButton
            icon={<FileText size={16} />}
            label="Markdown 模式"
            active={isMarkdown}
            onClick={() => setEditorMode('markdown')}
          />
          <IconButton
            icon={<Code2 size={16} />}
            label="HTML 模式"
            active={isHtml}
            onClick={() => setEditorMode('html')}
          />
        </div>

        <IconButton icon={<FolderOpen size={16} />} label="打开文件" onClick={onOpen} />
        <IconButton icon={<Save size={16} />} label="保存文件" onClick={handleSave} />
        <IconButton icon={<Eraser size={16} />} label="清空左侧输入" onClick={handleClear} />

        {isJson && (
          <>
            <div className="w-px h-5 bg-gray-300 dark:bg-gray-600 mx-1" />
            <IconButton icon={<Braces size={16} />} label="格式化" onClick={onFormat} />
            <IconButton icon={<Minimize2 size={16} />} label="压缩" onClick={onMinify} />
            <IconButton icon={<CheckCircle size={16} />} label="校验" onClick={onValidate} />
          </>
        )}

        {isMarkdown && previewStrategy === 'manual' && (
          <>
            <div className="w-px h-5 bg-gray-300 dark:bg-gray-600 mx-1" />
            <IconButton
              icon={<RefreshCw size={16} />}
              label={isPreviewStale ? '刷新预览（有更新）' : '预览已是最新'}
              active={isPreviewStale}
              onClick={commitMarkdownPreview}
            />
          </>
        )}

        {isMarkdown && (
          <>
            <div className="w-px h-5 bg-gray-300 dark:bg-gray-600 mx-1" />
            <IconButton
              icon={<List size={16} />}
              label={isTocVisible ? '隐藏目录' : '显示目录'}
              active={isTocVisible}
              onClick={toggleToc}
            />
            <IconButton
              icon={isPreviewFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              label={isPreviewFullscreen ? '退出全屏预览' : '全屏预览'}
              active={isPreviewFullscreen}
              onClick={togglePreviewFullscreen}
            />
          </>
        )}

        <div className="w-px h-5 bg-gray-300 dark:bg-gray-600 mx-1" />

        <IconButton
          icon={<WrapText size={16} />}
          label={wordWrap === 'on' ? '自动换行（点击切换为溢出）' : '内容溢出（点击切换为换行）'}
          active={wordWrap === 'on'}
          onClick={toggleWordWrap}
        />
      </div>

      <div className="flex-1 titlebar-drag" />

      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 titlebar-no-drag select-none">
        <FileJson size={14} className="inline mr-1" />
        {fileName ? (
          <span className="inline-block max-w-[240px] truncate align-bottom" title={filePath ?? undefined}>
            {fileName}
          </span>
        ) : (
          'JSON Parse'
        )}
        {isMarkdown && (
          <>
            <span className="ml-2 text-blue-500 dark:text-blue-400">· Markdown</span>
            {previewStrategy !== 'live' && (
              <span
                className={`ml-2 text-[11px] ${
                  previewStrategy === 'disabled'
                    ? 'text-red-500 dark:text-red-400'
                    : 'text-amber-600 dark:text-amber-400'
                }`}
              >
                {previewStrategy === 'disabled' ? '预览已禁用' : '手动刷新模式'}
              </span>
            )}
          </>
        )}
        {isHtml && <span className="ml-2 text-blue-500 dark:text-blue-400">· HTML</span>}
        <span className="ml-2 text-gray-400 dark:text-gray-500">#{windowNumber}</span>
      </span>

      <div className="flex-1 titlebar-drag" />

      <div className="titlebar-no-drag">
        <IconButton
          icon={theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          label="切换主题"
          onClick={toggleTheme}
        />
      </div>
    </div>
  )
}
