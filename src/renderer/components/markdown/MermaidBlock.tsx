import { useEffect, useId, useRef, useState } from 'react'
import type mermaidAPI from 'mermaid'
import { useStore } from '../../store'
import { MermaidLightbox } from './MermaidLightbox'
import { MERMAID_CODE_LIMIT, MERMAID_MAX_CONCURRENCY, formatBytes } from './perfThresholds'

// ---- mermaid 懒加载单例 ----
let mermaidInstance: typeof mermaidAPI | null = null
let mermaidPromise: Promise<typeof mermaidAPI> | null = null

/** 懒加载 mermaid 库，全局只加载一次；加载失败时重置以允许重试 */
async function loadMermaid(): Promise<typeof mermaidAPI> {
  if (mermaidInstance) return mermaidInstance
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => {
      mermaidInstance = m.default
      return mermaidInstance
    }).catch((err) => {
      mermaidPromise = null
      throw err
    })
  }
  return mermaidPromise
}

let lastTheme: 'dark' | 'light' | null = null

async function ensureMermaid(theme: 'dark' | 'light'): Promise<typeof mermaidAPI> {
  const mermaid = await loadMermaid()
  if (lastTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      theme: theme === 'dark' ? 'dark' : 'default',
      securityLevel: 'strict',
      fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif'
    })
    lastTheme = theme
  }
  return mermaid
}

// ---- 全局并发限流 ----
let inFlight = 0
const pending: Array<() => void> = []

async function withSlot<T>(task: () => Promise<T>): Promise<T> {
  if (inFlight >= MERMAID_MAX_CONCURRENCY) {
    await new Promise<void>((resolve) => pending.push(resolve))
  }
  inFlight++
  try {
    return await task()
  } finally {
    inFlight--
    pending.shift()?.()
  }
}

interface MermaidBlockProps {
  code: string
}

/**
 * 单个 Mermaid 代码块的渲染组件。
 * 性能特性：
 * - 视口懒渲染（IntersectionObserver, rootMargin: 200px）
 * - 代码大小硬上限（MERMAID_CODE_LIMIT）
 * - mermaid.parse 预校验，避免错误时残留 DOM
 * - 全局 Promise 限流（MERMAID_MAX_CONCURRENCY）
 * - 主题切换 / code 变化触发重新渲染
 * 交互特性：
 * - 点击图表打开灯箱放大查看（可缩放 / 拖拽）
 */
export function MermaidBlock({ code }: MermaidBlockProps): JSX.Element {
  const theme = useStore((s) => s.theme)
  const reactId = useId()
  const domId = `mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, '_')}`
  const containerRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zoomOpen, setZoomOpen] = useState(false)

  const tooLarge = code.length > MERMAID_CODE_LIMIT

  // 视口可见性监听：进入视口（含 200px 提前量）后开始渲染
  useEffect(() => {
    if (visible || tooLarge) return
    const el = containerRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true)
            observer.disconnect()
            break
          }
        }
      },
      { rootMargin: '200px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [visible, tooLarge])

  // 实际渲染：可见且尺寸合规时执行
  useEffect(() => {
    if (!visible || tooLarge) return
    let cancelled = false
    setError(null)

    ;(async () => {
      try {
        const mermaid = await ensureMermaid(theme)
        if (cancelled) return
        // 预校验：失败时不调 render，避免残留 DOM
        await mermaid.parse(code)
        if (cancelled) return
        const { svg: rendered } = await withSlot(() => mermaid.render(domId, code))
        if (!cancelled) setSvg(rendered)
      } catch (err) {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        setSvg(null)
      }
    })()

    return () => { cancelled = true }
  }, [code, theme, domId, visible, tooLarge])

  if (tooLarge) {
    return (
      <div className="not-prose my-4 rounded border border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/30 p-3 text-xs">
        <div className="text-yellow-700 dark:text-yellow-200 font-medium mb-1">
          Mermaid 图表过大（{formatBytes(code.length)}），已跳过渲染
        </div>
        <pre className="whitespace-pre-wrap text-gray-600 dark:text-gray-400 max-h-40 overflow-auto">{code}</pre>
      </div>
    )
  }

  if (error) {
    return (
      <div className="not-prose my-4 rounded border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/30 p-3 text-xs">
        <div className="text-red-600 dark:text-red-300 font-medium mb-1">Mermaid 渲染错误</div>
        <pre className="whitespace-pre-wrap text-red-700 dark:text-red-200">{error}</pre>
        <pre className="mt-2 whitespace-pre-wrap text-gray-600 dark:text-gray-400">{code}</pre>
      </div>
    )
  }

  if (!visible) {
    return (
      <div
        ref={containerRef}
        className="not-prose my-4 min-h-[80px] flex items-center justify-center rounded border border-dashed border-gray-300 dark:border-gray-600 text-xs text-gray-400"
      >
        滚动至此处自动渲染 Mermaid 图表
      </div>
    )
  }

  if (!svg) {
    return (
      <div
        ref={containerRef}
        className="not-prose my-4 min-h-[80px] flex items-center justify-center text-xs text-gray-400"
      >
        Mermaid 渲染中...
      </div>
    )
  }

  // 正在框选本图内文字时不触发放大；文档其他位置的残留选区不影响本次点击
  const openZoom = (): void => {
    const selection = window.getSelection()
    if (
      selection &&
      !selection.isCollapsed &&
      containerRef.current?.contains(selection.anchorNode)
    ) {
      return
    }
    setZoomOpen(true)
  }

  return (
    <div ref={containerRef} className="not-prose my-4 relative group">
      <div
        role="button"
        tabIndex={0}
        aria-label="放大查看 Mermaid 图表"
        title="点击放大查看（可缩放 / 拖拽）"
        className="flex justify-center overflow-auto cursor-zoom-in"
        onClick={openZoom}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            openZoom()
          }
        }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <span className="pointer-events-none absolute right-2 top-2 px-1.5 py-0.5 rounded bg-gray-900/70 text-[11px] text-white opacity-0 group-hover:opacity-100 transition-opacity">
        点击放大
      </span>
      {zoomOpen && (
        <MermaidLightbox svg={svg} domId={domId} onClose={() => setZoomOpen(false)} />
      )}
    </div>
  )
}
