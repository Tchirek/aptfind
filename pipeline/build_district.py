"""生成狮子山片区的场景数据 public/data/district.json（v3）。

数据来源：
- 建筑轮廓与高度：CBMF（Zheng et al., 2026, doi:10.5281/zenodo.18595960, CC BY 4.0），
  高度来自 3D-GloBFP 遥感反演，可用 survey.csv 的实地层数覆盖。
- 地形：Copernicus DEM GLO-30，经去建筑处理（见 terrain.py）。
- 道路、小区与校园边界、水系、地铁出入口：OpenStreetMap（ODbL），经 Overpass API 获取。
  步行网与地铁网在 build_region.py 里另行生成（region.json）。
- 地名（小区 AOI、校内建筑）与生活设施：高德开放平台，由 tools/amap.html 在本地采集。

用法：
    python pipeline/build_district.py --cbmf <Sichuan.gdb 路径>

第一次运行会写出 pipeline/raw/amap/input-points.json（核心区每栋楼的坐标）；
在开发服务器打开 /tools/amap.html 采集高德数据后再运行一次，地名与设施即补齐。

坐标：以片区中心为原点的横轴墨卡托投影（米），x 指东、y 指北；高程 z 相对片区最低地面。
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pyogrio
import shapely
from pyproj import Transformer
from shapely.geometry import LineString, MultiPolygon, Point, Polygon
from shapely.ops import linemerge, polygonize
from shapely.strtree import STRtree

sys.path.insert(0, str(Path(__file__).resolve().parent))
import amap  # noqa: E402
import terrain  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "pipeline" / "raw"
AMAP_RAW = RAW / "amap"
OUT = ROOT / "public" / "data" / "district.json"
SURVEY = ROOT / "pipeline" / "survey.csv"
SURVEY_TODO = ROOT / "pipeline" / "survey_todo.csv"
COMPOUND_INFO = ROOT / "pipeline" / "compound_info.csv"
COMPOUND_HEIGHTS = ROOT / "pipeline" / "compound_heights.csv"
# 每户住宅建筑面积（含公摊），由户数反推塔楼层数用
GFA_PER_HOUSEHOLD = 100.0
# 没有公开最高层数时的上限：成都住宅塔楼绝大多数在 100 m（约 34 层）以下
DEFAULT_MAX_FLOORS = 34
NAME_OVERRIDES = ROOT / "pipeline" / "names.csv"
NAMES_TODO = ROOT / "pipeline" / "names_todo.csv"

# 川师狮子山校区中心
ORIGIN_LAT, ORIGIN_LON = 30.6160, 104.1200
# 计算逐窗日照的核心区（约 2.0 km × 2.1 km）
CORE = dict(south=30.6070, west=104.1090, north=30.6250, east=104.1310)
# 核心区外再扩约 350 m，只作为遮挡物参与计算
BUFFER_DEG = 0.0035

FLOOR_HEIGHT = 3.0
MIN_AREA = 40.0  # m²，更小的多为岗亭、棚架、配电房
MIN_WIDTH = 3.5  # m，最小外接矩形短边，更窄的多为围墙、连廊被误识别成楼
MAX_WATER_OVERLAP = 0.3
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

LOCAL_PROJ = f"+proj=tmerc +lat_0={ORIGIN_LAT} +lon_0={ORIGIN_LON} +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m"
TO_LOCAL = Transformer.from_crs("EPSG:4326", LOCAL_PROJ, always_xy=True)
TO_WGS = Transformer.from_crs(LOCAL_PROJ, "EPSG:4326", always_xy=True)


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


def to_local(geom):
    return shapely.transform(geom, lambda xy: np.column_stack(TO_LOCAL.transform(xy[:, 0], xy[:, 1])))


def xy_local(lon, lat):
    x, y = TO_LOCAL.transform(lon, lat)
    return np.asarray(x), np.asarray(y)


def dm(v: float) -> int:
    return round(v * 10)


def ring_dm(coords) -> list[int]:
    """环坐标转成分米整数并展平，去掉闭合点"""
    out: list[int] = []
    for x, y in list(coords)[:-1]:
        out += [dm(x), dm(y)]
    return out


def line_dm(coords) -> list[int]:
    out: list[int] = []
    for x, y in coords:
        out += [dm(x), dm(y)]
    return out


# ---------------------------------------------------------------- OSM


def overpass(query: str, cache: Path) -> dict:
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    body = urllib.parse.urlencode({"data": query}).encode()
    for attempt in range(3):
        for endpoint in OVERPASS_ENDPOINTS:
            req = urllib.request.Request(endpoint, data=body, headers={"User-Agent": "aptfind-pipeline/0.3"})
            try:
                with urllib.request.urlopen(req, timeout=240) as resp:
                    data = json.load(resp)
                RAW.mkdir(parents=True, exist_ok=True)
                cache.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
                return data
            except (urllib.error.URLError, TimeoutError) as e:
                print(f"Overpass {endpoint} 失败（第 {attempt + 1} 轮）：{e}", file=sys.stderr)
        time.sleep(20 * (attempt + 1))
    raise SystemExit("Overpass 全部失败，稍后再试")


def fetch_osm(b: Bounds) -> dict:
    q = b.overpass
    return overpass(
        f"""
[out:json][timeout:180];
(
  way["highway"]({q});
  way["landuse"="residential"]({q});
  relation["landuse"="residential"]({q});
  way["amenity"~"^(university|college|school)$"]({q});
  way["waterway"~"^(river|canal|stream)$"]({q});
  way["natural"="water"]({q});
  relation["natural"="water"]({q});
  way["building"]({q});
);
out geom tags;
""",
        RAW / "osm.json",
    )


def fetch_osm_metro(b: Bounds) -> dict:
    q = b.expand(0.004).overpass
    return overpass(
        f"""
[out:json][timeout:120];
(
  node["railway"="subway_entrance"]({q});
  node["station"="subway"]({q});
  node["railway"="station"]["subway"="yes"]({q});
);
out body;
""",
        RAW / "osm-metro.json",
    )


def way_coords(el: dict) -> list[tuple[float, float]]:
    return [(p["lon"], p["lat"]) for p in el.get("geometry", [])]


def area_geometry(el: dict) -> Polygon | MultiPolygon | None:
    """把 OSM 的闭合 way 或 multipolygon relation 转成多边形（经纬度）"""
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


def explode_polygons(geom) -> list[Polygon]:
    if geom is None or geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [geom]
    return [g for g in getattr(geom, "geoms", []) if isinstance(g, Polygon)]


# 地面上各级道路画出的路面宽度（米），与 src/scene/groundTexture.ts 的 ROAD_WIDTH 保持一致
ROAD_DRAW_WIDTH = [26, 20, 14, 9, 6, 3.5]

ROAD_CLASSES = {
    "motorway": 0, "trunk": 0, "primary": 1, "secondary": 2, "tertiary": 3,
    "motorway_link": 2, "trunk_link": 2, "primary_link": 2, "secondary_link": 3, "tertiary_link": 3,
    "residential": 4, "unclassified": 4, "living_street": 4, "service": 5, "pedestrian": 5,
}


def is_open_water(tags: dict) -> bool:
    """暗渠（tunnel=culvert）、地下河段（layer<0）、加盖的（covered=yes）都不画成水面"""
    if tags.get("tunnel") or tags.get("covered") == "yes":
        return False
    try:
        return int(tags.get("layer", "0")) >= 0
    except ValueError:
        return True


# ---------------------------------------------------------------- CBMF


def load_cbmf(gdb: Path, b: Bounds) -> list[dict]:
    meta, _, geoms, fields = pyogrio.raw.read(gdb, bbox=(b.west, b.south, b.east, b.north))
    cols = {n: fields[i] for i, n in enumerate(meta["fields"])}
    return [
        {"geometry": shapely.from_wkb(g), "ID": cols["ID"][i], "Height": cols["Height"][i], "class_pred": cols["class_pred"][i]}
        for i, g in enumerate(geoms)
    ]


def min_width(p: Polygon) -> float:
    r = shapely.minimum_rotated_rectangle(p)
    xs, ys = r.exterior.coords.xy
    sides = [math.hypot(xs[i + 1] - xs[i], ys[i + 1] - ys[i]) for i in range(2)]
    return min(sides)


def read_csv(path: Path, key: str) -> dict[str, dict]:
    if not path.exists():
        return {}
    with path.open(encoding="utf-8") as f:
        return {row[key]: row for row in csv.DictReader(f) if row.get(key)}


# ---------------------------------------------------------------- 地名


HAN = re.compile(r"[一-鿿]")
LABEL_SUFFIX = re.compile(r"(楼|馆|堂|中心|宿舍|公寓|食堂|栋|幢|座|苑|舍|学院|研究院|研究所|医院|体育场|运动场)$")
LABEL_TYPES = ("学校内部设施", "楼宇", "宿舍", "图书馆", "体育馆", "科研机构", "博物馆", "展览馆", "礼堂")
# 住宅小区是整片的名字，不是单栋楼的
SKIP_TYPES = ("餐饮服务", "购物服务", "生活服务", "汽车", "金融保险", "交通设施", "公司企业", "住宿服务", "住宅区", "停车场")
SCHOOL_AOI = ("1412",)
RESIDENTIAL_AOI = ("1203",)


def label_score(name: str, typ: str) -> int:
    """单栋楼名称候选的优先级，0 表示不用"""
    if not HAN.search(name) or "售楼" in name:
        return 0
    if any(t in typ for t in LABEL_TYPES):
        return 3
    if any(t in typ for t in SKIP_TYPES):
        return 0
    if LABEL_SUFFIX.search(name):
        return 2
    return 0


def aoi_kind(typecode: str) -> str:
    if typecode.startswith(SCHOOL_AOI):
        return "school"
    if typecode.startswith(RESIDENTIAL_AOI):
        return "residential"
    return "other"


def norm_name(s: str) -> str:
    return re.sub(r"[\s()（）·\-—]", "", s)


def strip_compound(label: str, compound: str | None) -> str:
    """'比华利国际城-3栋' 在'比华利国际城'里 → '3栋'"""
    if compound:
        for prefix in (compound, re.sub(r"[（(].*?[）)]", "", compound)):
            if prefix and label.startswith(prefix):
                rest = amap.balance_brackets(label[len(prefix) :])
                return rest or label
    return label


def derived_boundary(polys: list[Polygon]) -> list[Polygon]:
    """由同一小区的楼推算一个大致范围：外扩 14 m 合并，再收回 9 m，抹平楼间空隙"""
    g = shapely.union_all([p.buffer(14, join_style="mitre") for p in polys]).buffer(-9, join_style="mitre")
    return [p.simplify(2.0) for p in explode_polygons(g) if p.area > 400]


# ---------------------------------------------------------------- main


# 高德逆地理编码给出的"附近道路"离取样点不超过这么远，才认为就是这条路（米，按道路等级）
ROAD_MATCH_DISTANCE = {0: 25, 1: 25, 2: 22, 3: 18, 4: 14, 5: 10}


def name_roads(
    road_lines: list[tuple[int, LineString, dict]], amap_roads: dict[str, list[dict]]
) -> tuple[dict[int, str], list[dict]]:
    """OSM 有名字的用 OSM 的；没有的用高德逆地理编码的附近道路投票补上。

    每条无名道路沿线取 1–5 个样点。一个样点认定某个路名，须同时满足：
    高德给出的道路离样点足够近（ROAD_MATCH_DISTANCE）；附近没有同名的 OSM 道路比它更近
    （否则高德指的是旁边那条已有名字的路，比如主干道旁的辅路、小区通道）。
    过半样点认定同一个名字才采用。返回 (way id → 路名, 待采集的样点)。
    """
    names: dict[int, str] = {}
    named = [(line, tags["name"]) for _, line, tags in road_lines if tags.get("name")]
    tree = STRtree([line for line, _ in named]) if named else None
    points: list[dict] = []
    adopted = 0
    for wid, line, tags in road_lines:
        if tags.get("name"):
            names[wid] = tags["name"]
            continue
        n = max(1, min(5, round(line.length / 60)))
        samples = [line.interpolate((k + 0.5) / n, normalized=True) for k in range(n)]
        votes: Counter[str] = Counter()
        limit = ROAD_MATCH_DISTANCE[ROAD_CLASSES[tags["highway"]]]
        for k, pt in enumerate(samples):
            lon, lat = TO_WGS.transform(pt.x, pt.y)
            pid = f"{wid}:{k}"
            points.append({"id": pid, "lon": round(lon, 7), "lat": round(lat, 7)})
            for r in amap_roads.get(pid, []):
                name = r.get("name") or ""
                d = float(r.get("distance") or 1e9)
                if not name or d > limit:
                    continue
                if tree is not None:
                    near = [named[i] for i in tree.query(pt.buffer(d + 8))]
                    if any(nm == name and ln.distance(pt) <= d + 8 for ln, nm in near):
                        continue
                votes[name] += 1
                break  # 每个样点只取最近的一条
        if votes:
            name, count = votes.most_common(1)[0]
            if count * 2 > n or (n == 1 and count == 1):
                names[wid] = name
                adopted += 1
    if amap_roads:
        unnamed = sum(1 for wid, _, _ in road_lines if wid not in names)
        print(f"道路：高德补名 {adopted} 条，仍无名 {unnamed} 条（共 {len(road_lines)} 条）", file=sys.stderr)
    return names, points


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cbmf", required=True, type=Path, help="CBMF 四川 Sichuan.gdb 目录")
    args = ap.parse_args()
    sys.stderr.reconfigure(encoding="utf-8")

    core = Bounds(**CORE)
    outer = core.expand(BUFFER_DEG)
    core_local = to_local(shapely.box(core.west, core.south, core.east, core.north))
    outer_local = to_local(shapely.box(outer.west, outer.south, outer.east, outer.north))

    elements = fetch_osm(outer)["elements"]
    metro_nodes = fetch_osm_metro(outer)["elements"]

    # ---------------- 水系
    water_polys: list[Polygon] = []
    water_lines: list[tuple[LineString, float]] = []
    for el in elements:
        tags = el.get("tags", {})
        if tags.get("natural") == "water" and is_open_water(tags):
            water_polys += explode_polygons(to_local(area_geometry(el)) if area_geometry(el) is not None else None)
        elif tags.get("waterway") in ("river", "canal", "stream") and el["type"] == "way" and is_open_water(tags):
            try:
                width = float(tags.get("width", ""))
            except ValueError:
                width = 8.0 if tags.get("waterway") == "river" else 2.5
            water_lines.append((to_local(LineString(way_coords(el))), width))
    water_union = shapely.union_all(water_polys) if water_polys else Polygon()

    # ---------------- OSM 小区与校园
    osm_compounds: list[dict] = []
    unnamed_res: list[Polygon] = []
    for el in elements:
        tags = el.get("tags", {})
        is_res = tags.get("landuse") == "residential"
        is_school = tags.get("amenity") in ("university", "college", "school")
        if not (is_res or is_school):
            continue
        g = area_geometry(el)
        parts = [p for p in explode_polygons(to_local(g) if g is not None else None) if p.area >= 500]
        if not parts:
            continue
        if tags.get("name"):
            osm_compounds.append({"name": tags["name"], "kind": "school" if is_school else "residential", "parts": parts, "source": "osm"})
        elif is_res:
            unnamed_res += parts

    # OSM 里有名字的建筑：用来给校内建筑等起名
    osm_named: list[tuple[Polygon, str]] = []
    for el in elements:
        tags = el.get("tags", {})
        if "building" in tags and HAN.search(tags.get("name", "")):
            for p in explode_polygons(to_local(area_geometry(el)) if area_geometry(el) is not None else None):
                osm_named.append((p, tags["name"]))

    # ---------------- CBMF 建筑
    rows = load_cbmf(args.cbmf, outer)
    survey = read_csv(SURVEY, "id")
    dropped: Counter = Counter()
    buildings: list[dict] = []
    for row in rows:
        for poly in explode_polygons(row["geometry"]):
            p = to_local(poly)
            if p.area < MIN_AREA:
                dropped["面积过小"] += 1
                continue
            p = shapely.geometry.polygon.orient(p.simplify(SIMPLIFY, preserve_topology=True), 1.0)
            if p.is_empty or not p.is_valid or p.area < MIN_AREA:
                dropped["面积过小"] += 1
                continue
            if min_width(p) < MIN_WIDTH:
                dropped["细长碎片"] += 1
                continue
            if not water_union.is_empty and p.intersects(water_union) and p.intersection(water_union).area / p.area > MAX_WATER_OVERLAP:
                dropped["落在水面上"] += 1
                continue
            buildings.append(
                {
                    "id": str(int(row["ID"])),
                    "poly": p,
                    "height": float(row["Height"]),
                    "cls": CLASS_CODES.get(row["class_pred"], "U"),
                    "src": "cbmf",
                    "core": bool(core_local.contains(p.centroid)),
                }
            )

    seen: dict[str, int] = {}
    for b in buildings:
        n = seen.get(b["id"], 0)
        seen[b["id"]] = n + 1
        if n:
            b["id"] = f'{b["id"]}-{n}'
    for b in buildings:
        if b["id"] in survey:
            b["height"] = int(survey[b["id"]]["floors"]) * FLOOR_HEIGHT
            b["src"] = "survey"
        b["floors"] = max(1, round(b["height"] / FLOOR_HEIGHT))

    # ---------------- 地形
    terrain_cache = RAW / "terrain.npz"
    if terrain_cache.exists():
        t = np.load(terrain_cache)
        grid = terrain.TerrainGrid(float(t["x0"]), float(t["y0"]), float(t["step"]), t["z"], float(t["base"]))
    else:
        polys_wgs = [p for r in rows for p in explode_polygons(r["geometry"])]
        grid, diag = terrain.build_terrain((outer.west, outer.south, outer.east, outer.north), polys_wgs, xy_local)
        np.savez(terrain_cache, x0=grid.x0, y0=grid.y0, step=grid.step, z=grid.z, base=grid.base)
        print(f"地形：{json.dumps(diag, ensure_ascii=False)}", file=sys.stderr)
    for b in buildings:
        xs, ys = b["poly"].exterior.coords.xy
        # 坡地上的楼以最低处为基底，上坡一侧的墙埋进地形里
        b["base"] = float(grid.sample(np.asarray(xs), np.asarray(ys)).min())

    # ---------------- 地名
    regeo = amap.load_regeo(AMAP_RAW)
    places = amap.load_named_places(AMAP_RAW)
    overrides = read_csv(NAME_OVERRIDES, "id")

    tree = STRtree([b["poly"] for b in buildings])

    def containing(pt: Point, tol: float = 2.0) -> list[int]:
        return [int(i) for i in tree.query(pt.buffer(tol), predicate="intersects")]

    labels: dict[int, tuple[int, str]] = {}

    def offer(i: int, score: int, name: str) -> None:
        if "售楼" in name:
            return
        if score and name and (i not in labels or score > labels[i][0]):
            labels[i] = (score, name)

    for poly, name in osm_named:
        for i in [int(i) for i in tree.query(poly, predicate="intersects")]:
            inter = buildings[i]["poly"].intersection(poly).area
            if inter > 0.5 * min(poly.area, buildings[i]["poly"].area):
                offer(i, 4, amap.clean_campus_name(name))
    polys = [b["poly"] for b in buildings]
    for pl in places:
        x, y = xy_local(pl.lon, pl.lat)
        pt = Point(float(x), float(y))
        score = label_score(pl.name, pl.type)
        if not score:
            continue
        hits = containing(pt)
        if not hits and score >= 3:
            # 宿舍、校内设施的点常标在楼门口：12 m 内取最近的楼，分数降一档
            i = int(tree.nearest(pt))
            if polys[i].distance(pt) <= 12:
                offer(i, score - 1, amap.clean_campus_name(pl.name))
        for i in hits:
            offer(i, score, amap.clean_campus_name(pl.name))

    # 小区归属：先看 OSM 有名字的多边形（取最小的那个，附中在校园里时归附中）
    comp_geoms = [(k, shapely.union_all(c["parts"])) for k, c in enumerate(osm_compounds)]
    member: dict[int, int] = {}
    for i, b in enumerate(buildings):
        c = b["poly"].centroid
        hits = [(g.area, k) for k, g in comp_geoms if g.contains(c)]
        if hits:
            member[i] = min(hits)[1]

    def aoi_of(b: dict) -> tuple[str, str, float] | None:
        """(名称, 类型码, 面积 m²)"""
        r = regeo.get(b["id"])
        if not r:
            return None
        for a in r.get("aois", []):
            name = amap.text(a.get("name"))
            if name:
                try:
                    area = float(a.get("area") or 0)
                except (TypeError, ValueError):
                    area = 0.0
                return name, amap.text(a.get("type")), area
        if "住宅" in amap.text(r.get("neighborhoodType")) and amap.text(r.get("neighborhood")):
            return amap.text(r["neighborhood"]), "120302", 0.0
        return None

    aoi_info = {i: aoi_of(b) for i, b in enumerate(buildings)}
    aoi = {i: (v[0] if v else None) for i, v in aoi_info.items()}
    aoi_kinds = {v[0]: aoi_kind(v[1]) for v in aoi_info.values() if v}

    # 落在 OSM 大地块（如校园）里的 AOI：
    # - 住宅类（桂苑、务实苑）是子片区，比校园本身更具体，改归 AOI；
    # - 其他小 AOI（第一教学楼、图书馆）其实是单栋楼的名字，楼仍归校园。
    for i, v in aoi_info.items():
        if not v or i not in member:
            continue
        k = member[i]
        if norm_name(v[0]) == norm_name(osm_compounds[k]["name"]):
            continue
        area_osm = comp_geoms[k][1].area
        if v[1].startswith(RESIDENTIAL_AOI) and v[2] < 0.5 * area_osm:
            del member[i]
        elif not v[1].startswith(RESIDENTIAL_AOI) and v[2] < 0.25 * area_osm:
            offer(i, 5, amap.clean_campus_name(v[0]))
            aoi[i] = None

    # 没名字的 OSM 住宅用地：按楼里多数高德 AOI 命名
    for poly in unnamed_res:
        inside = [i for i in tree.query(poly, predicate="intersects") if i not in member and poly.contains(buildings[i]["poly"].centroid)]
        names = Counter(aoi[i] for i in inside if aoi[i])
        if names:
            name, n = names.most_common(1)[0]
            if n >= 0.5 * len(inside):
                osm_compounds.append({"name": name, "kind": aoi_kinds.get(name, "residential"), "parts": [poly], "source": "osm"})
                k = len(osm_compounds) - 1
                for i in inside:
                    member[int(i)] = k

    # 其余按高德 AOI 分组，范围由楼推算
    by_name = {norm_name(c["name"]): k for k, c in enumerate(osm_compounds)}
    groups: dict[str, list[int]] = defaultdict(list)
    for i, name in aoi.items():
        if i in member or not name:
            continue
        k = by_name.get(norm_name(name))
        if k is not None:
            member[i] = k
        else:
            groups[name].append(i)
    n_osm = len(osm_compounds)
    for name, idx in groups.items():
        parts = derived_boundary([buildings[i]["poly"] for i in idx])
        if not parts:
            continue
        center = shapely.union_all(parts).representative_point()
        parent = min(((g.area, k) for k, g in comp_geoms[:n_osm] if g.contains(center)), default=(0, None))[1]
        if parent is not None:
            name = amap.clean_campus_name(name)
        osm_compounds.append(
            {"name": name, "kind": aoi_kinds.get(name, aoi_kinds.get(next(iter([n for n in aoi_kinds if n.endswith(name)]), ""), "residential")),
             "parts": parts, "source": "derived", "parent": parent}
        )
        k = len(osm_compounds) - 1
        for i in idx:
            member[i] = k

    # 合并同名
    merged: dict[str, dict] = {}
    remap: dict[int, int] = {}
    order: list[dict] = []
    for k, c in enumerate(osm_compounds):
        key = norm_name(c["name"])
        if key in merged:
            m = merged[key]
            m["parts"] += c["parts"]
            if c["source"] == "osm":
                m["source"] = "osm"
        else:
            m = {**c, "parts": list(c["parts"])}
            merged[key] = m
            order.append(m)
        remap[k] = order.index(m)
    compounds = order
    for c in compounds:
        if c.get("parent") is not None:
            c["parent"] = remap[c["parent"]]
    info = read_csv(COMPOUND_INFO, "name")

    for i, b in enumerate(buildings):
        b["compound"] = remap[member[i]] if i in member else None
        label = overrides.get(b["id"], {}).get("name") or (labels[i][1] if i in labels else None)
        if label:
            cname = compounds[b["compound"]]["name"] if b["compound"] is not None else None
            label = strip_compound(label, cname)
            if cname and norm_name(label) == norm_name(cname):
                label = None
        b["label"] = label

    # ---------------- 楼高校正
    # CBMF 的高度由遥感反演，高层普遍被压低（OSM 标了 35、38 层的塔楼在 CBMF 里只有 7–14 层）。
    # 1) OSM 上标了 building:levels 的楼直接用它；
    # 2) compound_heights.csv 里查到楼栋数的小区：CBMF 里最高的 N 个足迹算作塔楼，层数由住宅面积反推——
    #    有户数时按 户数 × 每户 100 m²（含公摊）÷ 塔楼足迹面积之和；
    #    没有户数时按 容积率 × 用地面积 ÷ 塔楼足迹面积之和（OSM 的小区边界常比实际用地小，这样算偏低）；
    #    都不超过公开的最高层数。
    # 两步都只往高里改，实地核验（survey.csv）的楼不动。
    osm_levels: list[tuple[Polygon, int]] = []
    for el in elements:
        tags = el.get("tags", {})
        if "building:levels" not in tags or not ("building" in tags or "building:part" in tags):
            continue
        try:
            levels = int(float(tags["building:levels"]))
        except ValueError:
            continue
        g = area_geometry(el)
        osm_levels += [(p, levels) for p in explode_polygons(to_local(g) if g is not None else None)]
    level_tree = STRtree([p for p, _ in osm_levels]) if osm_levels else None
    raised: Counter = Counter()
    for b in buildings:
        if level_tree is None or b["src"] == "survey":
            continue
        best = max(
            ((osm_levels[int(j)][0].intersection(b["poly"]).area / b["poly"].area, osm_levels[int(j)][1])
             for j in level_tree.query(b["poly"], predicate="intersects")),
            default=(0.0, 0),
        )
        if best[0] >= 0.3 and best[1] > b["floors"]:
            b["floors"] = best[1]
            b["height"] = best[1] * FLOOR_HEIGHT
            b["src"] = "osm"
            raised["OSM 层数"] += 1

    with COMPOUND_HEIGHTS.open(encoding="utf-8") as f:
        plans = list(csv.DictReader(f))
    by_compound_name = {c["name"]: k for k, c in enumerate(compounds)}
    for row in plans:
        names = row["names"].split("|")
        ks = {by_compound_name[n] for n in names if n in by_compound_name}
        if not ks:
            print(f"  楼高校正：找不到小区 {row['names']}", file=sys.stderr)
            continue
        site = shapely.union_all([p for k in ks for p in compounds[k]["parts"]]).area
        members = [b for b in buildings if b["compound"] in ks and b["src"] == "cbmf" and b["poly"].area >= 250]
        towers = sorted(members, key=lambda b: (-b["height"], -b["poly"].area))[: int(row["towers"])]
        if not towers:
            continue
        foot = sum(b["poly"].area for b in towers)
        cap = int(row["max_floors"]) if row.get("max_floors") else DEFAULT_MAX_FLOORS
        gfa = int(row["households"]) * GFA_PER_HOUSEHOLD if row.get("households") else float(row["far"]) * site
        floors = max(1, min(cap, round(gfa / foot)))
        for b in towers:
            if floors > b["floors"]:
                b["floors"] = floors
                b["height"] = floors * FLOOR_HEIGHT
                b["src"] = "plan"
                raised["容积率推算"] += 1
        print(f"  楼高校正 {names[0]}：{'户数' if row.get('households') else '容积率'}，{len(towers)} 栋塔楼足迹 {foot:.0f} m² → {floors} 层", file=sys.stderr)
        if row.get("built_year"):
            for n in names:
                info.setdefault(n, {"name": n, "built_year": "", "note": ""})
                if not info[n].get("built_year"):
                    info[n]["built_year"] = row["built_year"]
    print(f"  楼高校正：{dict(raised)}", file=sys.stderr)

    # ---------------- 设施
    pois: list[dict] = []
    for p in amap.load_pois(AMAP_RAW):
        x, y = xy_local(p.lon, p.lat)
        if outer_local.contains(Point(float(x), float(y))):
            pois.append({"n": p.name, "c": p.category, "p": [dm(float(x)), dm(float(y))]})
    # 指名的连锁品牌：片区外扩 3 km 内都收（最近一家可能在片区外）
    wide = outer_local.buffer(3000)
    for p in amap.load_brands(AMAP_RAW):
        x, y = xy_local(p.lon, p.lat)
        if wide.contains(Point(float(x), float(y))):
            pois.append({"n": p.name, "c": p.category, "p": [dm(float(x)), dm(float(y))]})
    has_amap_metro = any(p["c"] == "metro" for p in pois)
    if not has_amap_metro:
        for el in metro_nodes:
            tags = el.get("tags", {})
            x, y = xy_local(el["lon"], el["lat"])
            name = tags.get("name") or (f'{tags["ref"]}口' if tags.get("ref") else "地铁出入口")
            pois.append({"n": name, "c": "metro", "p": [dm(float(x)), dm(float(y))]})

    # ---------------- 道路
    road_lines: list[tuple[int, LineString, dict]] = []
    for el in elements:
        tags = el.get("tags", {})
        hw = tags.get("highway")
        if el["type"] != "way" or hw not in ROAD_CLASSES:
            continue
        line = to_local(LineString(way_coords(el)))
        if not line.intersects(outer_local.buffer(200)):
            continue
        road_lines.append((el["id"], line, tags))
    road_names, road_points = name_roads(road_lines, amap.load_roads(AMAP_RAW))
    roads = []
    for wid, line, tags in road_lines:
        hw = tags["highway"]
        roads.append({"n": road_names.get(wid), "c": ROAD_CLASSES[hw], "b": 1 if tags.get("bridge") == "yes" else 0,
                      "p": line_dm(line.simplify(0.5).coords)})

    # ---------------- 压在路面上的建筑
    # 地面按道路等级画出路面（宽度与前端 groundTexture 的 ROAD_WIDTH 一致）。CBMF 偶尔把路边棚子、
    # 车辆识别成楼，也有足迹与 OSM 道路中线差了几米，画出来就是楼压在马路上。
    # 只看支路及以上、不在桥上的路：过半落在路面里的足迹删去；部分压到的切掉路面那一块，
    # 剩下的仍像一栋楼（面积、宽度够，且不少于原来一半）才保留。
    def elevated(tags: dict) -> bool:
        try:
            return tags.get("bridge") not in (None, "no") or int(tags.get("layer", "0")) > 0
        except ValueError:
            return False

    strips = [
        line.buffer(ROAD_DRAW_WIDTH[ROAD_CLASSES[tags["highway"]]] / 2, cap_style=2)
        for _, line, tags in road_lines
        if ROAD_CLASSES[tags["highway"]] <= 3 and not elevated(tags) and not tags.get("tunnel")
    ]
    road_surface = shapely.union_all(strips) if strips else Polygon()
    surface_tree = STRtree(strips) if strips else None
    on_road: Counter = Counter()
    kept: list[dict] = []
    for b in buildings:
        p = b["poly"]
        if surface_tree is None or b["src"] == "survey" or not len(surface_tree.query(p, predicate="intersects")):
            kept.append(b)
            continue
        overlap = p.intersection(road_surface).area / p.area
        if overlap <= 0.02:
            kept.append(b)
        elif overlap > 0.5:
            on_road["删去"] += 1
        else:
            rest = max(explode_polygons(p.difference(road_surface)), key=lambda q: q.area, default=None)
            if rest is None or rest.area < max(MIN_AREA, 0.5 * p.area) or min_width(rest) < MIN_WIDTH:
                on_road["删去"] += 1
                continue
            b["poly"] = shapely.geometry.polygon.orient(rest.simplify(SIMPLIFY, preserve_topology=True), 1.0)
            on_road["切掉路面"] += 1
            kept.append(b)
    buildings = kept
    print(f"  压在路面上的建筑：{dict(on_road)}", file=sys.stderr)

    water = [{"r": ring_dm(p.simplify(1.0).exterior.coords)} for p in water_polys]
    water += [{"l": line_dm(l.simplify(1.0).coords), "w": w} for l, w in water_lines if l.intersects(outer_local.buffer(200))]

    attribution = [
        "建筑：CBMF（Zheng et al., 2026, doi:10.5281/zenodo.18595960, CC BY 4.0），高度源自 3D-GloBFP；"
        "高层住宅的层数按 OSM 标注与房天下、链家等公开的小区楼栋数、户数、容积率校正",
        terrain.ATTRIBUTION,
        "道路、步行网、地铁线路、边界、水系：© OpenStreetMap contributors（ODbL）",
    ]
    if regeo or pois:
        attribution.append(amap.ATTRIBUTION)

    out = {
        "version": 3,
        "origin": {"lat": ORIGIN_LAT, "lon": ORIGIN_LON},
        "projection": LOCAL_PROJ,
        "unit": "dm",
        "core": [dm(v) for v in core_local.bounds],
        "floorHeight": FLOOR_HEIGHT,
        "attribution": attribution,
        "terrain": {
            "x0": dm(grid.x0),
            "y0": dm(grid.y0),
            "step": dm(grid.step),
            "nx": int(grid.z.shape[1]),
            "ny": int(grid.z.shape[0]),
            "base": grid.base,
            "z": [dm(v) for v in grid.z.ravel()],
        },
        "compounds": [
            {
                "n": c["name"],
                "k": c["kind"],
                "o": c["source"],
                **({"p": c["parent"]} if c.get("parent") is not None else {}),
                "r": [ring_dm(p.exterior.coords) for p in c["parts"]],
                **({"y": int(info[c["name"]]["built_year"])} if info.get(c["name"], {}).get("built_year") else {}),
            }
            for c in compounds
        ],
        "buildings": [
            {
                "id": b["id"],
                "r": [ring_dm(b["poly"].exterior.coords)] + [ring_dm(i.coords) for i in b["poly"].interiors],
                "h": dm(b["height"]),
                "f": b["floors"],
                "z": dm(b["base"]),
                "c": b["cls"],
                "s": b["src"],
                **({"k": b["compound"]} if b["compound"] is not None else {}),
                **({"n": b["label"]} if b["label"] else {}),
                **({"core": 1} if b["core"] else {}),
            }
            for b in buildings
        ],
        "roads": roads,
        "water": water,
        "pois": pois,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # 高德采集的输入：核心区每栋楼的质心（WGS-84）
    AMAP_RAW.mkdir(parents=True, exist_ok=True)
    pts = []
    for b in buildings:
        if b["core"]:
            c = b["poly"].representative_point()
            lon, lat = TO_WGS.transform(c.x, c.y)
            pts.append({"id": b["id"], "lon": round(lon, 7), "lat": round(lat, 7)})
    (AMAP_RAW / "input-points.json").write_text(json.dumps(pts), encoding="utf-8")
    # 高德采集的输入：小区、校园的中心点（找题图用）
    cpts = []
    for c in compounds:
        if c["kind"] not in ("residential", "school"):
            continue
        p = max(c["parts"], key=lambda q: q.area).representative_point()
        lon, lat = TO_WGS.transform(p.x, p.y)
        cpts.append({"name": c["name"], "kind": c["kind"], "lon": round(lon, 6), "lat": round(lat, 6)})
    (AMAP_RAW / "compound-points.json").write_text(json.dumps(cpts, ensure_ascii=False), encoding="utf-8")
    # 高德采集的输入：OSM 里没有名字的道路，沿线取样点
    (AMAP_RAW / "road-points.json").write_text(json.dumps(road_points), encoding="utf-8")

    # 待实地核验：核心区里最高的住宅楼
    todo = sorted((b for b in buildings if b["core"] and b["cls"] == "R" and b["src"] == "cbmf"), key=lambda b: -b["height"])[:40]
    with SURVEY_TODO.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["id", "compound", "lat", "lon", "cbmf_height_m", "estimated_floors", "floors"])
        for b in todo:
            lon, lat = TO_WGS.transform(b["poly"].centroid.x, b["poly"].centroid.y)
            cname = compounds[b["compound"]]["name"] if b["compound"] is not None else ""
            w.writerow([b["id"], cname, f"{lat:.6f}", f"{lon:.6f}", f'{b["height"]:.1f}', b["floors"], ""])

    # 校园里还没有名字的楼：按面积从大到小列出，方便在 names.csv 里手工补名
    campus = {k for k, c in enumerate(compounds) if "师范大学" in c["name"] and "狮子山" in c["name"]}
    campus |= {k for k, c in enumerate(compounds) if c.get("parent") in campus}
    unnamed = sorted(
        (b for b in buildings if b["compound"] in campus and not b["label"]), key=lambda b: -b["poly"].area
    )
    with NAMES_TODO.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["id", "area", "lat", "lon", "floors", "footprint_m2", "name"])
        for b in unnamed:
            lon, lat = TO_WGS.transform(b["poly"].centroid.x, b["poly"].centroid.y)
            w.writerow([b["id"], compounds[b["compound"]]["name"], f"{lat:.6f}", f"{lon:.6f}", b["floors"], round(b["poly"].area), ""])

    # 小区建成年代表：第一次运行时预填住宅小区的名字，之后不覆盖已填的内容
    if not info:
        res = sorted((c for c in compounds if c["kind"] == "residential"), key=lambda c: c["name"])
        with COMPOUND_INFO.open("w", encoding="utf-8", newline="") as f:
            w = csv.writer(f, lineterminator="\n")
            w.writerow(["name", "built_year", "note"])
            for c in res:
                w.writerow([c["name"], "", ""])

    n_core = sum(b["core"] for b in buildings)
    named_core = sum(1 for b in buildings if b["core"] and b["compound"] is not None)
    labelled = sum(1 for b in buildings if b["core"] and b["label"])
    print(
        f"建筑 {len(buildings)} 栋（核心区 {n_core}，归入小区/校园 {named_core}，有单栋名称 {labelled}）；"
        f"剔除 {dict(dropped)}；小区与校园 {len(compounds)} 个（推算范围 {sum(c['source'] == 'derived' for c in compounds)}）；"
        f"设施 {len(pois)}（{dict(Counter(p['c'] for p in pois))}）；"
        f"水面 {len(water_polys)} 块、水道 {len(water_lines)} 条；地形 {grid.z.shape[1]}×{grid.z.shape[0]}，"
        f"高差 {np.nanmax(grid.z):.1f} m",
        file=sys.stderr,
    )
    print(f"写出 {OUT.relative_to(ROOT)}（{OUT.stat().st_size / 1024:.0f} KB）", file=sys.stderr)


if __name__ == "__main__":
    main()
