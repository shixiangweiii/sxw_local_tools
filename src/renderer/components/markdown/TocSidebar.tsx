import { useEffect, useRef, useState, useCallback, useMemo, memo } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import type { HeadingItem } from '../../utils/tocParser'

interface TocSidebarProps {
  headings: HeadingItem[]
  scrollContainer: HTMLElement | null
}

/**
 * 判断某个 heading 是否有子标题（即后续存在 level 更深的标题）
 */
function hasChildren(headings: HeadingItem[], index: number): boolean {
  if (index >= headings.length - 1) return false
  return headings[index + 1].level > headings[index].level
}

/**
 * 根据 collapsedIds 计算可见的 heading 索引集合。
 * 当某个 heading 被折叠时，隐藏它之后所有 level 更深的连续子标题。
 */
function computeVisibleIndices(headings: HeadingItem[], collapsedIds: Set<string>): Set<number> {
  const visible = new Set<number>()
  let skipUntilLevel = Infinity

  for (let i = 0; i < headings.length; i++) {
    const h = headings[i]
    // 如果当前 heading 的 level <= skipUntilLevel，说明跳过区间结束
    if (h.level <= skipUntilLevel) {
      skipUntilLevel = Infinity
    }

    if (skipUntilLevel !== Infinity && h.level > skipUntilLevel) {
      // 被折叠隐藏
      continue
    }

    visible.add(i)

    // 如果当前 heading 处于折叠状态，标记跳过后续更深层级
    if (collapsedIds.has(h.id)) {
      skipUntilLevel = h.level
    }
  }

  return visible
}

/**
 * Markdown 目录侧栏组件。
 * - 根据 heading level 缩进渲染标题列表
 * - 支持折叠/展开子标题
 * - 点击标题平滑滚动到对应位置
 * - IntersectionObserver 监听 heading 可见性，高亮当前阅读位置
 */
const DEFAULT_WIDTH = 200
const MIN_WIDTH = 120
const MAX_WIDTH = 400

export const TocSidebar = memo(function TocSidebar({ headings, scrollContainer }: TocSidebarProps): JSX.Element {
  const [activeId, setActiveId] = useState<string>('')
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const isDraggingRef = useRef(false)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const tocListRef = useRef<HTMLDivElement>(null)

  // 拖拽调整宽度
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDraggingRef.current = true
    const startX = e.clientX
    const startWidth = width

    const handleMouseMove = (moveEvent: MouseEvent): void => {
      if (!isDraggingRef.current) return
      const delta = moveEvent.clientX - startX
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta))
      setWidth(newWidth)
    }

    const handleMouseUp = (): void => {
      isDraggingRef.current = false
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [width])

  // 计算可见标题索引
  const visibleIndices = useMemo(
    () => computeVisibleIndices(headings, collapsedIds),
    [headings, collapsedIds]
  )

  // 设置 IntersectionObserver 监听所有 heading 元素
  useEffect(() => {
    if (!scrollContainer || headings.length === 0) return

    // 清理旧 observer
    observerRef.current?.disconnect()

    const headingElements: Element[] = []
    for (const heading of headings) {
      const el = scrollContainer.querySelector(`#${CSS.escape(heading.id)}`)
      if (el) headingElements.push(el)
    }

    if (headingElements.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        // 找到最靠近顶部的可见 heading
        const visibleEntries = entries.filter((e) => e.isIntersecting)
        if (visibleEntries.length > 0) {
          const closest = visibleEntries.reduce((a, b) =>
            a.boundingClientRect.top < b.boundingClientRect.top ? a : b
          )
          setActiveId(closest.target.id)
        }
      },
      {
        root: scrollContainer,
        rootMargin: '-10% 0px -70% 0px',
        threshold: 0
      }
    )

    for (const el of headingElements) {
      observer.observe(el)
    }
    observerRef.current = observer

    return () => observer.disconnect()
  }, [headings, scrollContainer])

  const handleClick = useCallback((id: string) => {
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setActiveId(id)
    }
  }, [])

  const handleToggleCollapse = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  // 当 activeId 变化时，确保 TOC 列表中对应项可见
  useEffect(() => {
    if (!activeId || !tocListRef.current) return
    const activeEl = tocListRef.current.querySelector(`[data-toc-id="${activeId}"]`)
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [activeId])

  if (headings.length === 0) return <></>

  // 计算最小 level 用于相对缩进
  const minLevel = Math.min(...headings.map((h) => h.level))

  return (
    <div className="h-full flex shrink-0" style={{ width: `${width}px` }}>
      <div className="h-full flex-1 min-w-0 border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex flex-col">
        <div className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700 shrink-0">
          目录
        </div>
        <div ref={tocListRef} className="flex-1 overflow-y-auto py-1">
          {headings.map((heading, index) => {
            if (!visibleIndices.has(index)) return null

            const indent = (heading.level - minLevel) * 12
            const isActive = heading.id === activeId
            const canCollapse = hasChildren(headings, index)
            const isCollapsed = collapsedIds.has(heading.id)

            return (
              <div
                key={heading.id}
                data-toc-id={heading.id}
                className={`flex items-center w-full text-xs leading-relaxed transition-colors
                  ${isActive
                    ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 border-l-2 border-blue-500'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700/50 border-l-2 border-transparent'
                  }`}
                style={{ paddingLeft: `${4 + indent}px` }}
              >
                {/* 折叠/展开按钮 */}
                {canCollapse ? (
                  <button
                    className="shrink-0 w-4 h-4 flex items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-gray-600 cursor-pointer"
                    onClick={(e) => handleToggleCollapse(heading.id, e)}
                    title={isCollapsed ? '展开' : '折叠'}
                  >
                    {isCollapsed
                      ? <ChevronRight size={12} />
                      : <ChevronDown size={12} />
                    }
                  </button>
                ) : (
                  <span className="shrink-0 w-4" />
                )}
                {/* 标题文本 */}
                <button
                  className="flex-1 text-left py-1 pl-1 truncate cursor-pointer"
                  onClick={() => handleClick(heading.id)}
                  title={heading.text}
                >
                  {heading.text}
                </button>
              </div>
            )
          })}
        </div>
      </div>
      {/* 拖拽分隔条 */}
      <div
        className="w-1 h-full cursor-col-resize hover:bg-blue-400 dark:hover:bg-blue-500 active:bg-blue-500 transition-colors shrink-0"
        onMouseDown={handleDragStart}
        title="拖拽调整目录宽度"
      />
    </div>
  )
})
