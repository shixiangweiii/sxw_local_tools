# Markdown 预览支持本地图片 — 实施方案与改动记录

> 日期：2026-08-20
> 范围：`sxw_local_tools`（Electron + React 三进程 JSON/Markdown/HTML 编辑器）
> 结论：已实施完成，`npm run build` 通过，dev 模式手动验证通过（demo 文档 12 张图片全部正常显示）

---

## 一、需求背景

Markdown 模式下无法预览文档中引用的本地图片。以
`/Users/shixiangweii/opencode_proj/demo/deepseek-harness-article.md` 为例，文中引用的
`images/image_01.png` ~ `image_12.png`（实际位于 `/Users/shixiangweii/opencode_proj/demo/images/`）
在预览面板全部显示为空白/裂图。

## 二、问题定位（改造前不支持的原因）

### 数据流现状（改造前）

1. 打开 md 文件：`App.tsx` → IPC `FILE_OPEN`（`src/main/ipc.ts`）返回 `{path, content}`
   → `setFilePath(path)` 存入 store 的 `filePathByMode.markdown`（`src/renderer/store/uiSlice.ts`）
   → `setMarkdownText(content)`
2. 预览：`MarkdownTextSubscriber`（App.tsx）→ `MarkdownPreview` 只接收 `text` 一个 prop
   → `ReactMarkdown` 渲染
3. `MarkdownPreviewImpl.tsx` 的 `components` 只自定义了 `table` 和 `code`，**没有 `img`**
   —— react-markdown 将 `![](images/image_01.png)` 原样输出为
   `<img src="images/image_01.png">`

### 三个根因

| # | 根因 | 说明 |
|---|------|------|
| 1 | **相对路径解析基准错误（核心）** | `<img src="images/image_01.png">` 以页面 URL 而非 md 文件位置为基准解析。dev 模式页面是 `http://localhost:5173` → 请求 `http://localhost:5173/images/...` → 404；打包后页面是应用包内 `file://.../renderer/index.html` → 请求包内路径 → 文件不存在。两种情况都不会指向 md 文件所在目录 |
| 2 | **渲染层拿不到 md 文件路径** | `filePathByMode.markdown` 在 store 里存在，但从未传入预览组件，无法把相对路径拼接为磁盘绝对路径 |
| 3 | **Chromium 安全策略拦截直接读本地文件** | dev 下 http 页面加载 `file:///Users/...` 图片会被 Chromium 拦截（"Not allowed to load local resource"）；项目中没有任何自定义协议或本地资源通道 |

## 三、方案设计（讨论定稿）

### 总体架构

```
┌─ renderer ──────────────────────────────────────────────┐
│ store.filePathByMode.markdown                           │
│   → dirname → baseDir                                   │
│   → MarkdownPreview(baseDir)                            │
│   → img 组件: resolveImageSrc(src, baseDir)              │
│       相对/绝对路径 → local-resource://localhost/<encoded>│
│       data:/blob:/http(s): → 原样透传                    │
└────────────────────────┬────────────────────────────────┘
                         │ Chromium 发起协议请求
┌─ main ─────────────────▼────────────────────────────────┐
│ protocol.handle('local-resource')                        │
│   decode → 安全校验 → net.fetch(pathToFileURL(path))     │
└──────────────────────────────────────────────────────────┘
```

核心思路：打通 **"路径上下文 + 安全资源通道"** 两件事。

### 图片 src 解析规则（互斥分类）

> 讨论结论：**不做"本地失败转 web"回退**。相对路径本地失败后拿它请求
> localhost 必 404 无意义；http(s) 本来就走 web 通道。分类是互斥的，
> "优先级"体现在相对/绝对路径一律先走本地。

| src 形态 | 解析方式 |
|---|---|
| `data:` / `blob:` / `http(s)://` / 协议相对 `//` / 已是 `local-resource://` | 原样透传（web 通道） |
| `file://` 开头 | 转走本协议（http 页面直连 file:// 会被 Chromium 拦截） |
| 绝对路径 `/Users/...` | 直接 → 本地协议 |
| 相对路径 `images/x.png`、`./x.png`、`../x.png` + baseDir 存在 | URL 解析处理 `./`、`../` → 本地协议 |
| 相对路径 + baseDir 为 null（手动粘贴未打开文件） | 原样透传 → 自然失败 → onError 占位符兜底 |

### 安全约束（main 进程协议处理器）

- **扩展名白名单**：png/jpg/jpeg/gif/webp/svg/bmp/ico/avif，防止渲染层被注入后借协议读任意文件（如 `.ssh/id_rsa`）；svg 在 `<img>` 上下文中脚本不执行，安全
- 只接受绝对路径（`/` 开头），decode 后拒绝包含 `..` 的路径（防穿越）
- 自定义协议 `local-resource` 声明 `{ standard, secure, supportFetchAPI }` 特权，dev（http 页面）与打包（file 页面）均可加载
- **不关闭 webSecurity**，自定义协议 + 白名单是 Electron 官方推荐姿势

### 关键技术决策（避坑记录）

1. **路径放 URL pathname 而非 hostname**：标准协议下 hostname 会被 URL 解析器小写化，macOS 文件系统大小写敏感（`/Users/ShiXiang` ≠ `/users/shixiang`），故采用 `local-resource://localhost/<path>` 固定 host 形态
2. **逐段 `encodeURIComponent`**：兼容中文、空格、`#`、`?` 文件名；handler 侧 `decodeURIComponent(pathname)` 还原
3. **`registerSchemesAsPrivileged` 必须在 app ready 前调用**，`protocol.handle` 必须在 ready 后 —— 两个时机分开接线
4. **`components` 用 `useMemo(() => createComponents(baseDir), [baseDir])`**：baseDir 不变时保持引用稳定，避免 react-markdown 整树重渲染（原实现为模块级常量，加入 baseDir 依赖后改为工厂）
5. 协议注册在主进程 app 级别，所有窗口（多窗口架构）自动生效

## 四、实际改动点（6 个文件）

### 1. `src/shared/constants.ts`（修改）

新增协议 scheme 常量：

```ts
// 本地图片安全通道协议：renderer 无法直接读取磁盘文件，经此协议由 main 进程代理加载
export const LOCAL_RESOURCE_SCHEME = 'local-resource'
```

### 2. `src/main/protocol.ts`（新建）

协议注册 + 安全校验，两个导出函数对应两个调用时机：

```ts
import { protocol, net } from 'electron'
import { pathToFileURL } from 'node:url'
import { LOCAL_RESOURCE_SCHEME } from '../shared/constants'

// 扩展名白名单：协议只放行图片，防止渲染层被注入后借协议读取任意文件
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i

// 必须在 app ready 之前调用（Electron 限制）
export function registerSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: LOCAL_RESOURCE_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true }
    }
  ])
}

// 必须在 app ready 之后调用
// URL 形态：local-resource://localhost/<encodeURIComponent 后的绝对路径>
export function registerLocalResourceProtocol(): void {
  protocol.handle(LOCAL_RESOURCE_SCHEME, async (request) => {
    try {
      const filePath = decodeURIComponent(new URL(request.url).pathname)
      if (
        !filePath.startsWith('/') ||
        filePath.split('/').includes('..') ||
        !IMAGE_EXT_RE.test(filePath)
      ) {
        return new Response(null, { status: 403 })
      }
      return await net.fetch(pathToFileURL(filePath).toString())
    } catch {
      return new Response(null, { status: 404 })
    }
  })
}
```

### 3. `src/main/index.ts`（修改）

两处接线：

```ts
import { registerSchemePrivileges, registerLocalResourceProtocol } from './protocol'

const isDev = !app.isPackaged
// 协议特权声明必须在 app ready 之前
registerSchemePrivileges()

app.whenReady().then(() => {
  registerLocalResourceProtocol()   // ← 新增，在 registerIpcHandlers() 之前
  registerIpcHandlers()
  ...
})
```

### 4. `src/renderer/utils/resolveImageUrl.ts`（新建）

纯函数模块，无 node 依赖（renderer 侧无 `node:path`）：

- `dirname(p)`：字符串实现提取目录，`'/a/b/c.md' → '/a/b'`，无分隔符返回 null
- `resolveImageSrc(src, baseDir)`：按第三节规则互斥分类；相对路径借
  `new URL(编码后的相对路径, local-resource 基准 URL)` 完成 `./`、`../` 归一化

### 5. `src/renderer/components/markdown/MarkdownPreviewImpl.tsx`（修改）

- Props 新增 `baseDir: string | null`（markdown 文件所在目录；null 表示无文件上下文）
- 新增 `MarkdownImage` 组件：
  - `resolveImageSrc` 解析 src
  - `loading="lazy"`（本期附带增强，12 张图的文档滚动性能受益）
  - `onError` → 灰底虚线占位符（显示 alt 或文件名 + "图片无法加载"），覆盖本地文件不存在、web 图挂掉、无 baseDir 相对路径等全部失败场景，不静默空白
- 模块级 `components` 常量改为 `createComponents(baseDir)` 工厂 + `useMemo` 缓存
  （`code`/mermaid 拦截逻辑原样保留，仅移入工厂）

### 6. `src/renderer/App.tsx`（修改）

`MarkdownTextSubscriber` 内订阅文件路径并下传：

```ts
import { dirname } from './utils/resolveImageUrl'

const markdownFilePath = useStore((s) => s.filePathByMode.markdown)
const baseDir = useMemo(
  () => (markdownFilePath ? dirname(markdownFilePath) : null),
  [markdownFilePath]
)
// <MarkdownPreview text={markdownPreviewText} baseDir={baseDir} onHeadingsChange={...} />
```

`MarkdownPreview.tsx` 懒加载包装无需改动（props 自动透传）。

## 五、验证记录

| 项 | 结果 |
|---|---|
| `npm run build`（类型检查 + 构建，AGENTS.md 规定的唯一验证手段） | 通过（期间修复一处相对导入层级错误：`../../../shared/constants` → `../../shared/constants`） |
| 解析函数单测（esbuild 打包后 node 跑 13 个用例） | 全部通过：相对 / `./` / `../` / 内层 `a/../b.png` 归一化 / 绝对路径 / 中文空格文件名编码 / http / https / data / blob / `file://` 转换 / 空 src / 无 baseDir 透传 |
| dev 手动验证 | demo 文档 `deepseek-harness-article.md` 12 张图片全部正常显示 |
| 回归 | 主题切换 / 全屏预览 / TOC / Mermaid 未受影响（构建与渲染路径未破坏） |

## 六、已知限制与后续计划

**v1 范围外：**

- `~/` 开头路径不展开（renderer 无 homedir 访问能力，避免为此加 IPC；当前场景不涉及）
- 灯箱点击放大图片 —— **二期**（可复用 `MermaidLightbox` 的灯箱模式）

**后续可选：**

- `npm run package` 后抽查打包形态（file:// 页面）下图片加载
- 大量图片文档的滚动性能观察（lazy loading 已覆盖大部分场景）
