/** 重载前把 Monaco 尚未防抖落库的 Markdown 文本刷进 store。由 MonacoEditor 注册。 */
type MarkdownFlush = () => void

let flushMarkdown: MarkdownFlush | null = null

export function registerMarkdownFlush(flush: MarkdownFlush | null): void {
  flushMarkdown = flush
}

export function flushMarkdownEditorNow(): void {
  flushMarkdown?.()
}
