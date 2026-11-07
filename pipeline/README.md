# 数据管线

把原始数据处理成前端直接加载的 `public/data/district.json`（片区：建筑、地形、地名、道路、设施）
与 `public/data/region.json`（区域：地铁网、步行网、远景底图）。原始数据不进仓库。

## 准备

```bash
python -m venv pipeline/.venv
pipeline/.venv/Scripts/python -m pip install -r pipeline/requirements.txt
```

下载 CBMF 四川包（598.7 MB，CC BY 4.0）并解压：

- 记录页：https://doi.org/10.5281/zenodo.18595960
- 文件：`Sichuan.gdb.rar`，MD5 `d64c904f8cd1aac51f4cd78cde4d0fdc`

## 生成场景数据

```bash
pipeline/.venv/Scripts/python pipeline/build_district.py --cbmf <解压出的 Sichuan.gdb>
```

- OSM 数据第一次运行时从 Overpass 下载，缓存在 `pipeline/raw/osm.json`、`osm-metro.json`。
- 地形从 Copernicus GLO-30 按需读取（只取片区窗口），去掉建筑与树冠后缓存在 `pipeline/raw/terrain.npz`，见 `terrain.py`。
- 面积小于 40 m² 或最小外接矩形短边小于 3.5 m 的建筑剔除；暗渠（`tunnel=culvert`、`layer<0`）不画成水面。

### 高德地名与设施

`.env.local` 里放 Web端（JS API）Key：

```
VITE_AMAP_KEY=...
VITE_AMAP_SECURITY_CODE=...
```

这类 Key 只能在浏览器里调用，所以采集在本地开发服务器上进行：

1. 先运行一次 `build_district.py`，生成 `pipeline/raw/amap/input-points.json`（核心区每栋楼的坐标）；
2. `npm run dev`，打开 `/tools/amap.html`，在控制台依次执行 `await jgCollect.regeo()`、`await jgCollect.roads()`、`await jgCollect.pois()`、`await jgCollect.campusNames()`；
   `roads()` 读 `road-points.json`（OSM 里没有名字的道路沿线样点），取附近道路名，供管线投票补名；
3. 结果落盘到 `pipeline/raw/amap/`，再运行一次 `build_district.py`。

单栋楼的名称可以在 `names.csv` 里手工覆盖（`names_todo.csv` 按面积列出了校园里还没有名字的楼，带坐标与层数）；
小区建成年代填进 `compound_info.csv`（首次运行时已预填全部住宅小区的名字）。

脚本会打印 CBMF 与 OSM 建筑质心的偏移中位数，用来确认两套数据没有坐标系错位。
当前数据：1430 栋匹配，偏移 dx 0.79 m、dy 2.36 m，没有 GCJ-02 那种上百米的偏移。

## 区域数据（可达范围用）

选中一栋楼时画"15 分钟步行"与"30 分钟步行 + 地铁"的可达范围，需要片区以外的地铁网与步行网：

```bash
pipeline/.venv/Scripts/python pipeline/fetch_region.py metro          # 地铁线路关系、车站、出入口
pipeline/.venv/Scripts/python pipeline/build_region.py --candidates   # 30 分钟内可能到达的车站与取数范围
pipeline/.venv/Scripts/python pipeline/fetch_region.py walk basemap   # 片区外扩 2.6 km + 各候选车站周边的步行网、远景底图
pipeline/.venv/Scripts/python pipeline/build_region.py                # 写出 public/data/region.json
```

出行参数（进站候车 5 分、换乘 5 分、出站 2 分、步速 75 m/min、普线 520 m/min）写在 `build_region.py` 顶部，
随 region.json 一起交给前端。`npx tsx scripts/bench-isochrone.ts <楼名>` 可以用真实数据跑一遍看耗时与结果。

## 高层楼高校正

CBMF 的楼高由遥感反演，高层普遍被压低。`build_district.py` 在写出前做两步只往高里改的校正：

1. OSM 上标了 `building:levels` 的楼（与 CBMF 足迹重叠 30% 以上）直接用 OSM 的层数；
2. `compound_heights.csv` 里每行一个高层小区（同一项目分期写在一起，用 `|` 分隔），记楼栋数、户数、容积率、
   公开的最高层数、建成年代与出处。CBMF 里该小区最高的 N 个足迹（≥ 250 m²）算塔楼，
   层数 = 户数 × 100 m² ÷ 塔楼足迹面积之和；没有户数时用 容积率 × 小区用地面积。
   不超过公开的最高层数，没有时不超过 34 层（约 100 m）。

运行时会逐个小区打印推算结果，与公开的层数区间对照。改过楼高后要重跑 `npm run data:sunlight`。

## 宜居评分与屋顶色

```bash
npm run data:livability
```

用页面上同一个 `livabilityOf` 给核心区住宅算分，写出 `public/data/livability.json`（分数与屋顶色阶的五个分位节点）。
改过 `district.json`、`region.json` 或日照后，按 `build_district.py` → `npm run data:sunlight` → `npm run data:livability` 的顺序重跑。
调参时 `npx tsx scripts/livability-stats.ts` 看各维度在片区里的分布，`SHOW=小区名,小区名` 看逐项明细。

## 小区题图

在采集页执行 `await jgCollect.photos()`（读 `compound-points.json`），再运行：

```bash
python pipeline/build_photos.py
```

只收地点名与地块名对得上的照片；`REJECT` 里是逐张看过后剔除的（不是这个地块的照片）。

## 楼高实地核验

CBMF 的楼高由遥感反演，高层容易被低估。`survey_todo.csv` 列出核心区里最高的 40 栋住宅，
去现场数清层数后填进 `survey.csv`：

```csv
id,floors,note,surveyed_on
3371593,33,比华利国际城1期 北侧那栋,2026-11-08
```

重新运行 `build_district.py`，这些楼会标记为"实地核验"，楼高按每层 3 m 计算。

## 太阳位置参考值

```bash
pipeline/.venv/Scripts/python pipeline/reference_solar.py src/engine/__fixtures__/spa-reference.json
```

用 pvlib 的 NREL SPA 实现生成参考值，`src/engine/solar.test.ts` 用它对拍。
