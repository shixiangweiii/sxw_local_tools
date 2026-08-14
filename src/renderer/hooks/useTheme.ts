import { useEffect } from 'react'
import { useStore } from '../store'

export function useTheme(): void {
  const theme = useStore((s) => s.theme)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])
}
