import { useRef, useEffect, useCallback } from 'react'
import type { TreeNode, SearchOptions } from '../store/types'

export function useSearchWorker() {
  const workerRef = useRef<Worker | null>(null)
  const pendingRef = useRef<{
    resolve: (value: { matchIds: string[]; matchCount: number; error?: string | null }) => void
  } | null>(null)

  useEffect(() => {
    workerRef.current = new Worker(
      new URL('../workers/search.worker.ts', import.meta.url),
      { type: 'module' }
    )

    workerRef.current.onmessage = (e) => {
      const pending = pendingRef.current
      if (pending) {
        pendingRef.current = null
        pending.resolve(e.data)
      }
    }

    return () => {
      workerRef.current?.terminate()
    }
  }, [])

  const search = useCallback(
    (tree: TreeNode, query: string, options: SearchOptions, rawText?: string) => {
      return new Promise<{ matchIds: string[]; matchCount: number; error?: string | null }>((resolve) => {
        pendingRef.current = { resolve }
        workerRef.current?.postMessage({
          id: 0,
          action: 'search',
          tree,
          query,
          rawText,
          options
        })
      })
    },
    []
  )

  return { search }
}
