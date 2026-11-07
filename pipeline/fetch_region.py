"""下载片区以外的区域数据：成都地铁线路与车站、可达车站周边的步行网、远景底图。

只负责下载并缓存到 pipeline/raw/，处理在 build_region.py 里做。
分两步，是因为步行网要按"30 分钟内可能到达的车站"去取，得先有地铁数据：

    python pipeline/fetch_region.py metro      # 地铁线路、车站、出入口
    python pipeline/fetch_region.py walk       # 片区周边与候选车站周边的步行网（需先跑 build_region.py --candidates）
    python pipeline/fetch_region.py basemap    # 远景底图：主干道与水系
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_district import RAW, overpass  # noqa: E402

# 成都中心城区及外围，地铁线路只取经过这个框的
METRO_BBOX = "30.30,103.70,30.95,104.50"


def fetch_metro() -> None:
    overpass(
        f"""
[out:json][timeout:300];
relation["route"="subway"]({METRO_BBOX});
out geom;
""",
        RAW / "region-metro-routes.json",
    )
    overpass(
        f"""
[out:json][timeout:180];
(
  node["railway"="subway_entrance"]({METRO_BBOX});
  node["railway"="station"]["station"="subway"]({METRO_BBOX});
  node["public_transport"="station"]["subway"="yes"]({METRO_BBOX});
);
out body;
""",
        RAW / "region-metro-nodes.json",
    )


def fetch_walk() -> None:
    """按 raw/region-candidates.json 里的圆（车站周边）与片区外框取步行网"""
    spec = json.loads((RAW / "region-candidates.json").read_text(encoding="utf-8"))
    parts = [f'way["highway"]({spec["bbox"]});']
    for c in spec["circles"]:
        parts.append(f'way["highway"](around:{c["r"]:.0f},{c["lat"]:.6f},{c["lon"]:.6f});')
    body = "\n  ".join(parts)
    overpass(
        f"""
[out:json][timeout:600][maxsize:1073741824];
(
  {body}
);
out geom tags;
""",
        RAW / "region-walk.json",
    )


def fetch_basemap() -> None:
    spec = json.loads((RAW / "region-candidates.json").read_text(encoding="utf-8"))
    q = spec["basemapBbox"]
    overpass(
        f"""
[out:json][timeout:600][maxsize:1073741824];
(
  way["highway"~"^(motorway|trunk|primary|secondary)$"]({q});
  way["waterway"="river"]({q});
  way["natural"="water"]["water"~"^(river|lake|reservoir|pond)$"]({q});
  relation["natural"="water"]({q});
);
out geom tags;
""",
        RAW / "region-basemap.json",
    )


if __name__ == "__main__":
    sys.stderr.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    steps = {"metro": fetch_metro, "walk": fetch_walk, "basemap": fetch_basemap}
    for name in sys.argv[1:] or ["metro"]:
        steps[name]()
        print(f"{name} 完成", file=sys.stderr)
