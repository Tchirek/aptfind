"""生成狮子山片区的场景数据 public/data/district.json。

数据来源：
- 建筑轮廓与高度：CBMF（Zheng et al., 2026, doi:10.5281/zenodo.18595960, CC BY 4.0），
  高度来自 3D-GloBFP 遥感反演，高层普遍偏低，需实地校核（见 survey.csv）。
- 道路、小区边界、水系：OpenStreetMap（ODbL），经 Overpass API 获取。

用法：
    python pipeline/build_district.py --cbmf <Sichuan.gdb 路径>

坐标：以片区中心为原点的横轴墨卡托投影（米），x 指东、y 指北。原点处网格北与真北重合，
片区范围内偏差小于 0.01°，可以直接拿太阳方位角计算。
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pyogrio
import shapely
from pyproj import Transformer
from shapely.geometry import LineString, MultiPolygon, Polygon
from shapely.ops import linemerge, polygonize

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "pipeline" / "raw"
OUT = ROOT / "public" / "data" / "district.json"
SURVEY = ROOT / "pipeline" / "survey.csv"
SURVEY_TODO = ROOT / "pipeline" / "survey_todo.csv"

# 川师狮子山校区中心
ORIGIN_LAT, ORIGIN_LON = 30.6160, 104.1200
# 计算逐窗日照的核心区（约 2.0 km × 2.1 km）
CORE = dict(south=30.6070, west=104.1090, north=30.6250, east=104.1310)
# 核心区外再扩约 350 m，只作为遮挡物参与计算。
# 大寒日真太阳时 8:00 太阳高度约 13°，40 m 高的楼影子能拖到 170 m 外
BUFFER_DEG = 0.0035

FLOOR_HEIGHT = 3.0
MIN_AREA = 12.0  # m²，更小的多为附属构筑物
SIMPLIFY = 0.25  # m

CLASS_CODES = {
    "Residential": "R",
    "Education": "E",
    "Commercial": "C",
    "Medical": "M",
    "Government": "G",
    "Public": "P",
    "Industrial": "I",
}

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]


@dataclass
class Bounds:
    south: float
    west: float
    north: float
    east: float

    def expand(self, d: float) -> "Bounds":
        return Bounds(self.south - d, self.west - d, self.north + d, self.east + d)

    @property
    def overpass(self) -> str:
        return f"{self.south},{self.west},{self.north},{self.east}"


LOCAL_PROJ = f"+proj=tmerc +lat_0={ORIGIN_LAT} +lon_0={ORIGIN_LON} +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m"
TO_LOCAL = Transformer.from_crs("EPSG:4326", LOCAL_PROJ, always_xy=True)


def to_local(geom):
    return shapely.transform(geom, lambda xy: np.column_stack(TO_LOCAL.transform(xy[:, 0], xy[:, 1])))


def ring_dm(coords) -> list[int]:
    """环坐标转成分米整数并展平，去掉闭合点。"""
    pts = list(coords)[:-1]
    out: list[int] = []
    for x, y in pts:
        out += [round(x * 10), round(y * 10)]
    return out


def line_dm(coords) -> list[int]:
    out: list[int] = []
    for x, y in coords:
        out += [round(x * 10), round(y * 10)]
    return out


# ---------------------------------------------------------------- OSM


def fetch_osm(bounds: Bounds) -> dict:
    cache = RAW / "osm.json"
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    b = bounds.overpass
    query = f"""
[out:json][timeout:180];
(
  way["highway"]({b});
  way["landuse"="residential"]({b});
  relation["landuse"="residential"]({b});
  way["amenity"~"^(university|college|school)$"]({b});
  way["waterway"~"^(river|canal|stream)$"]({b});
  way["natural"="water"]({b});
  relation["natural"="water"]({b});
  way["building"]({b});
);
out geom tags;
"""
    body = urllib.parse.urlencode({"data": query}).encode()
    data = None
    for attempt in range(3):
        for endpoint in OVERPASS_ENDPOINTS:
            req = urllib.request.Request(endpoint, data=body, headers={"User-Agent": "jianguang-pipeline/0.1"})
            try:
                with urllib.request.urlopen(req, timeout=240) as resp:
                    data = json.load(resp)
                break
            except (urllib.error.URLError, TimeoutError) as e:
                print(f"Overpass {endpoint} 失败（第 {attempt + 1} 轮）：{e}", file=sys.stderr)
        if data is not None:
            break
        time.sleep(20 * (attempt + 1))
    if data is None:
        raise SystemExit("Overpass 全部失败，稍后再试")
    RAW.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return data


def way_coords(el: dict) -> list[tuple[float, float]]:
    return [(p["lon"], p["lat"]) for p in el.get("geometry", [])]


def area_geometry(el: dict) -> Polygon | MultiPolygon | None:
    """把 OSM 的闭合 way 或 multipolygon relation 转成多边形（经纬度）。"""
    if el["type"] == "way":
        c = way_coords(el)
        if len(c) >= 4 and c[0] == c[-1]:
            p = Polygon(c)
            return p if p.is_valid else p.buffer(0)
        return None
    outers = [LineString(way_coords(m)) for m in el.get("members", []) if m.get("role") == "outer" and m.get("geometry")]
    inners = [LineString(way_coords(m)) for m in el.get("members", []) if m.get("role") == "inner" and m.get("geometry")]
    polys = list(polygonize(linemerge(outers))) if outers else []
    if not polys:
        return None
    geom = shapely.union_all(polys)
    holes = list(polygonize(linemerge(inners))) if inners else []
    if holes:
        geom = geom.difference(shapely.union_all(holes))
    return geom


ROAD_CLASSES = {
    "motorway": 0, "trunk": 0, "primary": 1, "secondary": 2, "tertiary": 3,
    "motorway_link": 2, "trunk_link": 2, "primary_link": 2, "secondary_link": 3, "tertiary_link": 3,
    "residential": 4, "unclassified": 4, "living_street": 4, "service": 5,
}


# ---------------------------------------------------------------- CBMF


def load_cbmf(gdb: Path, bounds: Bounds) -> list[dict]:
    meta, _, geoms, fields = pyogrio.raw.read(gdb, bbox=(bounds.west, bounds.south, bounds.east, bounds.north))
    names = list(meta["fields"])
    cols = {n: fields[i] for i, n in enumerate(names)}
    return [
        {"geometry": shapely.from_wkb(g), "ID": cols["ID"][i], "Height": cols["Height"][i], "class_pred": cols["class_pred"][i]}
        for i, g in enumerate(geoms)
    ]


def explode_polygons(geom) -> list[Polygon]:
    if geom is None or geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [geom]
    if isinstance(geom, MultiPolygon):
        return list(geom.geoms)
    return [g for g in getattr(geom, "geoms", []) if isinstance(g, Polygon)]


def read_survey() -> dict[str, dict]:
    if not SURVEY.exists():
        return {}
    with SURVEY.open(encoding="utf-8") as f:
        return {row["id"]: row for row in csv.DictReader(f) if row.get("id") and row.get("floors")}


# ---------------------------------------------------------------- main


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cbmf", required=True, type=Path, help="CBMF 四川 Sichuan.gdb 目录")
    args = ap.parse_args()
    # Windows 控制台默认 GBK，日志统一按 UTF-8 输出
    sys.stderr.reconfigure(encoding="utf-8")

    core = Bounds(**CORE)
    outer = core.expand(BUFFER_DEG)
    core_local = to_local(shapely.box(core.west, core.south, core.east, core.north))

    osm = fetch_osm(outer)
    elements = osm["elements"]

    # 小区边界：有名字的 landuse=residential，以及学校
    compounds: list[dict] = []
    for el in elements:
        tags = el.get("tags", {})
        name = tags.get("name")
        is_res = tags.get("landuse") == "residential"
        is_school = tags.get("amenity") in ("university", "college", "school")
        if not name or not (is_res or is_school):
            continue
        g = area_geometry(el)
        if g is None or g.is_empty:
            continue
        g = to_local(g)
        for p in explode_polygons(g):
            if p.area < 500:
                continue
            compounds.append({"name": name, "kind": "school" if is_school else "residential", "geom": p.simplify(1.0)})
    # 同名的多块合并成一个小区
    merged: dict[str, dict] = {}
    for c in compounds:
        m = merged.setdefault(c["name"], {"name": c["name"], "kind": c["kind"], "parts": []})
        m["parts"].append(c["geom"])
    compound_list = sorted(merged.values(), key=lambda c: c["name"])
    compound_tree = [(i, shapely.union_all(c["parts"])) for i, c in enumerate(compound_list)]

    # CBMF 建筑
    rows = load_cbmf(args.cbmf, outer)
    survey = read_survey()
    buildings: list[dict] = []
    for row in rows:
        for poly in explode_polygons(row["geometry"]):
            p = to_local(poly)
            if p.area < MIN_AREA:
                continue
            p = shapely.geometry.polygon.orient(p.simplify(SIMPLIFY, preserve_topology=True), 1.0)
            if p.is_empty or not p.is_valid or p.area < MIN_AREA:
                continue
            bid = str(int(row["ID"]))
            height = float(row["Height"])
            src = "cbmf"
            floors = max(1, round(height / FLOOR_HEIGHT))
            if bid in survey:
                floors = int(survey[bid]["floors"])
                height = floors * FLOOR_HEIGHT
                src = "survey"
            c = p.centroid
            compound = next((i for i, g in compound_tree if g.contains(c)), None)
            buildings.append(
                {
                    "id": bid,
                    "poly": p,
                    "height": height,
                    "floors": floors,
                    "cls": CLASS_CODES.get(row["class_pred"], "U"),
                    "src": src,
                    "compound": compound,
                    "core": bool(core_local.contains(c)),
                }
            )

    # 同一 ID 被拆成多块时加后缀，保证唯一
    seen: dict[str, int] = {}
    for b in buildings:
        n = seen.get(b["id"], 0)
        seen[b["id"]] = n + 1
        if n:
            b["id"] = f'{b["id"]}-{n}'

    # 与 OSM 建筑轮廓比对，检查两套数据有没有系统性偏移（例如 GCJ-02 加密偏移会到几百米）
    osm_centroids = []
    for el in elements:
        if "building" in el.get("tags", {}) and el["type"] == "way":
            g = area_geometry(el)
            if g is not None and not g.is_empty:
                osm_centroids.append(to_local(g).centroid)
    cb_xy = np.array([[b["poly"].centroid.x, b["poly"].centroid.y] for b in buildings])
    offsets = []
    for c in osm_centroids:
        d = cb_xy - np.array([c.x, c.y])
        i = int(np.argmin(np.hypot(d[:, 0], d[:, 1])))
        if math.hypot(*d[i]) < 30:
            offsets.append(d[i])
    offsets = np.array(offsets)
    med = np.median(offsets, axis=0) if len(offsets) else np.array([np.nan, np.nan])
    print(f"OSM 建筑 {len(osm_centroids)} 栋，30 m 内匹配到 CBMF {len(offsets)} 栋，"
          f"质心偏移中位数 dx={med[0]:.2f} m dy={med[1]:.2f} m", file=sys.stderr)

    # 道路
    roads = []
    for el in elements:
        tags = el.get("tags", {})
        hw = tags.get("highway")
        if el["type"] != "way" or hw not in ROAD_CLASSES:
            continue
        line = to_local(LineString(way_coords(el)))
        roads.append({"n": tags.get("name"), "c": ROAD_CLASSES[hw], "b": 1 if tags.get("bridge") == "yes" else 0,
                      "p": line_dm(line.simplify(0.5).coords)})

    # 水系
    water = []
    for el in elements:
        tags = el.get("tags", {})
        if tags.get("natural") == "water":
            g = area_geometry(el)
            for p in explode_polygons(to_local(g) if g is not None else None):
                water.append({"r": ring_dm(p.simplify(1.0).exterior.coords)})
        elif tags.get("waterway") in ("river", "canal", "stream") and el["type"] == "way":
            line = to_local(LineString(way_coords(el)))
            water.append({"l": line_dm(line.simplify(1.0).coords), "w": 30 if tags.get("waterway") == "river" else 6})

    out = {
        "version": 1,
        "origin": {"lat": ORIGIN_LAT, "lon": ORIGIN_LON},
        "projection": LOCAL_PROJ,
        "unit": "dm",
        "core": [round(v * 10) for v in core_local.bounds],
        "floorHeight": FLOOR_HEIGHT,
        "attribution": [
            "建筑轮廓与高度：CBMF（Zheng et al., 2026, doi:10.5281/zenodo.18595960, CC BY 4.0），高度源自 3D-GloBFP",
            "道路、小区、水系：© OpenStreetMap contributors（ODbL）",
        ],
        "compounds": [
            {"n": c["name"], "k": c["kind"],
             "r": [ring_dm(p.exterior.coords) for p in c["parts"]]}
            for c in compound_list
        ],
        "buildings": [
            {
                "id": b["id"],
                "r": [ring_dm(b["poly"].exterior.coords)] + [ring_dm(i.coords) for i in b["poly"].interiors],
                "h": round(b["height"] * 10),
                "f": b["floors"],
                "c": b["cls"],
                "s": b["src"],
                **({"k": b["compound"]} if b["compound"] is not None else {}),
                **({"core": 1} if b["core"] else {}),
            }
            for b in buildings
        ],
        "roads": roads,
        "water": water,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # 待实地核验清单：核心区里最高的住宅楼，遥感最容易低估的那些
    todo = sorted((b for b in buildings if b["core"] and b["cls"] == "R" and b["src"] == "cbmf"),
                  key=lambda b: -b["height"])[:40]
    to_wgs = Transformer.from_crs(LOCAL_PROJ, "EPSG:4326", always_xy=True)
    with SURVEY_TODO.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["id", "compound", "lat", "lon", "cbmf_height_m", "estimated_floors", "floors"])
        for b in todo:
            lon, lat = to_wgs.transform(b["poly"].centroid.x, b["poly"].centroid.y)
            w.writerow([b["id"], compound_list[b["compound"]]["name"] if b["compound"] is not None else "",
                        f"{lat:.6f}", f"{lon:.6f}", f'{b["height"]:.1f}', b["floors"], ""])

    n_core = sum(b["core"] for b in buildings)
    n_comp = sum(b["compound"] is not None for b in buildings if b["core"])
    print(f"建筑 {len(buildings)} 栋（核心区 {n_core} 栋，其中 {n_comp} 栋落在已命名小区内），"
          f"小区 {len(compound_list)} 个，道路 {len(roads)} 条，水系 {len(water)} 处，"
          f"实地核验 {sum(b['src'] == 'survey' for b in buildings)} 栋", file=sys.stderr)
    print(f"写出 {OUT.relative_to(ROOT)}（{OUT.stat().st_size / 1024:.0f} KB）", file=sys.stderr)


if __name__ == "__main__":
    main()
