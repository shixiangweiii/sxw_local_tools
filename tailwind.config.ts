import type { Config } from 'tailwindcss'
import typography from '@tailwindcss/typography'

const config: Config = {
  content: ['./src/renderer/**/*.{ts,tsx}', './index.html'],
  darkMode: 'class',
  theme: {
    extend: {}
  },
  plugins: [typography]
}

export default config
