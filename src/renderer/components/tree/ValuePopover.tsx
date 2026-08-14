import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Copy, Check } from 'lucide-react'
import { copyToClipboard } from '../../utils/jsonPath'

interface ValuePopoverProps {
  value: string
  type: 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array'
  anchorRect: DOMRect
  onClose: () => void
}

export function ValuePopover({ value, type, anchorRect, onClose }: ValuePopoverProps): JSX.Element {
  const popoverRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })

  useEffect(() => {
    // Calculate position
    const popoverHeight = 200
    const popoverWidth = 320
    const padding = 8

    let top = anchorRect.bottom + padding
    let left = anchorRect.left

    // Adjust if overflows right
    if (left + popoverWidth > window.innerWidth - padding) {
      left = window.innerWidth - popoverWidth - padding
    }

    // Adjust if overflows bottom, show above instead
    if (top + popoverHeight > window.innerHeight - padding) {
      top = anchorRect.top - popoverHeight - padding
    }

    // Ensure minimum left position
    if (left < padding) {
      left = padding
    }

    setPosition({ top, left })
  }, [anchorRect])


  const handleCopy = () => {
    copyToClipboard(value)
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

  const popoverContent = (
    <div
      ref={popoverRef}
      className="fixed z-[9999] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl flex flex-col"
      style={{
        top: position.top,
        left: position.left,
        width: 320,
        height: 280,
        minWidth: 200,
        minHeight: 150,
        maxWidth: '90vw',
        maxHeight: '80vh',
        resize: 'both',
        overflow: 'hidden'
      }}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
          Value ({type})
        </span>
        <div className="flex items-center gap-1">
          <button
            className="p-1 text-gray-400 hover:text-blue-500 rounded transition-colors"
            title="Copy value"
            onClick={handleCopy}
          >
            {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
          </button>
          <button
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded transition-colors"
            title="Close"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="flex-1 p-3 overflow-auto">
        <pre
          className={`text-xs whitespace-pre-wrap break-all font-mono ${typeColors[type] || ''}`}
        >
          {value}
        </pre>
      </div>
    </div>
  )

  return createPortal(popoverContent, document.body)
}
