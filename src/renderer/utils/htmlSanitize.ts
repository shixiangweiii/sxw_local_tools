/**
 * HTML 解析模式：去除所有 CSS / Script / 装饰类 / 追踪类 / 自定义属性 / 表现型标准属性，输出纯结构 HTML。
 *
 * 处理策略：极小化的**属性白名单**，只保留表达"文档骨架 + 内容传递"绝对必需的属性。
 * 白名单外一律删除，包含但不限于：
 *  - 装饰类：style、class、id、title、role、tabindex、hidden
 *  - 表现型标准：width、height、align、valign、bgcolor、color、border、cellpadding、cellspacing、nowrap 等
 *  - 交互/表单功能：type、name、value、action、method、placeholder、disabled、checked、target、for 等
 *  - 媒体行为：controls、autoplay、loop、muted、poster
 *  - 追踪/自定义：data-* 、aria-*、on*、itemprop 等微数据
 *  - 加载优化：crossorigin / integrity / referrerpolicy / loading / decoding / srcset 等
 *  - 前端框架指令：v-xxx、x-xxx、@xxx、:xxx 等
 *
 * 同时：
 *  - 删除整段 <script>（内联与外链）
 *  - 删除整段 <style>
 *  - 删除 <link rel*="stylesheet">
 *  - 去除 href/src 中的 javascript: 协议
 *
 * 保留：DOCTYPE、HTML 结构、文本、注释、以及白名单内的属性。
 */

/** 极小化属性白名单：只有在该集合内的属性才会被保留。 */
const KEEP_ATTRS: ReadonlySet<string> = new Set([
  // 文档元数据（meta 编码与内容协商）
  'charset', 'http-equiv', 'content',
  // 资源链接（href/src 还会后续检查 javascript: 协议）
  'href', 'src', 'alt',
  // 表格结构（合并单元格依赖）
  'colspan', 'rowspan', 'span'
])

/** Void 元素：本身不能包含子节点，但有语义/功能价值，不参与空元素过滤。 */
const VOID_ELEMENTS: ReadonlySet<string> = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'source', 'track', 'wbr'
])

/**
 * 标签黑名单：针对训练 / RAG 场景全量删除的噪声标签（含子节点一起删）。
 * 不仅是表现性，这些标签从语义层面也不携带下游 LLM 需要的信息。
 */
const REMOVE_TAGS: ReadonlySet<string> = new Set([
  // 模板布局（标准级噪声压制）
  'nav', 'header', 'footer', 'aside',
  // 交互 / 表单（RAG 无价值）
  'form', 'input', 'button', 'select', 'textarea', 'label',
  'fieldset', 'legend', 'dialog', 'option', 'optgroup',
  'output', 'progress', 'meter', 'datalist',
  // 嵌入容器
  'iframe', 'embed', 'object', 'canvas', 'svg',
  // 多媒体
  'video', 'audio', 'picture', 'source', 'track',
  // 占位 / 技术
  'noscript', 'template', 'slot',
  // 表格列定义（void 元素，对 RAG 无价值）
  'col'
])

/**
 * 始终 unwrap 的标签：移除该标签本身但保留全部子节点。
 * 适用于“装饰型壳子”：图标占位 <i>、表格装饰包裹 <colgroup>/<tbody>/<thead>/<tfoot>。
 */
const ALWAYS_UNWRAP: ReadonlySet<string> = new Set([
  'i',
  'colgroup', 'tbody', 'thead', 'tfoot'
])

/** 决定“单子节点决定包裹”能被解除的纯结构容器。 */
const UNWRAPPABLE: ReadonlySet<string> = new Set([
  'div', 'span', 'section', 'article', 'figure', 'figcaption', 'main'
])

/** 删除黑名单标签（含子节点整段移除）。 */
function removeBlacklistedTags(doc: Document): void {
  const selector = Array.from(REMOVE_TAGS).join(',')
  doc.querySelectorAll(selector).forEach((el) => el.remove())
}

/** 删除所有注释节点。 */
function removeComments(doc: Document): void {
  const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_COMMENT)
  const comments: Comment[] = []
  let n: Node | null
  while ((n = walker.nextNode())) comments.push(n as Comment)
  for (const c of comments) c.remove()
}

/**
 * 文本节点规范化：
 *  - 跳过 <pre>/<code> 子树（代码原样保留）
 *  - 零宽 / 软连字符清除
 *  - 不间断空格 \u00A0 → 普通空格（避免序列化变回 &nbsp;）
 *  - 连续空白（tab/\n/\r/空格）压缩为单个空格
 */
function normalizeTextNodes(doc: Document): void {
  const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_TEXT)
  const texts: Text[] = []
  let n: Node | null
  while ((n = walker.nextNode())) texts.push(n as Text)
  for (const t of texts) {
    if ((t.parentElement as Element | null)?.closest('pre, code')) continue
    let s = t.data
    s = s.replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '')
    s = s.replace(/\u00A0/g, ' ')
    s = s.replace(/[\t\n\r ]+/g, ' ')
    t.data = s
  }
}

/** 清理无意义的白名单属性值：空 alt、空/纯锚点 href。 */
function pruneUselessAttrs(doc: Document): void {
  doc.querySelectorAll('[alt]').forEach((el) => {
    if ((el.getAttribute('alt') ?? '').trim() === '') el.removeAttribute('alt')
  })
  doc.querySelectorAll('[href]').forEach((el) => {
    const v = (el.getAttribute('href') ?? '').trim()
    if (v === '' || v.startsWith('#')) el.removeAttribute('href')
  })
}

/**
 * 删除不携带信息的 <img>：
 * pruneUselessAttrs 会将空 alt 属性删除，此处一并删除“无 alt”的 img（一般为头像、图标、装饰图）。
 * 保留带 alt 的 img（alt 代表该图的语义描述，对 RAG 有价值）。
 */
function pruneUninformativeImages(doc: Document): void {
  doc.querySelectorAll('img').forEach((el) => {
    if (!el.hasAttribute('alt')) el.remove()
  })
}

/** 一次性 unwrap：将指定标签节点本身移除但保留其所有子节点。 */
function unwrapAlways(doc: Document): void {
  const selector = Array.from(ALWAYS_UNWRAP).join(',')
  // 快照后再处理，避免边遍历边修改
  Array.from(doc.querySelectorAll(selector)).forEach((el) => {
    const parent = el.parentNode
    if (!parent) return
    while (el.firstChild) parent.insertBefore(el.firstChild, el)
    parent.removeChild(el)
  })
}

/**
 * 裸 <a> unwrap：attributes.length === 0 （href 已被过滤）的 a 失去语义，剖为其子节点。
 */
function unwrapBareAnchors(doc: Document): void {
  Array.from(doc.querySelectorAll('a')).forEach((el) => {
    if (el.attributes.length !== 0) return
    const parent = el.parentNode
    if (!parent) return
    while (el.firstChild) parent.insertBefore(el.firstChild, el)
    parent.removeChild(el)
  })
}

/**
 * 解除冗余包裹：容器为 UNWRAPPABLE 中的纯结构标签，且
 *  - 自身无属性
 *  - 子节点（忽略纯空白文本）只有一个且为元素
 * 则用唯一子元素替换自身。循环直到稳定，处理深嵌套。
 */
function unwrapRedundant(doc: Document): void {
  let changed = true
  let guard = 0
  while (changed && guard++ < 20) {
    changed = false
    const all = Array.from(doc.querySelectorAll('*'))
    for (let i = all.length - 1; i >= 0; i--) {
      const el = all[i]
      if (!UNWRAPPABLE.has(el.tagName.toLowerCase())) continue
      if (el.attributes.length > 0) continue
      const meaningful = Array.from(el.childNodes).filter(
        (c) =>
          c.nodeType === Node.ELEMENT_NODE ||
          (c.nodeType === Node.TEXT_NODE && (c.textContent ?? '').trim() !== '')
      )
      if (meaningful.length === 1 && meaningful[0].nodeType === Node.ELEMENT_NODE) {
        el.replaceWith(meaningful[0] as Element)
        changed = true
      }
    }
  }
}

/**
 * 短文本容器启发式删除（B5）：
 * 针对“UI 控件文字”、“评分条”、“占位说明”这类由多个超短文本拼成的噪声块，推断并整段删除。
 *
 * 规则：仅针对无属性的 div / span：
 *  - 至少一个有意义子节点（否则交给空元素清理）
 *  - 所有有意义子节点满足：
 *      · 文本节点 trim 后长度 ≤ MAX_LEN
 *      · 元素节点本身不带 href/src 且后代也不含 href/src（保护带链接的语义），
 *        并且 textContent trim 后长度 ≤ MAX_LEN
 *  - 容器整体 textContent trim 后长度 ≤ MAX_TOTAL（防止拼接后超过阈值仍被判为“短”）
 */
function pruneShortTextContainers(doc: Document): void {
  const MAX_LEN = 6
  const MAX_TOTAL = 30
  const TARGET: ReadonlySet<string> = new Set(['div', 'span'])

  let changed = true
  let guard = 0
  while (changed && guard++ < 5) {
    changed = false
    const all = Array.from(doc.querySelectorAll('*'))
    for (let i = all.length - 1; i >= 0; i--) {
      const el = all[i]
      if (!TARGET.has(el.tagName.toLowerCase())) continue
      if (el.attributes.length > 0) continue

      const meaningful = Array.from(el.childNodes).filter(
        (c) =>
          c.nodeType === Node.ELEMENT_NODE ||
          (c.nodeType === Node.TEXT_NODE && (c.textContent ?? '').trim() !== '')
      )
      if (meaningful.length === 0) continue

      let allShort = true
      for (const c of meaningful) {
        if (c.nodeType === Node.TEXT_NODE) {
          if ((c.textContent ?? '').trim().length > MAX_LEN) {
            allShort = false
            break
          }
          continue
        }
        const child = c as Element
        if (child.hasAttribute('href') || child.hasAttribute('src')) {
          allShort = false
          break
        }
        if (child.querySelector('[href],[src]')) {
          allShort = false
          break
        }
        if ((child.textContent ?? '').trim().length > MAX_LEN) {
          allShort = false
          break
        }
      }
      if (!allShort) continue

      if ((el.textContent ?? '').trim().length > MAX_TOTAL) continue

      el.remove()
      changed = true
    }
  }
}

/**
 * 反向链式删除空元素（仅含空白文本或注释、且无实质子元素）。
 * 一次 querySelectorAll('*') 后从深到浅反向遍历，子元素先被判定为空后删除，
 * 父元素随后被判定为空也被删，以此链式生效（如 <div><div></div></div>）。
 * html / head / body 作为文档骨架不参与过滤，交由外层输出逻辑决定。
 */
function pruneEmptyElements(doc: Document): void {
  const all = Array.from(doc.querySelectorAll('*'))
  for (let i = all.length - 1; i >= 0; i--) {
    const el = all[i]
    const tag = el.tagName.toLowerCase()
    if (VOID_ELEMENTS.has(tag)) continue
    if (tag === 'html' || tag === 'head' || tag === 'body') continue

    let empty = true
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        empty = false
        break
      }
      if (child.nodeType === Node.TEXT_NODE) {
        if ((child.textContent ?? '').trim() !== '') {
          empty = false
          break
        }
      }
      // 注释节点不计作实质内容，不影响 empty 判定
    }
    if (empty) el.remove()
  }
}

export function sanitizeHtml(input: string): string {
  if (!input.trim()) return ''

  const doc = new DOMParser().parseFromString(input, 'text/html')

  // 1) 删除整段 script / style / 样式 link
  doc.querySelectorAll('script, style, link[rel~="stylesheet" i]').forEach((el) => el.remove())

  // 2) 删除标签黑名单（模板 / 交互 / 嵌入 / 多媒体 / 占位）
  removeBlacklistedTags(doc)

  // 3) 删除注释节点
  removeComments(doc)

  // 4) 逐元素过滤属性：白名单外一律删除
  doc.querySelectorAll('*').forEach((el) => {
    // 拷贝出来再迭代，避免边遍历边删除导致跳项
    const attrs = Array.from(el.attributes)
    for (const attr of attrs) {
      const lname = attr.name.toLowerCase()
      if (!KEEP_ATTRS.has(lname)) {
        el.removeAttribute(attr.name)
        continue
      }
      // href / src 中的 javascript: 协议：仍需删除
      if ((lname === 'href' || lname === 'src') && /^\s*javascript:/i.test(attr.value)) {
        el.removeAttribute(attr.name)
      }
    }
  })

  // 5) 清理无信息的 alt / href
  pruneUselessAttrs(doc)

  // 6) 删除无 alt 的 img（头像 / 图标 / 装饰图）
  pruneUninformativeImages(doc)

  // 7) 文本节点规范化（零宽、不间断空格、多空白压缩）
  normalizeTextNodes(doc)

  // 8) 装饰型壳子始终 unwrap：<i> / <colgroup>/<col>/<tbody>/<thead>/<tfoot>
  unwrapAlways(doc)

  // 9) 裸 <a>（href 已被清）unwrap
  unwrapBareAnchors(doc)

  // 10) 解除冗余包裹（多层单子 div/span/section/... 嵌套）
  unwrapRedundant(doc)

  // 11) 短文本容器启发式删除（工具栏 / 评分条 / 占位说明）
  pruneShortTextContainers(doc)

  // 12) 递归清理空元素（如 <div><div></div></div> 这种无内容的嵌套包裹）
  pruneEmptyElements(doc)

  // 13) 根据原文实际包含的标签决定输出哪些层级（只删不加）
  // DOMParser 会强制补全 <html>/<head>/<body>，本函数不输出原文中不存在的包裹。
  const hasDoctype = /<!doctype\s/i.test(input)
  const hasHtmlTag = /<html[\s>]/i.test(input)
  const hasHeadTag = /<head[\s>]/i.test(input)
  const hasBodyTag = /<body[\s>]/i.test(input)

  const dt = doc.doctype
  const doctype =
    hasDoctype && dt
      ? `<!DOCTYPE ${dt.name}${dt.publicId ? ` PUBLIC "${dt.publicId}"` : ''}${
          dt.systemId ? ` "${dt.systemId}"` : ''
        }>`
      : ''

  if (hasHtmlTag) {
    // 有 <html> 包裹：使用 documentElement.outerHTML，反向剖除 DOMParser 补全的层级
    let serialized = doc.documentElement.outerHTML
    if (!hasHeadTag) {
      // <head>...</head> 是 DOMParser 补出的，剖掉包裹但保留内容
      serialized = serialized.replace(/<head\b[^>]*>([\s\S]*?)<\/head>/i, '$1')
    }
    if (!hasBodyTag) {
      // <body>...</body> 是 DOMParser 补出的，剖掉包裹但保留内容
      serialized = serialized.replace(/<body\b[^>]*>([\s\S]*?)<\/body>/i, '$1')
    }
    return doctype + serialized
  }

  // 原文没有 <html> 包裹：分别拼 head / body 的输出形态
  let result = doctype
  result += hasHeadTag ? doc.head.outerHTML : doc.head.innerHTML
  result += hasBodyTag ? doc.body.outerHTML : doc.body.innerHTML
  return result
}
