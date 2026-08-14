/**
 * Markdown 预览性能阈值与策略选择。
 * 这里是单一事实来源（SoT），Toolbar / Subscriber / Editor 都从此处读取。
 */

/** 实时预览的上限：超过此长度后强制进入 manual 模式 */
export const PREVIEW_LIVE_LIMIT = 300 * 1024 // 300 KB

/** 手动预览的上限：超过此长度后预览整体禁用 */
export const PREVIEW_MANUAL_LIMIT = 5 * 1024 * 1024 // 5 MB

/** 单次粘贴超过此大小时弹出 toast 预警 */
export const PASTE_WARN_LIMIT = 1 * 1024 * 1024 // 1 MB

/** 单个 mermaid 代码块字符数上限，超过则降级显示 */
export const MERMAID_CODE_LIMIT = 50 * 1024 // 50 KB

/** 同时进行的 mermaid 渲染最大并发 */
export const MERMAID_MAX_CONCURRENCY = 2

export type PreviewStrategy = 'live' | 'manual' | 'disabled'

const encoder = new TextEncoder()

export function getByteLength(text: string): number {
  return encoder.encode(text).byteLength
}

export function pickStrategy(byteLength: number): PreviewStrategy {
  if (byteLength >= PREVIEW_MANUAL_LIMIT) return 'disabled'
  if (byteLength >= PREVIEW_LIVE_LIMIT) return 'manual'
  return 'live'
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}
