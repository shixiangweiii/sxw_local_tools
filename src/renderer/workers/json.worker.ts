interface TreeNode {
  id: string
  key: string | number
  value: unknown
  type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'
  children?: TreeNode[]
  depth: number
  path: string
  childCount?: number
  lazy?: boolean
}

interface WorkerMessage {
  id: number
  action: 'parse' | 'format' | 'minify' | 'validate' | 'expand' | 'stringify' | 'editNode' | 'addNode' | 'addJsonNode' | 'deleteNode'
  payload: string
  indent?: number
  nodeId?: string
  parentPath?: string
  depth?: number
  key?: string | number
  value?: unknown
  type?: TreeNode['type']
  parentId?: string
  childId?: string
}

interface ParseResult {
  tree: TreeNode | null
  errors: Array<{ line: number; column: number; message: string }>
  allIds: string[]
}

interface ExpandResult {
  nodeId: string
  children: TreeNode[]
}

function getType(value: unknown): TreeNode['type'] {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value as TreeNode['type']
}

function countChildren(value: unknown): number {
  if (value === null) return 0
  if (Array.isArray(value)) return value.length
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length
  return 0
}

let nodeCounter = 0
const lazyValueStore = new Map<string, unknown>()
// Worker maintains a full copy of the tree with lazy values for stringify
let workerTree: TreeNode | null = null

function buildTree(
  key: string | number,
  value: unknown,
  depth: number,
  parentPath: string,
  maxDepth: number
): TreeNode {
  const id = `node_${nodeCounter++}`
  const path = parentPath ? (typeof key === 'number' ? `${parentPath}[${key}]` : `${parentPath}.${key}`) : '$'
  const type = getType(value)

  const node: TreeNode = { id, key, value: undefined, type, depth, path }

  if (type === 'object' && value !== null) {
    if (depth < maxDepth) {
      node.children = Object.entries(value as Record<string, unknown>).map(([k, v]) =>
        buildTree(k, v, depth + 1, path, maxDepth)
      )
      node.childCount = node.children.length
    } else {
      // Lazy expansion: cache raw value in Worker memory, don't transmit
      lazyValueStore.set(id, value)
      node.value = undefined
      node.children = []
      node.childCount = countChildren(value)
      node.lazy = true
    }
  } else if (type === 'array') {
    if (depth < maxDepth) {
      node.children = (value as unknown[]).map((item, i) =>
        buildTree(i, item, depth + 1, path, maxDepth)
      )
      node.childCount = node.children.length
    } else {
      lazyValueStore.set(id, value)
      node.value = undefined
      node.children = []
      node.childCount = countChildren(value)
      node.lazy = true
    }
  } else {
    node.value = value
  }

  return node
}

function collectIds(root: TreeNode): string[] {
  const ids: string[] = []
  const stack: TreeNode[] = [root]
  while (stack.length > 0) {
    const node = stack.pop()!
    ids.push(node.id)
    if (node.children) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        stack.push(node.children[i])
      }
    }
  }
  return ids
}

// Convert worker's full tree (with lazy values) to JSON value
function workerTreeToJson(node: TreeNode): unknown {
  if (node.type === 'object') {
    if (node.lazy) {
      // Use the cached raw value for correct serialization
      const raw = lazyValueStore.get(node.id)
      if (raw !== undefined) return raw
    }
    const obj: Record<string, unknown> = {}
    if (node.children) {
      for (const child of node.children) {
        obj[String(child.key)] = workerTreeToJson(child)
      }
    }
    return obj
  }
  if (node.type === 'array') {
    if (node.lazy) {
      const raw = lazyValueStore.get(node.id)
      if (raw !== undefined) return raw
    }
    if (node.children) {
      return node.children.map((child) => workerTreeToJson(child))
    }
    return []
  }
  return node.value
}

// Update worker tree with expanded children from the main thread
function updateWorkerTreeExpand(nodeId: string, children: TreeNode[]): void {
  if (!workerTree) return

  const stack: TreeNode[] = [workerTree]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node.id === nodeId) {
      node.children = children
      node.childCount = children.length
      node.lazy = false
      node.value = undefined
      // lazyValueStore was already cleared in expandNode
      return
    }
    if (node.children) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        stack.push(node.children[i])
      }
    }
  }
}

// Update worker tree to reflect edits from the main thread
function updateWorkerTreeEdit(
  nodeId: string,
  newKey: string | number,
  newValue: unknown,
  newType: TreeNode['type']
): void {
  if (!workerTree) return

  const stack: TreeNode[] = [workerTree]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node.id === nodeId) {
      node.key = newKey
      node.type = newType
      if (newType === 'object' || newType === 'array') {
        node.value = undefined
        if (!node.children) node.children = []
        node.childCount = node.children.length
        node.lazy = false
      } else {
        node.value = newValue
        node.children = undefined
        node.childCount = undefined
        node.lazy = undefined
      }
      // Remove lazy value if node was previously lazy
      lazyValueStore.delete(nodeId)
      return
    }
    if (node.children) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        stack.push(node.children[i])
      }
    }
  }
}

function addWorkerTreeNode(
  parentId: string,
  childId: string,
  key: string | number,
  value: unknown,
  type: TreeNode['type'],
  depth: number,
  path: string
): void {
  if (!workerTree) return

  const stack: TreeNode[] = [workerTree]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node.id === parentId) {
      if (!node.children) node.children = []
      const newNode: TreeNode = {
        id: childId,
        key,
        value: type === 'object' || type === 'array' ? undefined : value,
        type,
        depth,
        path,
        children: type === 'object' || type === 'array' ? [] : undefined,
        childCount: type === 'object' || type === 'array' ? 0 : undefined
      }
      node.children.push(newNode)
      node.childCount = node.children.length
      return
    }
    if (node.children) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        stack.push(node.children[i])
      }
    }
  }
}

function deleteWorkerTreeNode(nodeId: string): void {
  if (!workerTree) return
  if (workerTree.id === nodeId) {
    workerTree = null
    return
  }

  const stack: TreeNode[] = [workerTree]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node.children) {
      const idx = node.children.findIndex((c) => c.id === nodeId)
      if (idx !== -1) {
        node.children.splice(idx, 1)
        node.childCount = node.children.length
        lazyValueStore.delete(nodeId)
        return
      }
      for (let i = node.children.length - 1; i >= 0; i--) {
        stack.push(node.children[i])
      }
    }
  }
}

function buildSubtreeWorker(
  key: string | number,
  value: unknown,
  depth: number,
  parentPath: string
): TreeNode {
  const id = `node_${nodeCounter++}`
  const path = parentPath
    ? typeof key === 'number' ? `${parentPath}[${key}]` : `${parentPath}.${key}`
    : '$'
  const type = getType(value)
  const node: TreeNode = { id, key, value: undefined, type, depth, path }

  if (type === 'object' && value !== null) {
    node.children = Object.entries(value as Record<string, unknown>).map(([k, v]) =>
      buildSubtreeWorker(k, v, depth + 1, path)
    )
    node.childCount = node.children.length
  } else if (type === 'array') {
    node.children = (value as unknown[]).map((item, i) =>
      buildSubtreeWorker(i, item, depth + 1, path)
    )
    node.childCount = node.children.length
  } else {
    node.value = value
  }

  return node
}

function addWorkerTreeSubtree(parentId: string, subtree: TreeNode): void {
  if (!workerTree) return

  const stack: TreeNode[] = [workerTree]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node.id === parentId) {
      if (!node.children) node.children = []
      node.children.push(subtree)
      node.childCount = node.children.length
      // If parent was lazy, clear lazy state since it now has real children
      if (node.lazy) {
        node.lazy = false
        node.value = undefined
        lazyValueStore.delete(parentId)
      }
      return
    }
    if (node.children) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        stack.push(node.children[i])
      }
    }
  }
}

function parse(text: string): ParseResult {
  nodeCounter = 0
  lazyValueStore.clear()
  try {
    const data = JSON.parse(text)
    const sizeEstimate = text.length
    const maxDepth = sizeEstimate > 1_000_000 ? 2 : sizeEstimate > 100_000 ? 4 : 100
    const tree = buildTree('root', data, 0, '', maxDepth)
    const allIds = collectIds(tree)
    // Store a deep copy of the tree for Worker-side serialization
    // We reuse the same tree since buildTree stores lazy values in lazyValueStore
    workerTree = tree
    return { tree, errors: [], allIds }
  } catch (e) {
    const err = e as SyntaxError
    const match = err.message.match(/position\s+(\d+)/)
    const pos = match ? parseInt(match[1]) : 0

    let line = 1
    let column = 1
    for (let i = 0; i < pos && i < text.length; i++) {
      if (text[i] === '\n') {
        line++
        column = 1
      } else {
        column++
      }
    }

    workerTree = null
    return {
      tree: null,
      errors: [{ line, column, message: err.message }],
      allIds: []
    }
  }
}

function expandNode(nodeId: string, depth: number, parentPath: string): ExpandResult | null {
  const rawValue = lazyValueStore.get(nodeId)
  if (!rawValue) return null

  lazyValueStore.delete(nodeId)

  const maxDepth = depth + 2
  const type = getType(rawValue)

  let children: TreeNode[]
  if (type === 'object' && rawValue !== null) {
    children = Object.entries(rawValue as Record<string, unknown>).map(([k, v]) =>
      buildTree(k, v, depth + 1, parentPath, maxDepth)
    )
  } else if (type === 'array') {
    children = (rawValue as unknown[]).map((item, i) =>
      buildTree(i, item, depth + 1, parentPath, maxDepth)
    )
  } else {
    children = []
  }

  // Update worker tree to reflect expansion
  updateWorkerTreeExpand(nodeId, children)

  return { nodeId, children }
}

function stringifyTree(indent = 2): string | null {
  if (!workerTree) return null
  const json = workerTreeToJson(workerTree)
  return JSON.stringify(json, null, indent)
}

function format(text: string, indent = 2): string {
  const data = JSON.parse(text)
  return JSON.stringify(data, null, indent)
}

function minify(text: string): string {
  const data = JSON.parse(text)
  return JSON.stringify(data)
}

function validate(text: string): { valid: boolean; errors: Array<{ line: number; column: number; message: string }> } {
  try {
    JSON.parse(text)
    return { valid: true, errors: [] }
  } catch (e) {
    const err = e as SyntaxError
    const match = err.message.match(/position\s+(\d+)/)
    const pos = match ? parseInt(match[1]) : 0
    let line = 1
    let column = 1
    for (let i = 0; i < pos && i < text.length; i++) {
      if (text[i] === '\n') {
        line++
        column = 1
      } else {
        column++
      }
    }
    return { valid: false, errors: [{ line, column, message: err.message }] }
  }
}

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const { id, action, payload, indent, nodeId, parentPath, depth, key, value, type, parentId, childId } = e.data

  try {
    switch (action) {
      case 'parse': {
        const result = parse(payload)
        self.postMessage({ id, action, result })
        break
      }
      case 'expand': {
        const result = expandNode(nodeId!, depth!, parentPath!)
        self.postMessage({ id, action, result })
        break
      }
      case 'stringify': {
        const result = stringifyTree(indent ?? 2)
        self.postMessage({ id, action, result })
        break
      }
      case 'editNode': {
        updateWorkerTreeEdit(nodeId!, key!, value!, type!)
        self.postMessage({ id, action, result: true })
        break
      }
      case 'addNode': {
        addWorkerTreeNode(parentId!, childId!, key!, value!, type!, depth!, parentPath!)
        self.postMessage({ id, action, result: true })
        break
      }
      case 'addJsonNode': {
        // Build a subtree from the JSON value and add it to the worker tree
        const jsonValue = value!
        const subtree = buildSubtreeWorker(key!, jsonValue, depth!, parentPath!)
        addWorkerTreeSubtree(parentId!, subtree)
        self.postMessage({ id, action, result: true })
        break
      }
      case 'deleteNode': {
        deleteWorkerTreeNode(nodeId!)
        self.postMessage({ id, action, result: true })
        break
      }
      case 'format': {
        const result = format(payload, indent)
        self.postMessage({ id, action, result })
        break
      }
      case 'minify': {
        const result = minify(payload)
        self.postMessage({ id, action, result })
        break
      }
      case 'validate': {
        const result = validate(payload)
        self.postMessage({ id, action, result })
        break
      }
    }
  } catch (err) {
    self.postMessage({
      id,
      action,
      error: (err as Error).message
    })
  }
}