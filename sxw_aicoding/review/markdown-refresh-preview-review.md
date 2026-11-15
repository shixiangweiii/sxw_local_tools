# Markdown 手动刷新预览:代码评审

评审范围:工作区未提交改动(`src/main/ipc.ts`、`src/main/windowManager.ts`、`src/preload/index.ts`、`src/renderer/App.tsx`、`SplitPanel.tsx`、`Toolbar.tsx`、`MonacoEditor.tsx`、`electron.d.ts`、`src/shared/constants.ts`,以及新增的 `editorFlush.ts`)。

评审方式:阅读 diff 和相关上下文(`MonacoEditor`、`uiSlice`、`windowManager`、Allotment 源码)。没有启动应用实测。`tsc` 报 2 个类型错误,分别在 `MonacoEditor.tsx` 的 `lineNumbers` 和 `jsonSlice.ts`。用 `git stash` 对比过,改动前就有这两个错误,不是本次引入的。

## 结论

刷新按钮的核心逻辑是对的:先 `flushMarkdownEditorNow()` 把 Monaco 里还没过防抖的文本写进 store,再 `commitMarkdownPreview()`。zustand 的 `set` 是同步的,所以 commit 能拿到最新文本。

但这次改动不只是刷新预览。它还包含「从磁盘重新加载」和「全屏不再卸载编辑器」,范围比需求大。下面几个问题建议合并前处理。

## 需要修的问题

### 1. `debounceRef` 在定时器触发后没有置空,flush 的优化形同虚设(`MonacoEditor.tsx`)

- `handleChange` 的 `setTimeout` 回调执行完后,`debounceRef.current` 仍然是一个有值的旧 id。
- 所以 flush 里的 `if (!debounceRef.current) return` 在输入过一次之后永远不成立。
- 结果是每次点刷新或进全屏都会对整篇文档调用 `getValue()`。大文档(最大 5MB)会有无谓的整篇拷贝,和注释里「没有待写入按键时跳过」的说法不符。
- 修法:回调里先 `debounceRef.current = null`,再调 `onContentChange(value)`。

### 2. 保存没有 flush,会丢最后一次输入(`Toolbar.tsx` 的 `handleSave`)

- 它直接读 `state.markdownText`。在防抖窗口内(300 到 800ms)点保存,最后几个字符不会写入文件。
- 这是原有问题,但现在有了 flush 机制,加一行 `flushMarkdownEditorNow()` 就能修。
- 保存、刷新、重载这几个动作对「最新文本」应该用同一套约定。

### 3. 「从磁盘重新加载」的脏判断不准(`handleReloadFromDisk`)

- 它拿磁盘内容和 `markdownText` 直接做 `===` 比较,没有「上次保存/加载时的基线」。
- 文件带 BOM 或混合换行符时,Monaco 会去掉 BOM、统一换行符,`getValue()` 和磁盘内容就会不一样。用户明明没改动,也会弹出「将丢弃未保存的修改」的确认框。
- 外部改了文件而用户没编辑时,同样会弹这个提示,文案不准确。
- 建议:存一份 `lastSavedText` 作为基线,或比较前先规范化 BOM 和 EOL。

### 4. `readCurrentFile` 的结果没有绑定路径

- 主进程读的是它自己记录的 `filePath`,这个路径由渲染进程异步上报,中间有 `await`。
- 渲染进程回来后只校验了「仍是 markdown 模式且有路径」,没校验是不是同一个文件。极端情况下(await 期间切换文件或模式),可能把别的文件内容载入编辑器。
- 建议返回 `{ path, content }`,渲染进程比对 `filePathByMode.markdown === path` 后再应用。

### 5. 全屏改成「收起而不卸载」带来的风险(`SplitPanel.tsx`、`App.tsx`)

- 这个改动本身有价值:预览和 mermaid 不再重载。
- 但收起的 Pane 在 Allotment 里只是宽度变 0,Monaco 还挂着,并且开着 `automaticLayout`。
- 在 `wordWrap: 'on'` 的大文档上,宽度变 0 再恢复,可能触发整篇重新折行,进出全屏会卡。这一点没有实测,需要用 1MB 以上的文档确认。
- 收起后的编辑器还能被 Tab 键聚焦。只在进入全屏时 `blur()`,退出全屏时没有恢复焦点。

## 次要问题

- **flush 里先清定时器、再判断模式。**
  - `modeRef.current !== 'markdown'` 时已经把待写入的定时器清掉了,JSON/HTML 的待提交输入会被静默丢弃。
  - 目前只有 markdown 动作和卸载时会调它,所以是潜在问题。建议把模式判断放在 `clearTimeout` 之前。
- **刷新按钮的边界情况。**
  - `disabled` 策略下刷新也会 commit,指示灯变成「预览已是最新」,但此时根本没有渲染预览。
  - 已经是最新时点击是空操作,没有任何提示。
  - 重载分支对这两种情况有处理,两处行为不一致。
- **重载成功路径有重复开销。**
  - live 策略下,显式 `commitMarkdownPreview()` 和 `MarkdownTextSubscriber` 的 effect 会各 commit 一次。
  - `getByteLength(result.content)` 和 `setMarkdownText` 里会对同一段文本各编码一次。
  - `startTransition` 包 zustand 的 `set` 起不到延迟效果,因为 store 更新是同步的。这个写法在原有代码里就有,新代码沿用了。
- **`handleMount` 里新增的 `setValue` 恢复逻辑现在基本用不到。** 编辑器不再因全屏而重新挂载,注释「全屏会卸载编辑器」已经过时。
- **体验上的细节。**
  - `ed.setValue` 会清空撤销栈并重置光标和滚动位置。这次重载不可撤销,只靠那个确认框兜底。
  - `window.confirm` 在 Electron 里关闭后,有时会让文本框失焦。

## 建议

1. 先修第 1、2 条,都是小改动,收益明确。
2. 第 3、4 条决定「从磁盘重新加载」是否要随这次一起上。如果不是本次需求,建议拆成单独的提交,commit message 也方便按中文规范写清楚。
3. 全屏改动合并前,用大文档手动验证第 5 条的卡顿。
