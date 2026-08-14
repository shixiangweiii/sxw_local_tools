/**
 * Markdown 标题解析与锚点 id 生成工具。
 * TocSidebar 和 MarkdownPreviewImpl 共用 slugify 逻辑以保证 id 一致性。
 */

export interface HeadingItem {
  id: string // 锚点 id
  text: string // 标题纯文本
  level: number // 1-6
}

/**
 * 将标题文本转为 URL-friendly 的锚点 id。
 * 规则：去除特殊字符、空格转 '-'、小写化。
 * 对于中文等 unicode 字符保留原样。
 */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\s]+/g, '-')
    .replace(/[^\w\u4e00-\u9fff\u3400-\u4dbf\u{20000}-\u{2a6df}\-]/gu, '')
    .replace(/^-+|-+$/g, '')
}

/**
 * 从原始 markdown 文本中提取所有标题（# 至 ######）。
 * 处理重复 id：追加 -1, -2... 后缀。
 */
export function parseHeadings(markdown: string): HeadingItem[] {
  const headings: HeadingItem[] = []
  const idCounts = new Map<string, number>()
  const regex = /^(#{1,6})\s+(.+)$/gm
  let match: RegExpExecArray | null

  while ((match = regex.exec(markdown)) !== null) {
    const level = match[1].length
    const rawText = match[2].replace(/[#`*_~\[\]]/g, '').trim()
    let id = slugify(rawText)

    // 处理重复 id
    const count = idCounts.get(id) ?? 0
    if (count > 0) {
      id = `${id}-${count}`
    }
    idCounts.set(id, count + 1)

    headings.push({ id, text: rawText, level })
  }

  return headings
}
