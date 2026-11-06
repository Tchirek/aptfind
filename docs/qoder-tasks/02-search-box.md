# 任务 02：搜索框

## 规则

- 只能新建或修改这三个文件：`src/ui/SearchBox.tsx`（新建）、`src/ui/search.css`（新建）、`src/App.tsx`（只加一处 import 和一行组件）。其他文件一律不改。
- **不要运行任何 git 命令**，提交由审阅者完成。
- 每条命令单独执行，不要用 `&&`、`;` 或换行把多条命令连在一起。
- 完成后依次运行：`npx tsc -b`、`npx biome check --write src/ui/SearchBox.tsx src/ui/search.css src/App.tsx`、`npx vitest run`，全部通过。

## 已有接口（只读，不要改）

- `src/app/search.ts`：`buildGazetteer(district): SearchEntry[]`、`search(entries, query, limit): SearchEntry[]`、`POI_LABEL`。`SearchEntry` 的字段见源码。
- `src/app/store.ts`：`useApp` 里有 `select(selection)`、`requestFly([x, y, z], distance)`、`setMarker(marker | null)`。
- `src/app/data.ts`：`SceneData`，其中 `data.district` 是 `District`（见 `src/engine/district.ts`）。

## 要做的

1. 新建 `SearchBox` 组件，props 为 `{ data: SceneData }`。放在左上角：`left: 24px; top: 20px; width: 248px`，与下方的图例（`top: 76px`）左对齐。窄屏（`max-width: 720px`）时 `left: 12px; right: 12px; width: auto`。
2. 输入框占位符"搜索小区、楼、地铁站、设施"。输入时用 `search()` 取前 8 条，在输入框下方显示下拉列表。每项两行：第一行名称，第二行 `detail`（11px，`--ink-3`）。左侧一个 6px 小圆点区分类型：compound `#1f1f1c`、building `#57544e`、poi `#8a867e`、road `#b9b4aa`。
3. 词库用 `useMemo(() => buildGazetteer(data.district), [data])` 只建一次。
4. 选中一项（点击；或回车选当前高亮项，默认第一项；上下方向键移动高亮）后：
   - `building`：`select({ kind: 'building', index })`，`setMarker(null)`，`requestFly([x, y, base + height * 0.45], Math.max(110, height * 3.2))`，`height`、`base` 取 `data.district.buildings[index]`。
   - `compound`：`select({ kind: 'compound', index })`，`setMarker(null)`，`requestFly([x, y, 0], 520)`。
   - `poi` 与 `road`：`select(null)`，`setMarker({ x, y, label: name })`，`requestFly([x, y, 0], 260)`。
   - 然后收起下拉，输入框保留所选名称并失焦。
5. 按 Esc 清空并收起；输入为空不显示下拉；没有结果时显示一行"无匹配"。
6. 样式写在 `src/ui/search.css`，由 `SearchBox.tsx` import。沿用 `styles.css` 里的 CSS 变量（`--panel`、`--line`、`--ink`、`--ink-2`、`--ink-3`、`--radius`）。不要阴影、渐变、毛玻璃、emoji。
7. 在 `src/App.tsx` 的 `Main` 里，把 `<SearchBox data={data} />` 放在 `<Scene data={data} />` 之后。

完成后用一段话说明改了哪些文件、各做了什么。
