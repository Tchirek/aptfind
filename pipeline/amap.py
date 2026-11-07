"""读取 tools/amap.html 采集的高德数据（pipeline/raw/amap/*.json），并把 GCJ-02 坐标还原成 WGS-84。

地名与设施：© 高德开放平台。
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from pathlib import Path

ATTRIBUTION = "地名与设施：高德开放平台"

_A = 6378245.0
_EE = 0.00669342162296594323


def _t_lat(x: float, y: float) -> float:
    r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * math.sqrt(abs(x))
    r += (20 * math.sin(6 * x * math.pi) + 20 * math.sin(2 * x * math.pi)) * 2 / 3
    r += (20 * math.sin(y * math.pi) + 40 * math.sin(y / 3 * math.pi)) * 2 / 3
    r += (160 * math.sin(y / 12 * math.pi) + 320 * math.sin(y * math.pi / 30)) * 2 / 3
    return r


def _t_lon(x: float, y: float) -> float:
    r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * math.sqrt(abs(x))
    r += (20 * math.sin(6 * x * math.pi) + 20 * math.sin(2 * x * math.pi)) * 2 / 3
    r += (20 * math.sin(x * math.pi) + 40 * math.sin(x / 3 * math.pi)) * 2 / 3
    r += (150 * math.sin(x / 12 * math.pi) + 300 * math.sin(x / 30 * math.pi)) * 2 / 3
    return r


def wgs84_to_gcj02(lon: float, lat: float) -> tuple[float, float]:
    d_lat = _t_lat(lon - 105, lat - 35)
    d_lon = _t_lon(lon - 105, lat - 35)
    rad = lat / 180 * math.pi
    magic = 1 - _EE * math.sin(rad) ** 2
    sq = math.sqrt(magic)
    d_lat = d_lat * 180 / ((_A * (1 - _EE)) / (magic * sq) * math.pi)
    d_lon = d_lon * 180 / (_A / sq * math.cos(rad) * math.pi)
    return lon + d_lon, lat + d_lat


def gcj02_to_wgs84(lon: float, lat: float) -> tuple[float, float]:
    """迭代反算，误差小于 1e-7 度（约 1 cm）"""
    wlon, wlat = lon, lat
    for _ in range(8):
        glon, glat = wgs84_to_gcj02(wlon, wlat)
        wlon += lon - glon
        wlat += lat - glat
    return wlon, wlat


def parse_location(s: str) -> tuple[float, float]:
    lon, lat = (float(v) for v in s.split(","))
    return gcj02_to_wgs84(lon, lat)


@dataclass
class Poi:
    category: str
    name: str
    type: str
    lon: float
    lat: float


CATEGORY_FILES = ["metro", "bus", "grocery", "market", "food", "medical", "school", "park", "sport"]

MEDICAL_NAME = re.compile(r"(医院|诊所|门诊|卫生|医疗中心|急救|药房|药店|大药)")


def keep_poi(category: str, name: str, typ: str) -> bool:
    """高德的大类里混着不相干的店，逐类收紧到居民日常会用到的那些"""
    if category == "medical":
        if any(t in typ for t in ("动物医疗", "整形美容", "医疗保健用品", "医药保健相关")):
            return False
        # "医疗保健服务场所"是泛类，里面有养生馆、保健品店
        if "医疗保健服务场所" in typ and not MEDICAL_NAME.search(name):
            return False
        return True
    if category == "grocery":
        return any(t in typ for t in ("便民商店", "便利店", "超市", "超级市场"))
    if category == "market":
        return any(t in typ for t in ("农副产品市场", "蔬菜市场", "综合市场", "果品市场")) or bool(
            re.search(r"(菜市场|农贸市场)", name)
        )
    if category == "sport":
        return "台球" not in typ
    return True


def load_pois(raw: Path) -> list[Poi]:
    out: list[Poi] = []
    seen: set[str] = set()
    for cat in CATEGORY_FILES:
        f = raw / f"poi-{cat}.json"
        if not f.exists():
            continue
        for p in json.loads(f.read_text(encoding="utf-8")):
            if p["id"] in seen or not keep_poi(cat, p["name"], p.get("type", "")):
                continue
            seen.add(p["id"])
            lon, lat = parse_location(p["location"])
            out.append(Poi(cat, p["name"], p.get("type", ""), lon, lat))
    return out


# 指名标出的连锁品牌：类别名 → 店名须以它开头（排除"甜品站""取餐点"与以公司名登记的重复点）
BRANDS = {"mcdonalds": "麦当劳", "starbucks": "星巴克", "haidilao": "海底捞"}
BRAND_EXCLUDE = re.compile(r"(甜品站|取餐点|外送|外卖)")


def load_brands(raw: Path) -> list[Poi]:
    f = raw / "poi-brands.json"
    if not f.exists():
        return []
    out: list[Poi] = []
    seen: set[str] = set()
    for p in json.loads(f.read_text(encoding="utf-8")):
        name = p["name"]
        cat = next((k for k, v in BRANDS.items() if name.startswith(v)), None)
        if cat is None or BRAND_EXCLUDE.search(name) or p["id"] in seen:
            continue
        seen.add(p["id"])
        lon, lat = parse_location(p["location"])
        out.append(Poi(cat, name, p.get("type", ""), lon, lat))
    return out


def load_named_places(raw: Path) -> list[Poi]:
    """校园内部设施与楼宇类 POI：用于给单栋楼起名"""
    out: list[Poi] = []
    for f in ("poi-campus.json", "poi-campus2.json"):
        path = raw / f
        if path.exists():
            for p in json.loads(path.read_text(encoding="utf-8")):
                lon, lat = parse_location(p["location"])
                out.append(Poi("campus", p["name"], p.get("type", ""), lon, lat))
    regeo = raw / "regeo.json"
    if regeo.exists():
        for r in json.loads(regeo.read_text(encoding="utf-8")):
            for p in r.get("pois", []):
                lon, lat = parse_location(p["location"])
                out.append(Poi("regeo", p["name"], p.get("type", ""), lon, lat))
    return out


def load_regeo(raw: Path) -> dict[str, dict]:
    f = raw / "regeo.json"
    if not f.exists():
        return {}
    return {r["id"]: r for r in json.loads(f.read_text(encoding="utf-8"))}


def load_roads(raw: Path) -> dict[str, list[dict]]:
    """道路样点的逆地理编码结果：样点 id → 附近道路 [{name, distance, direction}]，按距离从近到远"""
    f = raw / "roads.json"
    if not f.exists():
        return {}
    out: dict[str, list[dict]] = {}
    for r in json.loads(f.read_text(encoding="utf-8")):
        roads = [x for x in r.get("roads", []) if text(x.get("name"))]
        out[r["id"]] = sorted(roads, key=lambda x: float(x.get("distance") or 1e9))
    return out


def text(v) -> str:
    """高德在缺值时会给空数组，统一成字符串"""
    return v if isinstance(v, str) else ""


CAMPUS_PREFIX = re.compile(r"^(四川师范大学|四川师大|川师)(\s*[（(]?狮子山校区[）)]?)?[-—·\s]*")


def balance_brackets(name: str) -> str:
    """去掉首尾的括号与连接符；括号不成对时全部去掉"""
    name = name.strip(" -—·")
    if name.count("(") + name.count("（") != name.count(")") + name.count("）"):
        name = re.sub(r"[()（）]", "", name)
    return name.strip(" -—·")


def clean_campus_name(name: str) -> str:
    """'四川师范大学(狮子山校区)-图书馆'、'四川师范大学狮子山校区逸馨楼' → '图书馆'、'逸馨楼'"""
    return balance_brackets(CAMPUS_PREFIX.sub("", name))
