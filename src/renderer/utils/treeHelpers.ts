import { produce } from 'immer'
import type { TreeNode } from '../store/types'

function findNode(tree: TreeNode, targetId: string): TreeNode | null {
  if (tree.id === targetId) return tree
  if (tree.children) {
    for (const child of tree.children) {
      const found = findNode(child, targetId)
      if (found) return found
    }
  }
  return null
}

function findParent(tree: TreeNode, targetId: string): TreeNode | null {
  if (tree.children) {
    for (const child of tree.children) {
      if (child.id === targetId) return tree
      const found = findParent(child, targetId)
      if (found) return found
    }
  }
  return null
}

let counter = Date.now()

function nextId(): string {
  return `node_${counter++}`
}

export function updateNodeInTree(
  tree: TreeNode,
  nodeId: string,
  newKey: string | number,
  newValue: unknown,
  newType: TreeNode['type']
): TreeNode {
  return produce(tree, (draft) => {
    const node = findNode(draft, nodeId)
    if (!node) return
    node.key = newKey
    node.type = newType
    if (newType === 'object') {
      node.value = undefined
      if (!node.children) node.children = []
    } else if (newType === 'array') {
      node.value = undefined
      if (!node.children) node.children = []
    } else {
      node.value = newValue
      node.children = undefined
    }
  })
}

export function addNodeToTree(
  tree: TreeNode,
  parentId: string,
  key: string | number,
  value: unknown,
  type: TreeNode['type']
): TreeNode {
  return produce(tree, (draft) => {
    const parent = findNode(draft, parentId)
    if (!parent || !parent.children) return
    const newNode: TreeNode = {
      id: nextId(),
      key,
      value: type === 'object' || type === 'array' ? undefined : value,
      type,
      depth: parent.depth + 1,
      path: typeof key === 'number' ? `${parent.path}[${key}]` : `${parent.path}.${key}`,
      children: type === 'object' || type === 'array' ? [] : undefined
    }
    parent.children.push(newNode)
  })
}

export function deleteNodeFromTree(tree: TreeNode, nodeId: string): TreeNode | null {
  if (tree.id === nodeId) return null
  return produce(tree, (draft) => {
    const parent = findParent(draft, nodeId)
    if (parent && parent.children) {
      const idx = parent.children.findIndex((c) => c.id === nodeId)
      if (idx !== -1) parent.children.splice(idx, 1)
    }
  })
}

function getType(value: unknown): TreeNode['type'] {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value as TreeNode['type']
}

export function buildSubtree(
  key: string | number,
  value: unknown,
  depth: number,
  parentPath: string
): TreeNode {
  const id = nextId()
  const path = parentPath
    ? typeof key === 'number' ? `${parentPath}[${key}]` : `${parentPath}.${key}`
    : '$'
  const type = getType(value)
  const node: TreeNode = { id, key, value: undefined, type, depth, path }

  if (type === 'object' && value !== null) {
    node.children = Object.entries(value as Record<string, unknown>).map(([k, v]) =>
      buildSubtree(k, v, depth + 1, path)
    )
  } else if (type === 'array') {
    node.children = (value as unknown[]).map((item, i) =>
      buildSubtree(i, item, depth + 1, path)
    )
  } else {
    node.value = value
  }
  return node
}

export function addJsonToTree(
  tree: TreeNode,
  parentId: string,
  jsonValue: unknown,
  key: string
): TreeNode {
  return produce(tree, (draft) => {
    const parent = findNode(draft, parentId)
    if (!parent || !parent.children) return
    const child = buildSubtree(key, jsonValue, parent.depth + 1, parent.path)
    parent.children.push(child)
  })
}

export function treeToJson(node: TreeNode): unknown {
  if (node.type === 'object') {
    const obj: Record<string, unknown> = {}
    if (node.children) {
      for (const child of node.children) {
        obj[String(child.key)] = treeToJson(child)
      }
    }
    return obj
  }
  if (node.type === 'array') {
    if (node.children) {
      return node.children.map((child) => treeToJson(child))
    }
    return []
  }
  return node.value
}
