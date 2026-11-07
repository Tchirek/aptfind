# 任务 03：时间条

页面只有一种视图：场景按"日期 + 北京时间"画出真实的太阳光影，默认跟随现在。
时间条是用户改日期、改时刻的唯一入口，放在屏幕底部居中。

## 规则

- 只能改这三个文件：`src/ui/TimeBar.tsx`（重写）、`src/ui/timebar.css`（新建，由 `TimeBar.tsx` import）、
  `src/styles.css`（只删除旧的时间条样式，见第 7 条）。其他文件一律不改。
- **不要运行任何 git 命令**，提交由审阅者完成。
- 每条命令单独执行，不要用 `&&`、`;` 或换行把多条命令连在一起。
- 完成后依次运行：`npx tsc -b`、`npx biome check --write src/ui/TimeBar.tsx src/ui/timebar.css src/styles.css`、`npx vitest run`，全部通过。

## 已有接口（只读，不要改）

`src/app/store.ts` 的 `useApp`：

| 字段 | 含义 |
| --- | --- |
| `date: CivilDate` | 场景日期 `{ year, month, day }`，北京时间 |
| `minute: number` | 北京时间当日第几分钟，0–1440，可带小数 |
| `live: boolean` | 是否跟随现在 |
| `playing: boolean` | 是否在播放 |
| `setDate(date)` | 换日期，同时退出跟随 |
| `setMinute(m)` | 改时刻，同时退出跟随 |
| `goLive()` | 回到现在并开始跟随，停止播放 |
| `syncNow()` | 跟随现在时同步到当前时刻（不跟随时什么也不做） |
| `setPlaying(p)` | 开始/停止播放；开始播放会退出跟随 |

注意：zustand v5 里**一个选择器只取一个字段或一个函数**，例如 `useApp((s) => s.minute)`。
不要写 `useApp((s) => ({ a: s.a, b: s.b }))`，那样每次返回新对象会无限重渲染。

`src/app/time.ts`：

- `dayTimes(date) → { sunrise, sunset, noon }`：北京时间当日分钟数
- `TERM_PICKS`：`['冬至', '大寒', '春分', '夏至', '秋分']`
- `upcomingTerm(term, from) → CivilDate`：从 `from` 起最近一次到来的该节气
- `termOf(date) → 节气名 | null`
- `dateToIso(date) → '2026-11-07'`、`isoToDate(s) → CivilDate | null`
- `nowBeijing() → { date, minute }`、`sameDate(a, b)`

`src/app/format.ts`：`formatClock(minutes) → '07:56'`

## 要做的

1. **整体**：面板 `className="panel timebar"`，底部居中，`bottom: 20px`，宽 `min(760px, calc(100vw - 32px))`，
   内边距 10px 14px，两行，行距 8px。
2. **第一行：日期**
   - 左边一个原生 `<input type="date">`，值为 `dateToIso(date)`，改动时 `isoToDate` 后 `setDate`；样式去掉默认边框，
     与其他控件一致（1px `--line` 边框、`--radius` 圆角、13px 字）。
   - 右边五个节气按钮（`TERM_PICKS` 的顺序），每个显示节气名，后面跟 11px 的 `M/D` 日期（`--ink-3`）。
     日期取 `upcomingTerm(term, nowBeijing().date)`，即从今天起最近的一次；点击 `setDate`。
     当前 `date` 恰好等于某个按钮的日期时，该按钮为选中态（深底白字，`aria-pressed`）。
   - 用 `<fieldset>` 包住这组按钮，`aria-label="节气"`，去掉 fieldset 默认边框与内边距。
3. **第二行：时刻**，从左到右：播放按钮、时间轴、读数。
   - **播放按钮**：32px 圆形，内放 12px 的 SVG 图标（播放三角 / 暂停双竖条，`fill: currentColor`），不要用字符或 emoji。
     `aria-label` 为"播放"/"暂停"。
   - **播放逻辑**：`requestAnimationFrame` 推进 `minute`，每秒 40 分钟；只在白天播放：
     范围 `[sunrise − 30, sunset + 30]`（`dayTimes(date)`），开始播放时若当前时刻不在范围内，先跳到起点；
     越过终点回到起点循环。推进时直接 `useApp.setState({ minute })`，不要调用 `setMinute`（它会改 `live`，播放时已经不跟随了）。
   - **时间轴**：一个 `<input type="range">`，`min=0 max=1439 step=1`，值为 `minute`，拖动时 `setPlaying(false)` 再 `setMinute`。
     轨道自己画：输入框外包一层 `position: relative` 的容器，下面垫一个 6px 高的轨道条：
     夜间部分 `#d9d5cc`，白天部分（日出到日落）`#efc98a`，按 `minute / 1440` 计算百分比位置；
     range 本身轨道透明，滑块 14px 圆形、白底、2px `--ink` 边框。
     轨道下方一行 10px 刻度：0、6、12、18、24 时，按百分比绝对定位，颜色 `--ink-3`。
   - **读数**（右侧，固定宽度约 132px，右对齐）：
     - 大字：`formatClock(minute)`，20px、600 字重、等宽数字（类名 `mono`）。
     - 小字一行（11px，`--ink-3`）：`日出 07:56 · 日落 18:06`。
     - `live` 为真时，大字左边一个 6px 的绿色圆点（`--good`），表示正在跟随现在；
       `live` 为假时，在小字下方显示一个文字按钮"回到现在"（12px，下划线，无边框背景），点击 `goLive()`。
4. **跟随现在**：组件挂载后 `setInterval(syncNow, 30_000)`，卸载时清掉。
5. **窄屏**（`max-width: 720px`）：`bottom: 10px`；节气按钮那一行可以横向滚动（`overflow-x: auto`，不换行）；
   读数宽度缩到 104px，日出日落那行隐藏。
6. 所有样式写在 `src/ui/timebar.css`，沿用 `styles.css` 里的 CSS 变量
   （`--panel`、`--line`、`--ink`、`--ink-2`、`--ink-3`、`--good`、`--radius`）。
   不要阴影、渐变、毛玻璃、emoji，不要加任何说明性文字。
7. 删除 `src/styles.css` 里旧的时间条样式：`.timebar`、`.days`、`.chip`（含 `.chip small`、`.chip.on`、`.chip.on small`）、
   `.clock`（含 `.clock input[type="range"]`）、`.play`、`.readout`（含子选择器），
   以及文件末尾 `@media (max-width: 720px)` 里的 `.timebar { … }` 那一段。其余样式不动。

完成后用一段话说明改了哪些文件、各做了什么。
