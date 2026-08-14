import { JSONPath } from 'jsonpath-plus'

interface TreeNode {
  id: string
  key: string | number
  value: unknown
  type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'
  children?: TreeNode[]
  lazy?: boolean
  path: string
}

interface SearchMessage {
  id: number
  action: 'search'
  tree: TreeNode
  query: string
  rawText?: string
  options: {
    mode: 'text' | 'jsonpath'
    caseSensitive: boolean
    regex: boolean
    searchKeys: boolean
    searchValues: boolean
  }
}

// --- Text search ---

function searchTree(
  root: TreeNode,
  matcher: (text: string) => boolean,
  searchKeys: boolean,
  searchValues: boolean
): string[] {
  const matches: string[] = []
  const stack: TreeNode[] = [root]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (searchKeys && matcher(String(node.key))) {
      matches.push(node.id)
    } else if (
      searchValues &&
      node.type !== 'object' &&
      node.type !== 'array' &&
      !node.lazy &&
      matcher(String(node.value))
    ) {
      matches.push(node.id)
    }
    if (node.children) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        stack.push(node.children[i])
      }
    }
  }
  return matches
}

// --- JSONPath search ---

/**
 * Resolve a JSON Pointer (e.g. "/store/book/0/title") to a tree node ID
 * by walking the tree structure directly. This correctly handles
 * numeric object keys vs array indices by checking the parent node type.
 */
function resolvePointerToNodeId(root: TreeNode, pointer: string): string | null {
  if (!pointer || pointer === '') return root.id
  const parts = pointer.startsWith('/') ? pointer.slice(1).split('/') : pointer.split('/')
  let current = root
  for (const part of parts) {
    // Unescape JSON Pointer encoding (RFC 6901): ~1 -> /, ~0 -> ~
    const decoded = part.replace(/~1/g, '/').replace(/~0/g, '~')
    if (!current.children || current.children.length === 0) return null

    let found: TreeNode | undefined
    if (current.type === 'array') {
      // Array: use numeric index
      const idx = parseInt(decoded, 10)
      if (!isNaN(idx) && idx >= 0 && idx < current.children.length) {
        found = current.children[idx]
      }
    } else {
      // Object: match by key name
      found = current.children.find((c) => String(c.key) === decoded)
    }

    if (!found) return null
    current = found
  }
  return current.id
}

function searchByJsonPath(
  root: TreeNode,
  expression: string,
  rawText?: string
): { matchIds: string[]; error?: string } {
  try {
    // Prefer rawText (full data, including lazy nodes) over tree reconstruction
    let json: unknown
    if (rawText) {
      json = JSON.parse(rawText)
    } else {
      // Fallback: reconstruct from tree (may lose lazy node data)
      json = treeToJsonFallback(root)
    }

    // Use resultType 'pointer' to get JSON Pointer paths
    const pointers: string[] = JSONPath({
      path: expression,
      json: json as object,
      resultType: 'pointer'
    })

    if (!pointers || pointers.length === 0) {
      return { matchIds: [] }
    }

    const matchIds: string[] = []
    for (const pointer of pointers) {
      const nodeId = resolvePointerToNodeId(root, pointer)
      if (nodeId) {
        matchIds.push(nodeId)
      }
    }

    return { matchIds }
  } catch (e) {
    return { matchIds: [], error: (e as Error).message }
  }
}

/** Fallback: reconstruct JSON from tree when rawText is not available */
function treeToJsonFallback(node: TreeNode): unknown {
  if (node.type === 'object') {
    const obj: Record<string, unknown> = {}
    if (node.children) {
      for (const child of node.children) {
        obj[String(child.key)] = treeToJsonFallback(child)
      }
    }
    return obj
  }
  if (node.type === 'array') {
    if (node.children) {
      return node.children.map((child) => treeToJsonFallback(child))
    }
    return []
  }
  return node.value
}

// --- Message handler ---

self.onmessage = (e: MessageEvent<SearchMessage>) => {
  const { id, tree, query, options } = e.data

  if (!query || !tree) {
    self.postMessage({ id, matchIds: [], matchCount: 0 })
    return
  }

  // JSONPath mode
  if (options.mode === 'jsonpath') {
    const rawText = e.data.rawText
    const result = searchByJsonPath(tree, query, rawText)
    self.postMessage({
      id,
      matchIds: result.matchIds,
      matchCount: result.matchIds.length,
      error: result.error || null
    })
    return
  }

  // Text search mode
  let matcher: (text: string) => boolean

  if (options.regex) {
    try {
      const flags = options.caseSensitive ? '' : 'i'
      const re = new RegExp(query, flags)
      matcher = (text) => re.test(text)
    } catch {
      self.postMessage({ id, matchIds: [], matchCount: 0 })
      return
    }
  } else {
    const q = options.caseSensitive ? query : query.toLowerCase()
    matcher = (text) => {
      const t = options.caseSensitive ? text : text.toLowerCase()
      return t.includes(q)
    }
  }

  const matchIds = searchTree(tree, matcher, options.searchKeys, options.searchValues)
  self.postMessage({ id, matchIds, matchCount: matchIds.length })
}
