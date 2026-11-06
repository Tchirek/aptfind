# 数据管线

把原始数据处理成前端直接加载的 `public/data/district.json`。原始数据不进仓库。

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
2. `npm run dev`，打开 `/tools/amap.html`，在控制台依次执行 `await jgCollect.regeo()`、`await jgCollect.pois()`、`await jgCollect.campusNames()`；
3. 结果落盘到 `pipeline/raw/amap/`，再运行一次 `build_district.py`。

单栋楼的名称可以在 `names.csv` 里手工覆盖（`names_todo.csv` 按面积列出了校园里还没有名字的楼，带坐标与层数）；
小区建成年代填进 `compound_info.csv`（首次运行时已预填全部住宅小区的名字）。

脚本会打印 CBMF 与 OSM 建筑质心的偏移中位数，用来确认两套数据没有坐标系错位。
当前数据：1430 栋匹配，偏移 dx 0.79 m、dy 2.36 m，没有 GCJ-02 那种上百米的偏移。

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
