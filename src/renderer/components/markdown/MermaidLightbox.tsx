import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, ZoomIn, ZoomOut, Maximize2, Scan } from 'lucide-react'

const MIN_SCALE = 0.1
const MAX_SCALE = 8
const ZOOM_STEP = 1.2
/** 适配窗口时留出的边距系数 */
const FIT_PADDING_RATIO = 0.98
/** 适配窗口只做缩小不做放大：小图保持原始尺寸，需要放大用滚轮或 + 按钮 */
const MAX_FIT_SCALE = 1

interface MermaidLightboxProps {
  /** 已渲染完成的 SVG 字符串（复用 MermaidBlock 的渲染结果） */
  svg: string
  /** MermaidBlock 中该图表的根 svg id，用于重写为灯箱专属 id */
  domId: string
  onClose: () => void
}

interface Transform {
  scale: number
  tx: number
  ty: number
}

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

/**
 * Mermaid 图表放大查看灯箱。
 * - 复用已渲染的 SVG 字符串，不重复调用 mermaid.render
 * - 整串替换 id token，避免与内联图表出现重复 id（同时保留 mermaid 注入的 scoped <style>）
 * - 打开即适配窗口，支持滚轮以光标为锚点缩放、拖拽平移、双击在适配/1:1 间切换
 * - Escape 在 window 捕获阶段处理并阻止冒泡，优先于 App 的退出全屏预览逻辑
 */
export function MermaidLightbox({ svg, domId, onClose }: MermaidLightboxProps): JSX.Element {
  const canvasRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  /** 图表自然尺寸（来自 viewBox），未测量前为 null */
  const naturalSizeRef = useRef<{ width: number; height: number } | null>(null)
  const [transform, setTransform] = useState<Transform>({ scale: 1, tx: 0, ty: 0 })
  /** 当前是否处于「适配窗口」态，供双击在适配 / 1:1 间切换 */
  const [fitMode, setFitMode] = useState(true)
  /** 拖拽中记录上一次指针位置，按增量平移，无需读取当前 transform */
  const draggingRef = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null)
  /** 平移增量按帧合并：pointermove 只累加到 ref，rAF 里一次性写入 state */
  const pendingPanRef = useRef({ dx: 0, dy: 0 })
  const panRafRef = useRef<number | null>(null)
  /** 滚轮缩放按帧合并：一帧内多次事件的 factor 相乘，anchor 取最后一次（近似即可） */
  const pendingWheelRef = useRef<{ factor: number; x: number; y: number } | null>(null)
  const wheelRafRef = useRef<number | null>(null)

  // 重写 id：该 token 唯一，且 <style> 选择器 / marker id / url(#...) 引用均由它派生，整串替换后自洽
  const zoomSvg = useMemo(() => svg.split(domId).join(`${domId}-zoom`), [svg, domId])

  /** 以给定 scale 居中放置图表 */
  const applyCentered = useCallback((scale: number) => {
    const canvas = canvasRef.current
    const natural = naturalSizeRef.current
    if (!canvas || !natural || natural.width <= 0 || natural.height <= 0) return
    const next = clampScale(scale)
    setTransform({
      scale: next,
      tx: (canvas.clientWidth - natural.width * next) / 2,
      ty: (canvas.clientHeight - natural.height * next) / 2
    })
  }, [])

  /** 计算「适配窗口」的 scale */
  const getFitScale = useCallback((): number => {
    const canvas = canvasRef.current
    const natural = naturalSizeRef.current
    if (!canvas || !natural || natural.width <= 0 || natural.height <= 0) return 1
    const fit = Math.min(canvas.clientWidth / natural.width, canvas.clientHeight / natural.height)
    return clampScale(Math.min(fit * FIT_PADDING_RATIO, MAX_FIT_SCALE))
  }, [])

  const fitToWindow = useCallback(() => {
    applyCentered(getFitScale())
    setFitMode(true)
  }, [applyCentered, getFitScale])

  const resetToActualSize = useCallback(() => {
    applyCentered(1)
    setFitMode(false)
  }, [applyCentered])

  // 测量自然尺寸并解除 mermaid 默认的 100% 宽度 / max-width 约束，随后适配窗口
  useLayoutEffect(() => {
    const layer = layerRef.current
    if (!layer) return
    const svgEl = layer.querySelector('svg')
    if (!svgEl) return

    const viewBox = svgEl.getAttribute('viewBox')?.split(/[\s,]+/).map(Number)
    let width = 0
    let height = 0
    if (viewBox && viewBox.length === 4 && Number.isFinite(viewBox[2]) && Number.isFinite(viewBox[3])) {
      width = viewBox[2]
      height = viewBox[3]
    }
    if (width <= 0 || height <= 0) {
      const rect = svgEl.getBoundingClientRect()
      width = rect.width
      height = rect.height
    }

    svgEl.style.maxWidth = 'none'
    svgEl.setAttribute('width', String(width))
    svgEl.setAttribute('height', String(height))
    naturalSizeRef.current = { width, height }

    applyCentered(getFitScale())
  }, [zoomSvg, applyCentered, getFitScale])

  /**
   * 围绕画布内某点缩放。
   * 用函数式更新读取最新 transform：滚轮 / 连点可能在两次渲染之间连续触发，读快照会丢步。
   */
  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    setTransform((prev) => {
      const next = clampScale(prev.scale * factor)
      if (next === prev.scale) return prev
      const k = next / prev.scale
      return {
        scale: next,
        tx: cx - (cx - prev.tx) * k,
        ty: cy - (cy - prev.ty) * k
      }
    })
  }, [])

  /** rAF 回调：把累积的平移增量一次性 apply 到 state，一帧最多触发一次 React commit */
  const flushPan = useCallback(() => {
    panRafRef.current = null
    const { dx, dy } = pendingPanRef.current
    if (dx === 0 && dy === 0) return
    pendingPanRef.current = { dx: 0, dy: 0 }
    setTransform((prev) => ({ scale: prev.scale, tx: prev.tx + dx, ty: prev.ty + dy }))
  }, [])

  /** 围绕画布中心缩放（工具条与键盘使用） */
  const zoomByStep = useCallback(
    (factor: number) => {
      const canvas = canvasRef.current
      if (!canvas) return
      zoomAt(factor, canvas.clientWidth / 2, canvas.clientHeight / 2)
    },
    [zoomAt]
  )

  // 滚轮缩放：React 的 onWheel 在 root 上是 passive，preventDefault 无效，故手动注册
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const flushWheel = (): void => {
      wheelRafRef.current = null
      const p = pendingWheelRef.current
      if (!p) return
      pendingWheelRef.current = null
      zoomAt(p.factor, p.x, p.y)
    }
    const handleWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const factor = Math.exp(-e.deltaY * 0.002)
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const prev = pendingWheelRef.current
      // 同一帧内多次 wheel：factor 相乘，anchor 采用最后一次坐标
      pendingWheelRef.current = prev ? { factor: prev.factor * factor, x, y } : { factor, x, y }
      if (wheelRafRef.current == null) {
        wheelRafRef.current = requestAnimationFrame(flushWheel)
      }
    }
    canvas.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      canvas.removeEventListener('wheel', handleWheel)
      if (wheelRafRef.current != null) {
        cancelAnimationFrame(wheelRafRef.current)
        wheelRafRef.current = null
      }
      pendingWheelRef.current = null
    }
  }, [zoomAt])

  // 键盘：Esc 关闭（捕获阶段 + stopPropagation，避免触发 App 的退出全屏预览）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === '+' || e.key === '=') {
        e.preventDefault()
        zoomByStep(ZOOM_STEP)
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        zoomByStep(1 / ZOOM_STEP)
      } else if (e.key === '0') {
        e.preventDefault()
        fitToWindow()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [onClose, zoomByStep, fitToWindow])

  // 卸载时取消挂起的平移 rAF（wheel rAF 由其自身 effect 的 cleanup 处理）
  useEffect(() => {
    return () => {
      if (panRafRef.current != null) {
        cancelAnimationFrame(panRafRef.current)
        panRafRef.current = null
      }
      pendingPanRef.current = { dx: 0, dy: 0 }
    }
  }, [])

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    // 不调 preventDefault：避免影响 dblclick 等兼容鼠标事件，拖拽时的文字框选已由画布的 select-none 阻止
    draggingRef.current = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const drag = draggingRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    pendingPanRef.current.dx += e.clientX - drag.lastX
    pendingPanRef.current.dy += e.clientY - drag.lastY
    drag.lastX = e.clientX
    drag.lastY = e.clientY
    if (panRafRef.current == null) {
      panRafRef.current = requestAnimationFrame(flushPan)
    }
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    const drag = draggingRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    draggingRef.current = null
    // 释放瞬间同步 flush 挂起的增量，图像立刻停在最终位置，避免落后一帧
    if (panRafRef.current != null) {
      cancelAnimationFrame(panRafRef.current)
      panRafRef.current = null
      flushPan()
    }
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  // 双击：适配窗口 <-> 1:1
  const handleDoubleClick = (): void => {
    if (fitMode) {
      resetToActualSize()
    } else {
      fitToWindow()
    }
  }

  const content = (
    <div data-mermaid-lightbox="open" className="fixed inset-0 z-[9999] flex flex-col bg-black/70">
      {/* 工具条 */}
      <div className="flex items-center gap-1 h-10 px-3 bg-gray-900/95 border-b border-gray-700 text-xs text-gray-200 select-none">
        <button
          className="p-1.5 rounded text-gray-300 hover:text-white hover:bg-gray-700 transition-colors"
          title="缩小（-）"
          onClick={() => zoomByStep(1 / ZOOM_STEP)}
        >
          <ZoomOut size={16} />
        </button>
        <span className="w-14 text-center font-mono text-gray-300">
          {Math.round(transform.scale * 100)}%
        </span>
        <button
          className="p-1.5 rounded text-gray-300 hover:text-white hover:bg-gray-700 transition-colors"
          title="放大（+）"
          onClick={() => zoomByStep(ZOOM_STEP)}
        >
          <ZoomIn size={16} />
        </button>
        <div className="w-px h-5 bg-gray-700 mx-1" />
        <button
          className="p-1.5 rounded text-gray-300 hover:text-white hover:bg-gray-700 transition-colors"
          title="适配窗口（0）"
          onClick={fitToWindow}
        >
          <Scan size={16} />
        </button>
        <button
          className="p-1.5 rounded text-gray-300 hover:text-white hover:bg-gray-700 transition-colors"
          title="原始尺寸 1:1"
          onClick={resetToActualSize}
        >
          <Maximize2 size={16} />
        </button>

        <span className="ml-3 text-[11px] text-gray-400">
          滚轮缩放 · 拖拽平移 · 双击切换 · Esc 关闭
        </span>

        <div className="flex-1" />

        <button
          className="p-1.5 rounded text-gray-300 hover:text-white hover:bg-gray-700 transition-colors"
          title="关闭（Esc）"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>

      {/* 画布 */}
      <div
        ref={canvasRef}
        className="flex-1 relative overflow-hidden select-none bg-white dark:bg-gray-900 cursor-grab active:cursor-grabbing"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      >
        <div
          ref={layerRef}
          className="mermaid-zoom-layer absolute left-0 top-0"
          style={{
            transform: `translate(${transform.tx}px, ${transform.ty}px) scale(${transform.scale})`,
            transformOrigin: '0 0'
          }}
          dangerouslySetInnerHTML={{ __html: zoomSvg }}
        />
      </div>
    </div>
  )

  return createPortal(content, document.body)
}
