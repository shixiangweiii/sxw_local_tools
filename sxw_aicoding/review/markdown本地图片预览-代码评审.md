# 代码评审：Markdown 本地图片预览

> 评审日期：2026-08-20
> 评审范围：git 未提交改动（4 个修改文件 + 2 个新增文件）
> 评审依据：`sxw_aicoding/temp/markdown本地图片预览-实施方案与改动记录.md`（Spec 轴）+ AGENTS.md 仓库约定与通用代码坏味道基线（Standards 轴）
> 验证手段：`npm run build` 复验通过；关键发现经二次确认（代码复读 + node 实测）

## 评审对象

| 文件 | 类型 | 说明 |
|------|------|------|
| `src/shared/constants.ts` | 修改 | 新增 `LOCAL_RESOURCE_SCHEME` 常量 |
| `src/main/protocol.ts` | 新增 | `local-resource://` 协议注册 + 安全校验 |
| `src/main/index.ts` | 修改 | 协议特权声明（ready 前）+ 协议处理器注册（ready 后）接线 |
| `src/renderer/utils/resolveImageUrl.ts` | 新增 | `dirname` / `resolveImageSrc` 纯函数 |
| `src/renderer/components/markdown/MarkdownPreviewImpl.tsx` | 修改 | `baseDir` prop、`MarkdownImage` 组件、components 工厂化 |
| `src/renderer/App.tsx` | 修改 | `MarkdownTextSubscriber` 订阅文件路径并下传 `baseDir` |

---

## 一、Standards 轴（规范符合性）

### 仓库约定核对 —— 全部符合

- ✅ UI 文案/注释均为中文（占位符「🖼️ 图片无法加载」、注释「协议特权声明必须在 app ready 之前」等），符合 AGENTS.md「zh-CN」约定
- ✅ 跨进程常量 `LOCAL_RESOURCE_SCHEME` 位于 `src/shared/constants.ts`，主/渲染两侧均从此导入，无硬编码散落
- ✅ renderer 侧 `resolveImageUrl.ts` 为纯字符串实现，无 node 依赖；`contextIsolation` 未被破坏，未走 `nodeIntegration` 捷径
- ✅ 未新增 worker action，不涉及 `WorkerMessage` union 与 `useJsonWorker.ts` 双处同步约束
- ✅ 未触碰 editor↔tree 的 `syncSource` / `parseVersionRef` 防循环守卫

### 坏味道扫描 —— 2 处判断级提示（非硬违规）

1. **Mysterious Name（轻微）**
   `resolveImageUrl.ts` 中 `toLocalResourceUrl(absolutePath)` 的入参名为 `absolutePath`，`file://` 分支传入的是 `decodeURIComponent(new URL(src).pathname)` 的结果。语义上没错（确实是绝对路径），但函数实际承担「绝对路径 → 协议 URL 编码」职责，调用点需要反推。可接受，命名可再斟酌。

2. **Speculative Generality（可接受）**
   `loading="lazy"` 超出图片加载核心需求，但实施记录已显式声明为「本期附带增强」并给出理由（12 张图文档滚动性能），零成本，不算越界。

无重复代码、无 Feature Envy、无散布式修改（改动聚合在「协议接线 / 解析工具 / 渲染组件」三处）。

---

## 二、Spec 轴（方案符合性）

### (a) 缺失 / 部分实现：无

六个改动点全部落地；src 五类互斥分类、白名单 + `..` 防穿越、特权声明时机拆分、`useMemo` 工厂稳定 components 引用，均与方案一致。

### (b) 未要求的额外行为：无

`loading="lazy"` 与失败占位符在方案文档中有明确记载，不属于范围蔓延。

### (c) 看似实现但可能有误：2 处（均已二次确认）

#### ⚠️ 发现 1：`MarkdownImage` 的 `failed` 状态不会随 src 变化重置

**位置**：`src/renderer/components/markdown/MarkdownPreviewImpl.tsx`

```tsx
const resolved = resolveImageSrc(src ?? '', baseDir)
const [failed, setFailed] = useState(false)

if (!resolved || failed) {
  return (/* 占位符 */)
}
return <img src={resolved} ... onError={() => setFailed(true)} />
```

**问题**：用户编辑 md 文本把失效图片路径改成有效路径时，react-markdown 按位置复用组件实例，`failed=true` 残留 —— 新 src 本可加载却继续显示占位符，直到组件重挂载。方案要求的「不静默空白」反向变成了「不静默恢复」。

**严重度**：中。触发条件是「同一文档位置先加载失败、后修改 src」，非高频，但一旦触发表现为明显错误。

**修复方向（供参考，本次不改）**：
- `useEffect(() => setFailed(false), [resolved])` 在 src 变化时重置；或
- 以 `resolved` 作为组件 key 强制重挂载。

#### 发现 2：`dirname('/c.md')` 返回 `null` 而非 `'/'`

**位置**：`src/renderer/utils/resolveImageUrl.ts`

```ts
export function dirname(p: string): string | null {
  const idx = p.lastIndexOf('/')
  if (idx <= 0) return null   // ← idx === 0 时（根目录文件）也返回 null
  return p.slice(0, idx)
}
```

**二次确认**（node 实测）：`dirname('/c.md') => null`，`dirname('/a/b/c.md') => '/a/b'`。

**问题**：根目录下的 md 文件（`lastIndexOf('/') === 0`）被当作「无目录」，baseDir 变 null，文档内相对图片落入占位符分支。与方案「dirname 提取文件所在目录」的字面语义有出入。

**严重度**：低。根目录存放 md 文件极少见。

### 已核对、不构成问题的安全点

- `../` 穿越到 baseDir 之外不会被 renderer 拦截，但 main 侧协议处理器本就设计为放行任意绝对图片路径（方案表格明确「绝对路径 → 本地协议」），故非漏洞
- 编码穿越（如 `%2e%2e`）在 handler `decodeURIComponent` 还原后会被 `split('/').includes('..')` 捕获，防护成立
- 扩展名白名单在 decode 后测试，`/a.png/../../x.jpg` 类路径因含 `..` 被拒，目录伪装无法绕过

---

## 三、总结

| 轴 | 发现数 | 最严重项 |
|----|--------|----------|
| Standards | 2 处判断级提示，无硬违规 | 命名可再斟酌（Mysterious Name，轻微） |
| Spec | 2 处实现偏差 | `MarkdownImage` 的 `failed` 状态残留 bug —— 编辑 src 后无法恢复显示 |

整体结论：改动与实施方案高度一致，架构接线（协议时机拆分、安全校验、baseDir 数据流）正确且注释充分；遗留两个小问题，其中发现 1 建议修复后再提交。
