import { useRef, useEffect, useCallback } from 'react'
import type { TreeNode, ValidationError } from '../store/types'

interface ParseResult {
  tree: TreeNode | null
  errors: ValidationError[]
  allIds: string[]
}

interface ExpandResult {
  nodeId: string
  children: TreeNode[]
}

type Resolver = {
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
}

export function useJsonWorker() {
  const workerRef = useRef<Worker | null>(null)
  const pendingRef = useRef<Map<number, Resolver>>(new Map())
  const idRef = useRef(0)

  useEffect(() => {
    workerRef.current = new Worker(
      new URL('../workers/json.worker.ts', import.meta.url),
      { type: 'module' }
    )

    workerRef.current.onmessage = (e) => {
      const { id, result, error } = e.data
      const pending = pendingRef.current.get(id)
      if (pending) {
        pendingRef.current.delete(id)
        if (error) {
          pending.reject(new Error(error))
        } else {
          pending.resolve(result)
        }
      }
    }

    return () => {
      workerRef.current?.terminate()
    }
  }, [])

  const send = useCallback((action: string, payload: string, extra?: Record<string, unknown>): Promise<unknown> => {
    return new Promise((resolve, reject) => {
      const id = idRef.current++
      pendingRef.current.set(id, { resolve, reject })
      workerRef.current?.postMessage({ id, action, payload, ...extra })
    })
  }, [])

  // Cancel all pending parse/format/minify/validate requests
  const cancelPending = useCallback(() => {
    for (const [id, resolver] of pendingRef.current) {
      resolver.reject(new Error('cancelled'))
      pendingRef.current.delete(id)
    }
  }, [])

  const parse = useCallback(
    (text: string) => {
      cancelPending()
      return send('parse', text) as Promise<ParseResult>
    },
    [send, cancelPending]
  )

  const expand = useCallback(
    (nodeId: string, depth: number, parentPath: string) =>
      send('expand', '', { nodeId, depth, parentPath }) as Promise<ExpandResult>,
    [send]
  )

  const stringify = useCallback(
    (indent = 2) => send('stringify', '', { indent }) as Promise<string | null>,
    [send]
  )

  const editNode = useCallback(
    (nodeId: string, key: string | number, value: unknown, type: TreeNode['type']) =>
      send('editNode', '', { nodeId, key, value, type }) as Promise<boolean>,
    [send]
  )

  const addNode = useCallback(
    (parentId: string, childId: string, key: string | number, value: unknown, type: TreeNode['type'], depth: number, parentPath: string) =>
      send('addNode', '', { parentId, childId, key, value, type, depth, parentPath }) as Promise<boolean>,
    [send]
  )

  const addJsonNode = useCallback(
    (parentId: string, key: string, jsonValue: unknown, depth: number, parentPath: string) =>
      send('addJsonNode', '', { parentId, key, value: jsonValue, depth, parentPath }) as Promise<boolean>,
    [send]
  )

  const deleteNode = useCallback(
    (nodeId: string) =>
      send('deleteNode', '', { nodeId }) as Promise<boolean>,
    [send]
  )

  const format = useCallback(
    (text: string, indent = 2) => send('format', text, { indent }) as Promise<string>,
    [send]
  )

  const minify = useCallback(
    (text: string) => send('minify', text) as Promise<string>,
    [send]
  )

  const validate = useCallback(
    (text: string) =>
      send('validate', text) as Promise<{ valid: boolean; errors: ValidationError[] }>,
    [send]
  )

  return { parse, expand, stringify, editNode, addNode, addJsonNode, deleteNode, cancelPending, format, minify, validate }
}