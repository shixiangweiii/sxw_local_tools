import { Allotment } from 'allotment'
import 'allotment/dist/style.css'
import type { ReactNode } from 'react'

interface SplitPanelProps {
  left: ReactNode
  right: ReactNode
  /** 为 false 时收起左栏，左右组件都保持挂载，避免全屏切换时预览和编辑器重载 */
  leftVisible?: boolean
}

export function SplitPanel({ left, right, leftVisible = true }: SplitPanelProps): JSX.Element {
  return (
    <Allotment defaultSizes={[50, 50]} separator={leftVisible}>
      <Allotment.Pane minSize={300} visible={leftVisible}>
        <div className="h-full overflow-hidden">{left}</div>
      </Allotment.Pane>
      <Allotment.Pane minSize={300}>
        <div className="h-full overflow-hidden">{right}</div>
      </Allotment.Pane>
    </Allotment>
  )
}
