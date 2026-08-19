import { toString } from 'mdast-util-to-string'
import type { Root } from 'mdast'
import { visit } from 'unist-util-visit'

/** Markdown 标题目录项。 */
export interface HeadingItem {
  id: string // 锚点 id
  text: string // 标题纯文本
  level: number // 1-6
}

type RemarkHeadingPlugin = () => (tree: Root) => void

export interface HeadingCollector {
  headings: HeadingItem[]
  plugin: RemarkHeadingPlugin
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
 * 创建一次 Markdown 渲染专用的标题收集器。
 * 同一个 remark AST 遍历既生成 TOC 数据，也把完全相同的 id 写入最终 DOM。
 */
export function createHeadingCollector(): HeadingCollector {
  const headings: HeadingItem[] = []

  const plugin: RemarkHeadingPlugin = () => (tree) => {
    headings.length = 0
    const usedIds = new Set<string>()

    visit(tree, 'heading', (node) => {
      const text = toString(node, { includeHtml: false }).trim()
      const baseId = slugify(text) || 'section'
      let id = baseId
      let suffix = 1

      // 同时防止重复标题和天然带后缀标题（如 a、a、a-1）发生碰撞。
      while (usedIds.has(id)) {
        id = `${baseId}-${suffix}`
        suffix += 1
      }
      usedIds.add(id)

      node.data = {
        ...node.data,
        hProperties: {
          ...node.data?.hProperties,
          id
        }
      }
      headings.push({ id, text, level: node.depth })
    })
  }

  return { headings, plugin }
}
