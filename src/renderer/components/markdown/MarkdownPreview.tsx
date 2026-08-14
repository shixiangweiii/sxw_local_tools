import { lazy } from 'react'

/**
 * Markdown 预览面板入口（懒加载）。
 * - JSON 模式不会触发 chunk 拉取，避免 mermaid/react-markdown 影响主包体积。
 */
export const MarkdownPreview = lazy(() => import('./MarkdownPreviewImpl'))
