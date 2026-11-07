"""从 HYG 星表（v4.1，CC BY-SA 4.0）取肉眼可见的亮星，写出 public/data/stars.json。

只留视星等 ≤ 5.0 的约 1600 颗（太阳除外），每颗存 [赤经（度）, 赤纬（度）, 星等, B−V 色指数]。
前端按所选日期与时刻换算成地平坐标，画在夜空里；岁差、自行忽略（J2000 至今偏差约 0.4°）。

    python pipeline/build_stars.py   # 需先把 hygdata_v41.csv 放在 pipeline/raw/stars/
"""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "pipeline" / "raw" / "stars" / "hygdata_v41.csv"
OUT = ROOT / "public" / "data" / "stars.json"
MAX_MAG = 5.0


def main() -> None:
    stars = []
    with SRC.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row["proper"] == "Sol":
                continue
            try:
                mag = float(row["mag"])
            except ValueError:
                continue
            if mag > MAX_MAG:
                continue
            ra = float(row["ra"]) * 15  # 小时 → 度
            dec = float(row["dec"])
            ci = float(row["ci"]) if row["ci"] else 0.6
            stars.append([round(ra, 3), round(dec, 3), round(mag, 2), round(ci, 2)])
    stars.sort(key=lambda s: s[2])
    out = {
        "version": 1,
        "source": "HYG Database v4.1（astronexus，CC BY-SA 4.0），视星等 ≤ 5.0",
        "stars": stars,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"写出 {OUT.relative_to(ROOT)}：{len(stars)} 颗，{OUT.stat().st_size / 1024:.0f} KB", file=sys.stderr)


if __name__ == "__main__":
    sys.stderr.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    main()
