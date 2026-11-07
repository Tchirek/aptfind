"""小区、校园题图：读高德采集的地点照片（tools/amap-collect.ts 的 photos()），写出 public/data/photos.json。

- 只收地点名与地块名对得上的；名字里带"停车场""派出所"等的是别的地点，不要；
- REJECT 里是人工逐张看过后剔除的（照的是室内、地图截图、海报等，不是这个地块）；
- 一律改成 https，部署的站点是 https，混合内容会被浏览器拦下。
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "pipeline" / "raw" / "amap" / "photos.json"
OUT = ROOT / "public" / "data" / "photos.json"

OTHER_PLACE = re.compile(r"(停车场|派出所|警务室|餐厅|食堂|入口|出口|幼儿园)")
REJECT = {"华兴新居", "索尔龙舟", "瀚林美居", "绿野天城", "卓锦城2期", "成都三中"}


def main() -> None:
    raw: dict[str, dict] = json.loads(RAW.read_text(encoding="utf-8"))
    out: dict[str, str] = {}
    for name, p in raw.items():
        if name in REJECT or OTHER_PLACE.search(p["poi"]):
            continue
        out[name] = re.sub(r"^http://", "https://", p["url"])
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"题图 {len(out)} / {len(raw)}")


if __name__ == "__main__":
    main()
