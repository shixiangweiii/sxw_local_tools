import { useMemo } from 'react'
import { useStore } from '../store'
import type { TreeNode, FlatNode } from '../store/types'

function flattenTree(
  root: TreeNode,
  expandedIds: Set<string>,
  matchedIds: Set<string>
): FlatNode[] {
  const result: FlatNode[] = []
  const stack: TreeNode[] = [root]

  while (stack.length > 0) {
    const node = stack.pop()!
    const hasChildren = !!(node.children && node.children.length > 0) || !!node.lazy
    const expanded = expandedIds.has(node.id)
    const highlighted = matchedIds.has(node.id)
    result.push({ ...node, hasChildren, expanded, highlighted })

    if (hasChildren && expanded && node.children && node.children.length > 0) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        stack.push(node.children[i])
      }
    }
  }

  return result
}

export function useTreeData(): {
  flatNodes: FlatNode[]
  toggleNode: (id: string) => void
  expandAll: () => void
  collapseAll: () => void
} {
  const parsedTree = useStore((s) => s.parsedTree)
  const expandedIds = useStore((s) => s.expandedIds)
  const matchedIds = useStore((s) => s.matchedIds)
  const toggleExpanded = useStore((s) => s.toggleExpanded)
  const expandAllAction = useStore((s) => s.expandAll)
  const collapseAllAction = useStore((s) => s.collapseAll)

  const matchedSet = useMemo(() => new Set(matchedIds), [matchedIds])

  const flatNodes = useMemo(() => {
    if (!parsedTree) return []
    return flattenTree(parsedTree, expandedIds, matchedSet)
  }, [parsedTree, expandedIds, matchedSet])

  const expandAll = useMemo(() => {
    return () => {
      if (!parsedTree) return
      const allIds: string[] = []
      const stack: TreeNode[] = [parsedTree]
      while (stack.length > 0) {
        const node = stack.pop()!
        if ((node.children && node.children.length > 0) || node.lazy) {
          allIds.push(node.id)
        }
        if (node.children) {
          for (let i = node.children.length - 1; i >= 0; i--) {
            stack.push(node.children[i])
          }
        }
      }
      expandAllAction(allIds)
    }
  }, [parsedTree, expandAllAction])

  return {
    flatNodes,
    toggleNode: toggleExpanded,
    expandAll,
    collapseAll: collapseAllAction
  }
}