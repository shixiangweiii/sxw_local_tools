import { memo, useDeferredValue, useState, useRef, useEffect, useCallback, useMemo, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import type { Components } from 'react-markdown'
import { MermaidBlock } from './MermaidBlock'
import { createHeadingCollector, type HeadingItem } from '../../utils/tocParser'
import { resolveImageSrc } from '../../utils/resolveImageUrl'
import 'highlight.js/styles/github.css'

// 模块级稳定引用，避免每次渲染都新建数组导致 react-markdown 内部 effect 失效
const REHYPE_PLUGINS = [rehypeHighlight]

interface MarkdownPreviewImplProps {
  text: string
  /** markdown 文件所在目录，用于解析相对路径图片；null 表示无文件上下文 */
  baseDir: string | null
  onHeadingsChange: (headings: HeadingItem[]) => void
}

const LAZY_TABLE_INITIAL = 50
const LAZY_TABLE_BATCH = 50
const LAZY_TABLE_THRESHOLD = 100

function LazyTable({ children }: { children?: ReactNode }): JSX.Element {
  const childArray = Array.isArray(children) ? children : [children]
  const thead = childArray.find(
    (c) => c && typeof c === 'object' && 'type' in c && (c as { type: string }).type === 'thead'
  )
  const tbody = childArray.find(
    (c) => c && typeof c === 'object' && 'type' in c && (c as { type: string }).type === 'tbody'
  )

  if (!tbody || typeof tbody !== 'object' || !('props' in tbody)) {
    return <table>{children}</table>
  }

  const allRows: ReactNode[] = Array.isArray(tbody.props.children)
    ? tbody.props.children
    : [tbody.props.children]

  if (allRows.length <= LAZY_TABLE_THRESHOLD) {
    return <table>{children}</table>
  }

  return <LazyTableInner thead={thead} allRows={allRows} />
}

function LazyTableInner({ thead, allRows }: { thead: ReactNode; allRows: ReactNode[] }): JSX.Element {
  const [visibleCount, setVisibleCount] = useState(LAZY_TABLE_INITIAL)
  const sentinelRef = useRef<HTMLTableRowElement>(null)

  const loadMore = useCallback(() => {
    setVisibleCount((prev) => Math.min(prev + LAZY_TABLE_BATCH, allRows.length))
  }, [allRows.length])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || visibleCount >= allRows.length) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore()
      },
      { rootMargin: '200px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [visibleCount, allRows.length, loadMore])

  const visibleRows = allRows.slice(0, visibleCount)
  const hasMore = visibleCount < allRows.length

  return (
    <table>
      {thead}
      <tbody>
        {visibleRows}
        {hasMore && (
          <tr ref={sentinelRef}>
            <td
              colSpan={99}
              className="text-center text-xs text-gray-400 py-2"
            >
              已显示 {visibleCount} / {allRows.length} 行，滚动加载更多...
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

/**
 * 本地/web 图片统一渲染：lazy 加载 + 加载失败占位符。
 * 失败场景：本地文件不存在、web 图挂掉、无 baseDir 的相对路径。
 */
function MarkdownImage({
  src,
  alt,
  title,
  baseDir
}: {
  src?: string
  alt?: string
  title?: string
  baseDir: string | null
}): JSX.Element {
  const resolved = resolveImageSrc(src ?? '', baseDir)
  const [failed, setFailed] = useState(false)

  if (!resolved || failed) {
    return (
      <span className="inline-flex flex-col items-center gap-1 my-2 px-4 py-3 rounded border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-xs text-gray-400">
        <span>🖼️ 图片无法加载</span>
        {alt ? <span className="max-w-[300px] truncate">{alt}</span> : null}
        {src && !alt ? <span className="max-w-[300px] truncate">{src}</span> : null}
      </span>
    )
  }

  return (
    <img
      src={resolved}
      alt={alt ?? ''}
      title={title}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}

function createComponents(baseDir: string | null): Components {
  return {
    table: LazyTable,
    img: ({ src, alt, title }) => (
      // key 绑定解析结果：src 修改后强制重挂载，避免 failed 状态残留导致新图片仍显示占位符
      <MarkdownImage key={resolveImageSrc(src ?? '', baseDir)} src={src} alt={alt} title={title} baseDir={baseDir} />
    ),
    code({ className, children, ...rest }) {
      const match = /language-([\w-]+)/.exec(className ?? '')
      const lang = match?.[1]
      const raw = String(children ?? '').replace(/\n$/, '')

      if (lang === 'mermaid') {
        return <MermaidBlock code={raw} />
      }
      return (
        <code className={className} {...rest}>
          {children}
        </code>
      )
    }
  }
}

/**
 * Markdown 预览实现（实际打包到独立 chunk）。
 * 性能特性：
 * - useDeferredValue 让大文档渲染让步主线程，输入更顺滑
 * - 顶部"渲染中"条状提示让用户感知后台进度
 * - React.memo 包裹整个组件，prop 等值即跳过
 */
function MarkdownPreviewImpl({ text, baseDir, onHeadingsChange }: MarkdownPreviewImplProps): JSX.Element {
  const deferred = useDeferredValue(text)
  const isPending = deferred !== text
  const headingCollector = useMemo(() => createHeadingCollector(), [deferred])
  const remarkPlugins = useMemo(
    () => [remarkGfm, headingCollector.plugin],
    [headingCollector]
  )
  // baseDir 不变时保持 components 引用稳定，避免 react-markdown 整树重渲染
  const components = useMemo(() => createComponents(baseDir), [baseDir])

  // ReactMarkdown 已同步完成本轮 AST 转换；提交后再把同一批标题交给 TOC。
  useEffect(() => {
    onHeadingsChange([...headingCollector.headings])
  }, [headingCollector, onHeadingsChange])

  return (
    <div className="markdown-preview-root h-full overflow-auto bg-white dark:bg-gray-900 relative">
      {isPending && (
        <div className="sticky top-0 z-10 bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-200 text-xs px-3 py-1 border-b border-blue-200 dark:border-blue-800">
          正在渲染最新内容...
        </div>
      )}
      <article className="prose prose-sm dark:prose-invert max-w-none p-6">
        {deferred.trim() ? (
          <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={REHYPE_PLUGINS} components={components}>
            {deferred}
          </ReactMarkdown>
        ) : (
          <p className="text-gray-400">在左侧输入 Markdown 内容以预览，支持 GFM 与 Mermaid 图表。</p>
        )}
      </article>
    </div>
  )
}

export default memo(MarkdownPreviewImpl)
