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

OSM 数据第一次运行时从 Overpass 下载，缓存在 `pipeline/raw/osm.json`。

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
