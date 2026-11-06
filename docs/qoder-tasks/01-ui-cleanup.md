# 任务 01：界面文字清理与时段条两分类

仓库：React 19 + TypeScript 7 + three.js 的逐窗日照分析网页。你在分支 `qoder/ui-cleanup` 上工作。

## 规则

- 只改 `src/App.tsx`、`src/ui/*`、`src/styles.css`。不要动 `src/engine`、`src/scene`、`pipeline`、`scripts`、`public/data`。
- 每完成下面一组修改就单独提交一次：`git add <具体文件>` 后 `git commit`，提交信息用 Conventional Commits，中文描述，例如 `refactor(ui): 去掉左上角标题`。不要 `git add -A`，不要 push。
- 全部完成后运行 `npx tsc -b`、`npx biome check --write .`、`npx vitest run`，三者都通过。若 biome 改了格式，单独提交 `style: biome 格式化`。

## 要做的事

1. **删除左上角标题**。`src/App.tsx` 里 `<header className="brand">…</header>` 整块删除，`styles.css` 里 `.brand` 相关样式一并删除。图例 `.legend` 的 `top` 改为 `20px`。

2. **删除解释说明性质的文字**（宁缺毋滥）：
   - `src/ui/TimeBar.tsx`：非光影模式下的 `<p className="timebar-note">…</p>` 整段删除，连同 `.timebar-note` 样式。
   - `src/ui/Inspector.tsx`：
     - `heightNote()` 改为：遥感数据返回 `N 层 · 约 M m`；`source === 'survey'` 返回 `N 层 · 已核实`；`source === 'user'` 返回 `N 层 · 已修改`。
     - 删除 hint 段落"时刻为北京时间。指向一行，场景里会标出那栋楼。"
     - `BuildingDetail` 删除"点外墙上的格子看具体某一扇。"；核心区外的楼（`count === 0`）不渲染那个 section。
     - 非大寒日不渲染 `Verdict`（删掉"仅供参考，标准按大寒日判定"）。
   - `src/ui/Timeline.tsx`：figcaption 里"上：真太阳时 · 下：北京时间"删除。
   - `src/ui/Legend.tsx`：保留标题和色块，删除底部 `legend-note` 段落及其样式；阈值竖线保留。

3. **时段条改为两类**：把"照到 / 被挡 / 太阳在墙背面"合并为"有日照 / 无日照"。
   - `src/ui/palette.ts` 的 `SPAN_COLOR` 改为 `{ lit: '#d06f32', unlit: '#cfcac0' }`。
   - `src/ui/Timeline.tsx`：相邻的"无日照"段先合并成一段再画；图例只剩"有日照""无日照"两项；`<title>` 文案相应改成"有日照/无日照"。`onFocus` 交互保留：合并后的无日照段如果全程由同一栋楼遮挡，悬停时仍高亮那栋楼，否则不高亮。
   - `Inspector.tsx` 里"挡住阳光的楼"标题改为"遮挡来源"，列表本身不变。

4. **数据来源改为可收起**。删除 `App.tsx` 里常驻的 `<footer className="attribution">`，改为右下角一个文字按钮"数据来源"；点击后在按钮上方弹出一个小面板，逐行列出 `data.district.attribution`，再点一次关闭。样式沿用 `.panel`，字号 11px，窄屏也显示。

5. 加载页文案"正在载入狮子山片区 4212 栋楼……"改为"载入中"。

## 完成后

用一段话列出你做了哪些提交（提交哈希 + 标题）。
