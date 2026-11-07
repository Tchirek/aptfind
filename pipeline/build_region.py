"""生成区域数据 public/data/region.json：地铁网、步行网、远景底图。

用途是选中一栋楼后画出"15 分钟步行"与"30 分钟（步行 + 地铁）"可达范围：
步行到地铁站、进站候车、乘车（可换乘）、出站，再从别的车站步行出去，30 分钟内到达的都算。

- 地铁：OpenStreetMap 的 route=subway 线路关系（站序、轨道几何）与出入口；
- 步行网：片区外框外扩 2.6 km（步行 30 分钟的最远距离再留余量），
  加上 30 分钟内可能到达的每个车站周边（半径按剩余时间算）；
- 远景底图：上述范围外扩后的快速路、主次干道与河流。

用法（数据按需下载，缓存在 pipeline/raw/）：
    python pipeline/fetch_region.py metro
    python pipeline/build_region.py --candidates   # 算出候选车站与取数范围
    python pipeline/fetch_region.py walk basemap
    python pipeline/build_region.py
"""

from __future__ import annotations

import argparse
import heapq
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import shapely
from shapely.geometry import LineString, Point

sys.path.insert(0, str(Path(__file__).resolve().parent))
import network  # noqa: E402
from build_district import CORE, RAW, ROOT, TO_WGS, dm, line_dm, xy_local  # noqa: E402

OUT = ROOT / "public" / "data" / "region.json"

# ---- 出行参数（分钟、米/分钟），前端 src/engine/metro.ts 用同一组值
BUDGET = 30.0
WALK_SPEED = 75.0
BOARD = 5.0  # 出入口到站台（安检、扶梯）约 2 分钟，加上平均候车约 3 分钟
TRANSFER = 5.0  # 站内换乘步行加候车
EXIT = 2.0  # 站台到出入口
# 线路平均旅行速度（含停站）：普线约 31 km/h；17/18/19 号线为市域快线
DEFAULT_SPEED = 520.0
LINE_SPEED = {"17": 870.0, "18": 1250.0, "19": 1250.0}

# 片区外框外扩：步行 30 分钟 2250 m，再留路网绕行的余量
WALK_MARGIN = 2600.0
# 车站周边步行网半径的上限（米）
MAX_STATION_RADIUS = 1800.0
# 出入口归属车站的最大距离（米）
ENTRANCE_RADIUS = 400.0
# 少于这么多站的线路关系多为快车、直达车等特殊交路，不单独建模
MIN_STOPS = 4


def norm_station(name: str) -> str:
    """'四川师大站' → '四川师大'；'成都东客站' 本身就叫这个名字，不能去掉'站'"""
    name = name.strip()
    for suffix in ("地铁站",):
        if name.endswith(suffix):
            name = name[: -len(suffix)]
    if name.endswith("站") and not name.endswith("客站") and not name.endswith("火车站") and len(name) > 2:
        name = name[:-1]
    return name


class Metro:
    """站点按名称合并；每条线路（ref）的相邻站之间连边，权重为轨道里程"""

    def __init__(self) -> None:
        routes = json.loads((RAW / "region-metro-routes.json").read_text(encoding="utf-8"))["elements"]
        nodes = json.loads((RAW / "region-metro-nodes.json").read_text(encoding="utf-8"))["elements"]

        self.station_names: list[str] = []
        self.station_xy: list[list[tuple[float, float]]] = []  # 各线路站台位置，最后取平均
        self.index: dict[str, int] = {}
        self.lines: dict[str, dict] = {}
        # (ref, a, b) → 轨道几何（局部坐标折线，a→b 方向）
        self.segments: dict[tuple[str, int, int], np.ndarray] = {}

        for rel in routes:
            tags = rel.get("tags", {})
            ref = tags.get("ref")
            if not ref or not ref.isdigit():
                continue
            members = rel.get("members", [])
            stops = [m for m in members if m["type"] == "node" and m["role"].startswith("stop")]
            if len(stops) < MIN_STOPS:
                continue
            track = self._merge_track([m for m in members if m["type"] == "way" and m["role"] == ""])
            line = self.lines.setdefault(
                ref,
                {"ref": ref, "name": f"{ref}号线", "colour": tags.get("colour", "#888888"), "patterns": []},
            )
            seq: list[int] = []
            for m in stops:
                name = self._stop_name(m, nodes)
                if not name:
                    continue
                k = self._station(name)
                x, y = xy_local(m["lon"], m["lat"])
                self.station_xy[k].append((float(x), float(y)))
                if not seq or seq[-1] != k:
                    seq.append(k)
            if len(seq) < MIN_STOPS:
                continue
            # 环线：关系里首尾不是同一站，但线路是闭合的（7 号线），补上最后一段
            loop = "环" in tags.get("name", "") and seq[0] != seq[-1]
            if loop:
                seq.append(seq[0])
            line["patterns"].append(seq)
            for a, b in zip(seq, seq[1:]):
                key = (ref, min(a, b), max(a, b))
                if key not in self.segments:
                    self.segments[key] = self._segment(track, a, b) if track is not None else None

        self.xy = np.array([np.mean(p, axis=0) for p in self.station_xy])
        for key, seg in list(self.segments.items()):
            _, a, b = key
            if seg is None:
                seg = np.array([self.xy[a], self.xy[b]])
            # 统一成 min→max 方向
            if np.hypot(*(seg[0] - self.xy[a])) > np.hypot(*(seg[0] - self.xy[b])):
                seg = seg[::-1]
            self.segments[key] = seg

        self.entrances: list[list[tuple[float, float]]] = [[] for _ in self.station_names]
        station_nodes = [n for n in nodes if n.get("tags", {}).get("railway") == "station"]
        for n in nodes:
            if n.get("tags", {}).get("railway") != "subway_entrance":
                continue
            x, y = xy_local(n["lon"], n["lat"])
            d = np.hypot(self.xy[:, 0] - x, self.xy[:, 1] - y)
            k = int(np.argmin(d))
            if d[k] <= ENTRANCE_RADIUS:
                self.entrances[k].append((float(x), float(y)))
        # 没有出入口数据的车站，用 OSM 车站节点（或站台平均位置）代替
        for k, name in enumerate(self.station_names):
            if self.entrances[k]:
                continue
            match = [s for s in station_nodes if norm_station(s["tags"].get("name", "")) == name]
            if match:
                x, y = xy_local(match[0]["lon"], match[0]["lat"])
                self.entrances[k].append((float(x), float(y)))
            else:
                self.entrances[k].append((float(self.xy[k][0]), float(self.xy[k][1])))

    def _stop_name(self, m: dict, nodes: list[dict]) -> str | None:
        # out geom 的关系成员不带标签；按坐标回查 stop_position 节点没有意义（不在 nodes 里），
        # 所以取最近的车站节点名
        best = None
        best_d = 1e9
        for n in self._station_nodes(nodes):
            d = (n["lat"] - m["lat"]) ** 2 + ((n["lon"] - m["lon"]) * 0.86) ** 2
            if d < best_d:
                best, best_d = n, d
        if best is None or math.sqrt(best_d) * 111_000 > 450:
            return None
        return norm_station(best["tags"].get("name", ""))

    _station_cache: list[dict] | None = None

    def _station_nodes(self, nodes: list[dict]) -> list[dict]:
        if self._station_cache is None:
            self._station_cache = [
                n for n in nodes if n.get("tags", {}).get("railway") == "station" and n.get("tags", {}).get("name")
            ]
        return self._station_cache

    def _station(self, name: str) -> int:
        k = self.index.get(name)
        if k is None:
            k = len(self.station_names)
            self.index[name] = k
            self.station_names.append(name)
            self.station_xy.append([])
        return k

    @staticmethod
    def _merge_track(ways: list[dict]) -> LineString | None:
        parts = []
        for w in ways:
            g = w.get("geometry") or []
            if len(g) < 2:
                continue
            x, y = xy_local(np.array([p["lon"] for p in g]), np.array([p["lat"] for p in g]))
            parts.append(np.column_stack([x, y]))
        if not parts:
            return None
        # 按关系里的顺序首尾相接，必要时翻转
        line = parts[0]
        for p in parts[1:]:
            ends = [
                np.hypot(*(line[-1] - p[0])),
                np.hypot(*(line[-1] - p[-1])),
                np.hypot(*(line[0] - p[0])),
                np.hypot(*(line[0] - p[-1])),
            ]
            k = int(np.argmin(ends))
            if k == 0:
                line = np.vstack([line, p])
            elif k == 1:
                line = np.vstack([line, p[::-1]])
            elif k == 2:
                line = np.vstack([line[::-1], p])
            else:
                line = np.vstack([line[::-1], p[::-1]])
        return LineString(line)

    def _segment(self, track: LineString, a: int, b: int) -> np.ndarray | None:
        pa = np.mean(self.station_xy[a], axis=0)
        pb = np.mean(self.station_xy[b], axis=0)
        if track.distance(Point(pa)) > 250 or track.distance(Point(pb)) > 250:
            return None
        sa = track.project(Point(pa))
        sb = track.project(Point(pb))
        lo, hi = sorted([sa, sb])
        sub = shapely.ops.substring(track, lo, hi)
        coords = np.asarray(sub.coords)
        if len(coords) < 2:
            return None
        # 线路关系偶尔把两个方向的轨道都收进来，导致子段绕远；比直线长太多就退回直线
        if sub.length > 2.2 * np.hypot(*(pa - pb)) + 300:
            return None
        if sa > sb:
            coords = coords[::-1]
        return coords

    def speed(self, ref: str) -> float:
        return LINE_SPEED.get(ref, DEFAULT_SPEED)

    def ride_minutes(self, ref: str, a: int, b: int) -> float:
        seg = self.segments[(ref, min(a, b), max(a, b))]
        length = float(np.sum(np.hypot(*np.diff(seg, axis=0).T)))
        return length / self.speed(ref)

    def earliest(self, boards: dict[int, float]) -> np.ndarray:
        """从若干车站以给定时刻（已含进站候车）上车，各站最早到达站台的时刻"""
        adj: dict[tuple[int, str], list[tuple[tuple[int, str], float]]] = defaultdict(list)
        refs_at: dict[int, set[str]] = defaultdict(set)
        for ref, a, b in self.segments:
            t = self.ride_minutes(ref, a, b)
            adj[(a, ref)].append(((b, ref), t))
            adj[(b, ref)].append(((a, ref), t))
            refs_at[a].add(ref)
            refs_at[b].add(ref)
        best: dict[tuple[int, str], float] = {}
        heap: list[tuple[float, int, str]] = []
        for s, t in boards.items():
            for ref in refs_at[s]:
                best[(s, ref)] = t
                heapq.heappush(heap, (t, s, ref))
        while heap:
            t, s, ref = heapq.heappop(heap)
            if t > best.get((s, ref), 1e9):
                continue
            nxt = list(adj[(s, ref)])
            nxt += [((s, r2), TRANSFER) for r2 in refs_at[s] if r2 != ref]
            for state, w in nxt:
                nt = t + w
                if nt < best.get(state, 1e9):
                    best[state] = nt
                    heapq.heappush(heap, (nt, state[0], state[1]))
        out = np.full(len(self.station_names), np.inf)
        for (s, _), t in best.items():
            out[s] = min(out[s], t)
        return out


def core_bbox_local() -> tuple[float, float, float, float]:
    x0, y0 = xy_local(CORE["west"], CORE["south"])
    x1, y1 = xy_local(CORE["east"], CORE["north"])
    return float(x0), float(y0), float(x1), float(y1)


def candidates(metro: Metro) -> None:
    minx, miny, maxx, maxy = core_bbox_local()
    # 片区里任意一栋楼走到某站，至少要走"核心区外框到出入口的直线距离"；以此为下界估上车时刻
    boards: dict[int, float] = {}
    for k, ents in enumerate(metro.entrances):
        for x, y in ents:
            dx = max(minx - x, 0, x - maxx)
            dy = max(miny - y, 0, y - maxy)
            t = BOARD + math.hypot(dx, dy) / WALK_SPEED
            if t < BUDGET - EXIT and t < boards.get(k, 1e9):
                boards[k] = t
    arrive = metro.earliest(boards)
    circles = []
    for k, t in enumerate(arrive):
        left = BUDGET - t - EXIT
        if left <= 0.5:
            continue
        r = min(MAX_STATION_RADIUS, left * WALK_SPEED)
        for x, y in metro.entrances[k][:1] or [tuple(metro.xy[k])]:
            lon, lat = TO_WGS.transform(x, y)
            circles.append({"name": metro.station_names[k], "lat": lat, "lon": lon, "r": r + 150, "t": round(t, 1)})
    lon0, lat0 = TO_WGS.transform(minx - WALK_MARGIN, miny - WALK_MARGIN)
    lon1, lat1 = TO_WGS.transform(maxx + WALK_MARGIN, maxy + WALK_MARGIN)
    # 远景底图：所有候选车站外扩 3 km
    xs = [metro.xy[metro.index[c["name"]]][0] for c in circles] + [minx, maxx]
    ys = [metro.xy[metro.index[c["name"]]][1] for c in circles] + [miny, maxy]
    blon0, blat0 = TO_WGS.transform(min(xs) - 3000, min(ys) - 3000)
    blon1, blat1 = TO_WGS.transform(max(xs) + 3000, max(ys) + 3000)
    spec = {
        "bbox": f"{lat0:.5f},{lon0:.5f},{lat1:.5f},{lon1:.5f}",
        "basemapBbox": f"{blat0:.5f},{blon0:.5f},{blat1:.5f},{blon1:.5f}",
        "circles": circles,
    }
    (RAW / "region-candidates.json").write_text(json.dumps(spec, ensure_ascii=False, indent=1), encoding="utf-8")
    print(
        f"片区步行可达车站 {len(boards)} 个：{'、'.join(metro.station_names[k] for k in boards)}\n"
        f"30 分钟内可能到达的车站 {len(circles)} 个",
        file=sys.stderr,
    )
    for c in sorted(circles, key=lambda c: c["t"]):
        print(f"  {c['name']}  到站 {c['t']} 分  半径 {c['r']:.0f} m", file=sys.stderr)


def simplify_line(coords: np.ndarray, tol: float) -> np.ndarray:
    return np.asarray(LineString(coords).simplify(tol).coords)


def build(metro: Metro) -> None:
    walk_el = json.loads((RAW / "region-walk.json").read_text(encoding="utf-8"))["elements"]
    minx, miny, maxx, maxy = core_bbox_local()
    big = 1e7
    net = network.build_network(walk_el, xy_local, (-big, -big, big, big), min_component=40)
    print(f"步行网：{len(net['nodes'])} 个节点，{len(net['edges'])} 条边", file=sys.stderr)

    # 只保留 30 分钟内可能用到的车站与线段
    spec = json.loads((RAW / "region-candidates.json").read_text(encoding="utf-8"))
    keep = {metro.index[c["name"]] for c in spec["circles"]}
    remap = {k: i for i, k in enumerate(sorted(keep))}
    stations = [
        {
            "n": metro.station_names[k],
            "p": [dm(metro.xy[k][0]), dm(metro.xy[k][1])],
            "e": [v for x, y in metro.entrances[k] for v in (dm(x), dm(y))],
        }
        for k in sorted(keep)
    ]
    lines = []
    for ref, line in sorted(metro.lines.items(), key=lambda kv: int(kv[0])):
        segs = []
        for (r, a, b), seg in metro.segments.items():
            if r != ref or a not in keep or b not in keep:
                continue
            segs.append({"a": remap[a], "b": remap[b], "p": line_dm(simplify_line(seg, 4.0))})
        if segs:
            lines.append({"ref": ref, "name": line["name"], "colour": line["colour"], "speed": metro.speed(ref), "s": segs})

    base = json.loads((RAW / "region-basemap.json").read_text(encoding="utf-8"))["elements"]
    roads = []
    water = []
    cls_of = {"motorway": 0, "trunk": 0, "primary": 1, "secondary": 2}
    for el in base:
        tags = el.get("tags", {})
        if el["type"] == "way" and tags.get("highway") in cls_of:
            g = el.get("geometry") or []
            if len(g) < 2:
                continue
            x, y = xy_local(np.array([p["lon"] for p in g]), np.array([p["lat"] for p in g]))
            pts = simplify_line(np.column_stack([x, y]), 6.0)
            roads.append({"c": cls_of[tags["highway"]], "p": line_dm(pts)})
        elif el["type"] == "way" and tags.get("waterway") == "river":
            g = el.get("geometry") or []
            if len(g) < 2:
                continue
            x, y = xy_local(np.array([p["lon"] for p in g]), np.array([p["lat"] for p in g]))
            pts = simplify_line(np.column_stack([x, y]), 6.0)
            water.append({"l": line_dm(pts), "w": 40})

    out = {
        "version": 1,
        "unit": "dm",
        "params": {
            "budget": BUDGET,
            "walkSpeed": WALK_SPEED,
            "board": BOARD,
            "transfer": TRANSFER,
            "exit": EXIT,
        },
        "stations": stations,
        "lines": lines,
        "walk": {
            "n": [dm(v) for v in net["nodes"].ravel()],
            "e": [int(v) for v in net["edges"].ravel()],
            "s": [int(i) for i in np.flatnonzero(net["steps"])],
        },
        "basemap": {"roads": roads, "water": water},
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(
        f"写出 {OUT.relative_to(ROOT)}：{OUT.stat().st_size / 1e6:.2f} MB，车站 {len(stations)}，线路 {len(lines)}，"
        f"底图道路 {len(roads)}",
        file=sys.stderr,
    )


def main() -> None:
    sys.stderr.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidates", action="store_true", help="只算候选车站与取数范围")
    args = ap.parse_args()
    metro = Metro()
    print(f"地铁：{len(metro.station_names)} 站，{len(metro.lines)} 条线，{len(metro.segments)} 个区间", file=sys.stderr)
    if args.candidates:
        candidates(metro)
    else:
        build(metro)


if __name__ == "__main__":
    main()
