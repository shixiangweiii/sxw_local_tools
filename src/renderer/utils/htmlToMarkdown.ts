import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'

/**
 * HTML → Markdown 转换：基于 turndown + turndown-plugin-gfm。
 * 仅供 HTML 模式右侧"复制为 MD"按钮使用；JSON / Markdown 模式不会触发。
 *
 * - 表格 / 删除线 / 任务列表通过 GFM 插件支持
 * - 链接 inline 输出，代码块 fenced，标题 ATX 风格
 * - 提取 <title> 作为 # 标题前置（若有）
 * - 多余空行压成单空行
 */

let serviceCache: TurndownService | null = null

function buildService(): TurndownService {
  const td = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    fence: '```',
    emDelimiter: '_',
    strongDelimiter: '**',
    linkStyle: 'inlined'
  })
  td.use(gfm)

  // 双保险：仍残留的无 href 裸 a 输出为纯文本
  td.addRule('strip-bare-anchor', {
    filter: (node) =>
      node.nodeName === 'A' && !(node as HTMLElement).getAttribute('href'),
    replacement: (content) => content
  })

  // 双保险：仍残留的无 alt img 输出为空（htmlSanitize 已删，此处兜底）
  td.addRule('drop-bare-img', {
    filter: (node) =>
      node.nodeName === 'IMG' && !(node as HTMLElement).getAttribute('alt'),
    replacement: () => ''
  })

  return td
}

export function htmlToMarkdown(html: string): string {
  if (!html.trim()) return ''
  if (!serviceCache) serviceCache = buildService()

  // 提取 <title> 前置为 # 标题；正文取 body.innerHTML
  // body 在 text/html 模式下永远存在；即使为空也给空串，避免原文（含 head/title）被 turndown 二次读取导致 title 重复输出
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const title = doc.querySelector('title')?.textContent?.trim()
  const body = doc.body ? doc.body.innerHTML : ''

  let md = serviceCache.turndown(body)
  if (title) md = `# ${title}\n\n${md}`

  // 连续 ≥3 空行压成单空行；去掉首尾空白
  md = md.replace(/\n{3,}/g, '\n\n').trim()
  return md
}
