import { type ReactNode, type ButtonHTMLAttributes } from 'react'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode
  label: string
  active?: boolean
}

export function IconButton({ icon, label, active, className = '', ...props }: IconButtonProps): JSX.Element {
  return (
    <button
      title={label}
      aria-label={label}
      className={`
        p-1.5 rounded-md transition-colors
        ${active
          ? 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400'
          : 'text-gray-500 hover:bg-gray-200 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200'
        }
        disabled:opacity-40 disabled:cursor-not-allowed
        ${className}
      `}
      {...props}
    >
      {icon}
    </button>
  )
}
