# 任务 04：详情面板里的"可达范围"一节

选中一栋楼后，地图上会画出两条等时线：15 分钟步行（深青）、30 分钟步行 + 地铁（浅青），
坐地铁能在 30 分钟内出站的车站标在地图上。详情面板需要一节把这些读出来。

## 规则

- 只能新建这两个文件：`src/ui/ReachSection.tsx`、`src/ui/reach-section.css`（由 `ReachSection.tsx` import）。
  其他文件一律不改（面板里放到哪里由审阅者接）。
- **不要运行任何 git 命令**，提交由审阅者完成。
- 每条命令单独执行，不要用 `&&`、`;` 或换行把多条命令连在一起。
- 完成后依次运行：`npx tsc -b`、`npx biome check --write src/ui/ReachSection.tsx src/ui/reach-section.css`、`npx vitest run`，全部通过。

## 已有接口（只读，不要改）

`src/app/store.ts` 的 `useApp`：

- `reach: Reach | null`，类型见 `src/app/reach.ts` 与 `src/app/reach.worker.ts`：
  - `building: number`：这份结果属于哪栋楼
  - `area15: number`：15 分钟步行可达面积，平方米
  - `area30: number`：30 分钟步行 + 地铁可达面积，平方米
  - `stations: { name: string; x: number; y: number; exit: number }[]`：坐地铁能出站的车站，`exit` 为出站时刻（分钟），已按从早到晚排好
  - `far: { grid: { x0, y0, cell, nx, ny }, data } | null`：远场网格，覆盖全部可达范围，平面坐标（米）
- `requestFly([x, y, z], distance)`：镜头飞到平面坐标 (x, y)、高度 z，相机距离 distance 米

注意：zustand v5 里**一个选择器只取一个字段或一个函数**，例如 `useApp((s) => s.reach)`。

## 要做的

1. 导出组件 `ReachSection({ building }: { building: number })`，外层是 `<section>`，第一行 `<div className="label">可达范围</div>`
   （`label` 是已有的样式类，沿用）。
2. `reach` 为空，或 `reach.building !== building`（还在算）时，只显示一行 `…`，颜色 `--ink-3`。
3. 算好以后显示两行图例，每行左边一段 16px 宽、3px 高的色条，中间是名称，右边是面积（等宽数字）：
   - 色条 `#3fada4`，名称"15 分钟步行"，面积 `area15`；
   - 色条 `#73bfc5`，名称"30 分钟 · 步行 + 地铁"，面积 `area30`。
   - 面积换算成平方公里，保留一位小数，写作 `2.1 km²`。
4. 如果 `stations` 不为空：图例下面列出车站，每项"站名 + 出站分钟数"（如"大观 16 分"，分钟四舍五入），
   做成一行行自动换行的小标签（12px，1px `--line` 边框，2px 圆角，内边距 2px 6px，间距 4px）。
   默认只列前 6 个；多于 6 个时末尾加一个文字按钮"全部 N 站"，点开后列出全部，按钮变成"收起"。
5. 最后一行右对齐一个文字按钮"看全图"：用 `reach.far.grid` 算出范围中心
   `(x0 + nx·cell/2, y0 + ny·cell/2)` 与边长 `max(nx, ny)·cell`，调用 `requestFly([cx, cy, 0], 边长 × 1.15)`。
   `reach.far` 为空时不显示这个按钮。
6. 文字按钮：无边框无背景，12px，`--ink-2`，悬停下划线。
7. 所有样式写在 `src/ui/reach-section.css`，沿用 `styles.css` 的 CSS 变量（`--line`、`--ink`、`--ink-2`、`--ink-3`、`--radius`）。
   不要阴影、渐变、emoji，不要加任何说明性文字（比如"以下是……""坐地铁可以到达……"之类）。

完成后用一段话说明改了哪些文件、各做了什么。
