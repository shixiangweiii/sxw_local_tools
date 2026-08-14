import { useState } from 'react'
import { Check, X, Braces } from 'lucide-react'
import type { TreeNode } from '../../store/types'

interface TreeNodeEditorProps {
  node: TreeNode
  isAdd?: boolean
  onSave: (key: string | number, value: unknown, type: TreeNode['type']) => void
  onSaveJson?: (key: string, jsonValue: unknown) => void
  onCancel: () => void
}

export function TreeNodeEditor({ node, isAdd, onSave, onSaveJson, onCancel }: TreeNodeEditorProps): JSX.Element {
  const [jsonMode, setJsonMode] = useState(false)
  const [key, setKey] = useState(isAdd ? '' : String(node.key))
  const [value, setValue] = useState(
    isAdd ? '' : node.type === 'object' || node.type === 'array' ? '' : String(node.value ?? '')
  )
  const [type, setType] = useState<TreeNode['type']>(isAdd ? 'string' : node.type)
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState('')

  const handleSave = (): void => {
    if (jsonMode) {
      if (!key.trim()) {
        setJsonError('请输入 key')
        return
      }
      try {
        const parsed = JSON.parse(jsonText)
        setJsonError('')
        if (onSaveJson) {
          onSaveJson(key, parsed)
        } else {
          // Fallback: detect type from parsed value
          const t = parsed === null ? 'null'
            : Array.isArray(parsed) ? 'array'
            : typeof parsed === 'object' ? 'object'
            : typeof parsed as TreeNode['type']
          onSave(key, parsed, t)
        }
      } catch {
        setJsonError('JSON 格式错误')
      }
      return
    }

    let parsedValue: unknown = value
    if (type === 'number') parsedValue = Number(value)
    else if (type === 'boolean') parsedValue = value === 'true'
    else if (type === 'null') parsedValue = null
    onSave(key, parsedValue, type)
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') onCancel()
    // In JSON mode, Cmd+Enter to save (Enter adds newlines in textarea)
    if (jsonMode && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSave()
    }
    if (!jsonMode && e.key === 'Enter') handleSave()
  }

  const inputCls = 'px-1 py-0.5 text-xs border rounded bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 outline-none focus:border-blue-500'

  if (jsonMode) {
    return (
      <div className="flex flex-col gap-1 py-1 px-2 min-w-[320px]" onKeyDown={handleKeyDown}>
        <div className="flex items-center gap-1">
          <input
            autoFocus
            className={`w-32 ${inputCls}`}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="key"
          />
          <span className="text-gray-400 text-xs">:</span>
          <span className="text-[10px] text-gray-400 ml-auto">JSON 文本模式</span>
          <button
            onClick={() => setJsonMode(false)}
            className="p-0.5 text-gray-400 hover:text-blue-500 rounded text-[10px]"
            title="切换为表单模式"
          >
            表单
          </button>
        </div>
        <textarea
          className={`w-full min-h-[80px] max-h-[200px] font-mono resize-y ${inputCls} ${jsonError ? 'border-red-400' : ''}`}
          value={jsonText}
          onChange={(e) => {
            setJsonText(e.target.value)
            setJsonError('')
          }}
          placeholder='粘贴 JSON，如 {"name":"test"} 或 [1,2,3]'
          spellCheck={false}
        />
        {jsonError && <span className="text-[10px] text-red-500">{jsonError}</span>}
        <div className="flex items-center gap-1 justify-end">
          <span className="text-[10px] text-gray-400 mr-auto">Cmd+Enter 保存</span>
          <button onClick={handleSave} className="p-0.5 text-green-600 hover:bg-green-100 dark:hover:bg-green-900 rounded">
            <Check size={14} />
          </button>
          <button onClick={onCancel} className="p-0.5 text-red-500 hover:bg-red-100 dark:hover:bg-red-900 rounded">
            <X size={14} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1 py-0.5 px-2" onKeyDown={handleKeyDown}>
      <input
        autoFocus
        className={`w-24 ${inputCls}`}
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder="key"
      />
      <span className="text-gray-400 text-xs">:</span>
      <select
        className={inputCls}
        value={type}
        onChange={(e) => setType(e.target.value as TreeNode['type'])}
      >
        <option value="string">String</option>
        <option value="number">Number</option>
        <option value="boolean">Boolean</option>
        <option value="null">Null</option>
        <option value="object">Object</option>
        <option value="array">Array</option>
      </select>
      {type !== 'object' && type !== 'array' && type !== 'null' && (
        type === 'boolean' ? (
          <select
            className={`w-20 ${inputCls}`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          >
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        ) : (
          <input
            className={`flex-1 min-w-0 ${inputCls}`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="value"
          />
        )
      )}
      {isAdd && (
        <button
          onClick={() => setJsonMode(true)}
          className="p-0.5 text-gray-400 hover:text-blue-500 rounded"
          title="切换为 JSON 文本模式"
        >
          <Braces size={14} />
        </button>
      )}
      <button onClick={handleSave} className="p-0.5 text-green-600 hover:bg-green-100 dark:hover:bg-green-900 rounded">
        <Check size={14} />
      </button>
      <button onClick={onCancel} className="p-0.5 text-red-500 hover:bg-red-100 dark:hover:bg-red-900 rounded">
        <X size={14} />
      </button>
    </div>
  )
}
