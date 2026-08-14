import { useRef, useCallback, useEffect, useState, useMemo } from 'react'
import { FixedSizeList as List } from 'react-window'
import { useTreeData } from '../../hooks/useTreeData'
import { useStore } from '../../store'
import { TreeNodeComponent } from './TreeNode'
import { updateNodeInTree, addNodeToTree, addJsonToTree, deleteNodeFromTree, treeToJson } from '../../utils/treeHelpers'
import { ChevronsDown, ChevronsUp } from 'lucide-react'
import { IconButton } from '../common/IconButton'
import type { TreeNode } from '../../store/types'
import { useJsonWorker } from '../../hooks/useJsonWorker'

function findNodeInTree(root: TreeNode, targetId: string): TreeNode | null {
  const stack: TreeNode[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.id === targetId) return n
    if (n.children) {
      for (let i = n.children.length - 1; i >= 0; i--) {
        stack.push(n.children[i])
      }
    }
  }
  return null
}

/** Collect all ancestor node IDs from root to the target node (excluding the target itself) */
function collectAncestorIds(root: TreeNode, targetId: string): string[] | null {
  const path: string[] = []
  function dfs(node: TreeNode): boolean {
    if (node.id === targetId) return true
    if (node.children) {
      for (const child of node.children) {
        path.push(node.id)
        if (dfs(child)) return true
        path.pop()
      }
    }
    return false
  }
  return dfs(root) ? path : null
}

function checkHasLazy(node: TreeNode): boolean {
  if (node.lazy) return true
  if (node.children) {
    for (const child of node.children) {
      if (checkHasLazy(child)) return true
    }
  }
  return false
}

interface TreeViewProps {
  onTreeChange: (json: string) => void
}

export function TreeView({ onTreeChange }: TreeViewProps): JSX.Element {
  const listRef = useRef<List>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(400)
  const parsedTree = useStore((s) => s.parsedTree)
  const { flatNodes, toggleNode, expandAll, collapseAll } = useTreeData()
  const currentMatchIndex = useStore((s) => s.currentMatchIndex)
  const matchedIds = useStore((s) => s.matchedIds)
  const { expand: workerExpand, stringify: workerStringify, editNode: workerEditNode, addNode: workerAddNode, addJsonNode: workerAddJsonNode, deleteNode: workerDeleteNode, parse: workerParse } = useJsonWorker()

  // Scroll to current match, auto-expanding ancestors if needed
  useEffect(() => {
    if (currentMatchIndex < 0 || matchedIds.length === 0) return
    const targetId = matchedIds[currentMatchIndex]
    const index = flatNodes.findIndex((n) => n.id === targetId)
    if (index >= 0) {
      listRef.current?.scrollToItem(index, 'center')
    } else if (parsedTree) {
      // Node not visible in flatNodes — expand ancestors to make it visible
      const ancestorIds = collectAncestorIds(parsedTree, targetId)
      if (ancestorIds && ancestorIds.length > 0) {
        const currentExpanded = useStore.getState().expandedIds
        const newExpanded = new Set(currentExpanded)
        let changed = false
        for (const id of ancestorIds) {
          if (!newExpanded.has(id)) {
            newExpanded.add(id)
            changed = true
          }
        }
        if (changed) {
          useStore.getState().expandAll([...newExpanded])
          // flatNodes will recompute on next render, and this effect will re-run
        }
      }
    }
  }, [currentMatchIndex, matchedIds, flatNodes, parsedTree])

  // Resize observer — depend on parsedTree so it re-runs when tree appears
  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setHeight(entry.contentRect.height)
      }
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [parsedTree])


  // Sync tree to editor: use Worker stringify for correct lazy node serialization
  const syncTreeToEditor = useCallback(
    async (newTree: TreeNode | null) => {
      if (!newTree) return
      useStore.getState().setParsedTree(newTree)

      try {
        const json = await workerStringify(2)
        if (json) {
          onTreeChange(json)
          return
        }
      } catch {
        // Worker stringify failed
      }

      // Fallback: check if tree has lazy nodes
      if (checkHasLazy(newTree)) {
        // Tree has lazy nodes, main thread cannot produce correct JSON
        useStore.getState().showToast('同步编辑器失败，请重试', 'error')
        return
      }

      // No lazy nodes: safe to serialize on main thread
      const json = JSON.stringify(treeToJson(newTree), null, 2)
      onTreeChange(json)
    },
    [onTreeChange, workerStringify]
  )

  // Handle toggle: if node is lazy, request expansion from worker first
  const handleToggle = useCallback(
    async (id: string) => {
      const store = useStore.getState()
      const tree = store.parsedTree
      if (!tree) return

      const node = findNodeInTree(tree, id)
      if (!node) return

      if (node.lazy) {
        try {
          const result = await workerExpand(id, node.depth, node.path)
          if (!result) return

          const updateTree = (root: TreeNode): TreeNode => {
            if (root.id === id) {
              return {
                ...root,
                children: result.children,
                childCount: result.children.length,
                lazy: false,
                value: undefined
              }
            }
            if (root.children) {
              return { ...root, children: root.children.map(updateTree) }
            }
            return root
          }

          const newTree = updateTree(tree)
          store.setParsedTree(newTree)
          // Serialize via Worker for correct lazy node handling
          try {
            const json = await workerStringify(2)
            if (json) {
              store.setRawText(json, 'tree')
            }
          } catch {
            // fallback
          }
          store.toggleExpanded(id)
        } catch {
          store.toggleExpanded(id)
        }
      } else {
        store.toggleExpanded(id)
      }
    },
    [workerExpand, workerStringify]
  )

  const handleEdit = useCallback(
    async (nodeId: string, key: string | number, value: unknown, type: TreeNode['type']) => {
      const tree = useStore.getState().parsedTree
      if (!tree) return
      const updated = updateNodeInTree(tree, nodeId, key, value, type)
      // Sync edit to Worker's tree copy
      workerEditNode(nodeId, key, value, type).catch(() => {
        console.warn('[TreeView] Worker editNode sync failed, will resync on next parse')
      })
      syncTreeToEditor(updated)
    },
    [syncTreeToEditor, workerEditNode]
  )

  const handleAdd = useCallback(
    async (parentId: string, key: string | number, value: unknown, type: TreeNode['type']) => {
      const tree = useStore.getState().parsedTree
      if (!tree) return
      const updated = addNodeToTree(tree, parentId, key, value, type)
      // Find the new child node ID and sync to Worker
      const parent = findNodeInTree(updated, parentId)
      if (parent?.children) {
        const newChild = parent.children[parent.children.length - 1]
        workerAddNode(parentId, newChild.id, key, value, type, newChild.depth, newChild.path).catch(() => {
          console.warn('[TreeView] Worker addNode sync failed, will resync on next parse')
        })
      }
      syncTreeToEditor(updated)
    },
    [syncTreeToEditor, workerAddNode]
  )

  const handleAddJson = useCallback(
    async (parentId: string, key: string, jsonValue: unknown) => {
      const tree = useStore.getState().parsedTree
      if (!tree) return
      const updated = addJsonToTree(tree, parentId, jsonValue, key)
      // Sync to Worker
      const parent = findNodeInTree(updated, parentId)
      if (parent?.children) {
        const newChild = parent.children[parent.children.length - 1]
        workerAddJsonNode(parentId, key, jsonValue, newChild.depth, parent.path).catch(() => {
          console.warn('[TreeView] Worker addJsonNode sync failed, will resync on next parse')
        })
      }
      syncTreeToEditor(updated)
    },
    [syncTreeToEditor, workerAddJsonNode]
  )

  const handleDelete = useCallback(
    async (nodeId: string) => {
      const tree = useStore.getState().parsedTree
      if (!tree) return
      const updated = deleteNodeFromTree(tree, nodeId)
      // Sync to Worker
      workerDeleteNode(nodeId).catch(() => {
        console.warn('[TreeView] Worker deleteNode sync failed, will resync on next parse')
      })
      syncTreeToEditor(updated)
    },
    [syncTreeToEditor, workerDeleteNode]
  )

  if (!parsedTree) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400 text-sm">
        输入有效的 JSON 以查看树形视图
      </div>
    )
  }

  const itemSize = 28
  const contentHeight = flatNodes.length * itemSize
  const needsScroll = contentHeight > height

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
        <span className="text-xs text-gray-500 dark:text-gray-400 mr-auto">树形视图</span>
        <IconButton icon={<ChevronsDown size={14} />} label="展开全部" onClick={expandAll} />
        <IconButton icon={<ChevronsUp size={14} />} label="折叠全部" onClick={collapseAll} />
      </div>
      <div ref={containerRef} className="flex-1 min-h-0 overflow-hidden">
        <List
          ref={listRef}
          height={height}
          itemCount={flatNodes.length}
          itemSize={itemSize}
          width="100%"
          overscanCount={20}
          className="tree-scrollbar"
        >
          {({ index, style }) => (
            <TreeNodeComponent
              node={flatNodes[index]}
              style={style}
              onToggle={handleToggle}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onAdd={handleAdd}
              onAddJson={handleAddJson}
            />
          )}
        </List>
      </div>
    </div>
  )
}