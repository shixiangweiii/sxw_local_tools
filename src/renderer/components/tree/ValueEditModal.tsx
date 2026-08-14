import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Check, Copy } from 'lucide-react'
import { copyToClipboard } from '../../utils/jsonPath'
import type { TreeNode } from '../../store/types'

interface ValueEditModalProps {
  nodeKey: string | number
  value: string
  type: TreeNode['type']
  onSave: (key: string | number, value: unknown, type: TreeNode['type']) => void
  onClose: () => void
}

export function ValueEditModal({ nodeKey, value, type, onSave, onClose }: ValueEditModalProps): JSX.Element {
  const modalRef = useRef<HTMLDivElement>(null)
  const [editValue, setEditValue] = useState(value)
  const [editType, setEditType] = useState(type)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  // Only Cmd+Enter to save, remove Escape close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        handleSave()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [editValue, editType])

  const handleSave = () => {
    setError('')
    let parsedValue: unknown = editValue

    if (editType === 'object' || editType === 'array') {
      try {
        parsedValue = JSON.parse(editValue)
        const isArray = Array.isArray(parsedValue)
        const isObject = typeof parsedValue === 'object' && parsedValue !== null
        if (editType === 'array' && !isArray) {
          setError('Value must be a valid JSON array')
          return
        }
        if (editType === 'object' && (isArray || !isObject)) {
          setError('Value must be a valid JSON object')
          return
        }
      } catch {
        setError('Invalid JSON format')
        return
      }
    } else if (editType === 'number') {
      const num = Number(editValue)
      if (isNaN(num)) {
        setError('Value must be a valid number')
        return
      }
      parsedValue = num
    } else if (editType === 'boolean') {
      parsedValue = editValue === 'true'
    } else if (editType === 'null') {
      parsedValue = null
    }

    onSave(nodeKey, parsedValue, editType)
    onClose()
  }

  const handleCopy = () => {
    copyToClipboard(editValue)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }


  const typeColors: Record<string, string> = {
    string: 'text-green-600 dark:text-green-400',
    number: 'text-blue-600 dark:text-blue-400',
    boolean: 'text-amber-600 dark:text-amber-400',
    null: 'text-gray-400 dark:text-gray-500',
    object: 'text-gray-600 dark:text-gray-300',
    array: 'text-gray-600 dark:text-gray-300'
  }

  const modalContent = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30">
      <div
        ref={modalRef}
        className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-2xl flex flex-col"
        style={{
          width: 500,
          height: 450,
          minWidth: 300,
          minHeight: 250,
          maxWidth: '90vw',
          maxHeight: '90vh',
          resize: 'both',
          overflow: 'hidden'
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
              Edit Value
            </span>
            <span className="text-xs text-purple-600 dark:text-purple-400 font-mono">
              {String(nodeKey)}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              className="p-1.5 text-gray-400 hover:text-blue-500 rounded transition-colors"
              title="Copy value"
              onClick={handleCopy}
            >
              <Copy size={16} />
            </button>
            <button
              className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded transition-colors"
              title="Close (Esc)"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Type selector */}
        <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700/50">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">Type:</span>
            <select
              className="px-2 py-1 text-xs border rounded bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 outline-none focus:border-blue-500"
              value={editType}
              onChange={(e) => {
                setEditType(e.target.value as TreeNode['type'])
                setError('')
              }}
            >
              <option value="string">String</option>
              <option value="number">Number</option>
              <option value="boolean">Boolean</option>
              <option value="null">Null</option>
              <option value="object">Object</option>
              <option value="array">Array</option>
            </select>
            {copied && (
              <span className="text-xs text-green-500 ml-auto">Copied!</span>
            )}
          </div>
        </div>

        {/* Editor */}
        <div className="flex-1 p-4 overflow-auto min-h-0">
          {editType === 'boolean' ? (
            <select
              className="w-full px-3 py-2 text-sm border rounded bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 outline-none focus:border-blue-500"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
            >
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          ) : editType === 'null' ? (
            <div className="text-sm text-gray-400 italic py-2">null (no value to edit)</div>
          ) : (
            <textarea
              autoFocus
              className={`w-full h-full px-3 py-2 text-sm font-mono border rounded bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 outline-none focus:border-blue-500 resize-none ${typeColors[editType] || ''} ${error ? 'border-red-400' : ''}`}
              value={editValue}
              onChange={(e) => {
                setEditValue(e.target.value)
                setError('')
              }}
              placeholder={editType === 'object' ? '{"key": "value"}' : editType === 'array' ? '[1, 2, 3]' : 'Enter value...'}
              spellCheck={false}
            />
          )}
          {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          <span className="text-xs text-gray-400">Cmd+Enter to save</span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-3 py-1.5 text-xs text-white bg-blue-500 hover:bg-blue-600 rounded transition-colors flex items-center gap-1"
            >
              <Check size={14} />
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}
