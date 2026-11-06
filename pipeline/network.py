"""步行路网：从 OSM 道路构建无向图，前端在上面跑 Dijkstra 求步行距离与路线。

- 快速路及其匝道、施工/规划中的道路、标了 foot=no 的路不走；
- 校园、小区内部道路（access=private/destination）照常可走，居民与学生都会走；
- 节点按坐标去重（Overpass 的 out geom 不给节点编号，相同坐标即同一节点）；
- 只有度为 2 的中间点保留形状，便于画出贴合道路的路线。
"""

from __future__ import annotations

import numpy as np

EXCLUDED = {"motorway", "motorway_link", "construction", "proposed", "platform", "raceway", "bus_guideway"}


def walkable(tags: dict) -> bool:
    hw = tags.get("highway")
    if hw is None or hw in EXCLUDED:
        return False
    if tags.get("foot") == "no" or tags.get("access") == "no":
        return False
    if tags.get("area") == "yes":
        return False
    return True


def build_network(elements: list[dict], to_local_xy, clip: tuple[float, float, float, float]) -> dict:
    """clip = (minx, miny, maxx, maxy)，局部坐标；两端都在框外的边丢弃。

    返回 {'nodes': float64[n,2], 'edges': int32[m,2], 'steps': bool[m]}
    """
    index: dict[tuple[int, int], int] = {}
    nodes: list[tuple[float, float]] = []
    edges: list[tuple[int, int]] = []
    steps: list[bool] = []

    def node(lon: float, lat: float) -> int:
        key = (round(lon * 1e7), round(lat * 1e7))
        k = index.get(key)
        if k is None:
            k = len(nodes)
            index[key] = k
            nodes.append((lon, lat))
        return k

    for el in elements:
        if el.get("type") != "way":
            continue
        tags = el.get("tags", {})
        if not walkable(tags):
            continue
        geom = el.get("geometry", [])
        ids = [node(p["lon"], p["lat"]) for p in geom]
        is_steps = tags.get("highway") == "steps"
        for a, b in zip(ids, ids[1:]):
            if a != b:
                edges.append((a, b))
                steps.append(is_steps)

    lonlat = np.array(nodes)
    x, y = to_local_xy(lonlat[:, 0], lonlat[:, 1])
    xy = np.column_stack([x, y])
    e = np.array(edges, dtype=np.int32)
    inside = (xy[:, 0] >= clip[0]) & (xy[:, 0] <= clip[2]) & (xy[:, 1] >= clip[1]) & (xy[:, 1] <= clip[3])
    edge_in = inside[e[:, 0]] | inside[e[:, 1]]
    e = e[edge_in]
    steps = list(np.array(steps)[edge_in])

    # 只保留最大连通分量，孤立的小段路（数据缺口）会让最近节点落在走不出去的地方
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components

    n = len(xy)
    adj = coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(n, n))
    _, label = connected_components(adj, directed=False)
    main = np.argmax(np.bincount(label))
    keep = label == main
    remap = -np.ones(n, dtype=np.int64)
    remap[keep] = np.arange(keep.sum())
    edge_keep = keep[e[:, 0]] & keep[e[:, 1]]
    return {
        "nodes": xy[keep],
        "edges": remap[e[edge_keep]].astype(np.int32),
        "steps": np.array(steps)[edge_keep],
        "dropped_nodes": int((~keep).sum()),
    }
