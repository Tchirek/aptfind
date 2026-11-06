"""用 NREL SPA（pvlib 实现）生成太阳位置参考值，供 src/engine/solar.test.ts 对拍。

用法：python pipeline/reference_solar.py src/engine/__fixtures__/spa-reference.json
"""

import json
import sys
from pathlib import Path

import pandas as pd
import pvlib

# 狮子山片区中心（川师狮子山校区）
CHENGDU = (30.6160, 104.1200)

CASES = [
    # (说明, 纬度, 经度, UTC 时间列表)
    ("成都·大寒 2027-01-20", *CHENGDU, pd.date_range("2027-01-20 00:00", "2027-01-20 11:00", freq="37min", tz="UTC")),
    ("成都·冬至 2026-12-22", *CHENGDU, pd.date_range("2026-12-22 00:30", "2026-12-22 10:30", freq="41min", tz="UTC")),
    ("成都·夏至 2027-06-21", *CHENGDU, pd.date_range("2027-06-20 23:00", "2027-06-21 12:00", freq="53min", tz="UTC")),
    ("成都·春分 2027-03-21", *CHENGDU, pd.date_range("2027-03-20 23:30", "2027-03-21 11:30", freq="47min", tz="UTC")),
    # NREL SPA 论文里的标准算例（Golden, CO）
    ("NREL 算例 2003-10-17", 39.742476, -105.1786, pd.DatetimeIndex(["2003-10-17 19:30:30"], tz="UTC")),
]


TERMS = [("冬至", 2026, 270.0), ("大寒", 2027, 300.0), ("春分", 2027, 0.0), ("夏至", 2027, 90.0), ("秋分", 2027, 180.0)]


def apparent_longitude(unix_s: float, delta_t: float = 69.0) -> float:
    """NREL SPA 的太阳视黄经（度）。"""
    from pvlib import spa
    import numpy as np

    jd = spa.julian_day(unix_s)
    jce = spa.julian_ephemeris_century(spa.julian_ephemeris_day(jd, delta_t))
    jme = spa.julian_ephemeris_millennium(jce)
    theta = spa.geocentric_longitude(spa.heliocentric_longitude(jme))
    x = [f(jce) for f in (spa.mean_elongation, spa.mean_anomaly_sun, spa.mean_anomaly_moon, spa.moon_argument_latitude, spa.moon_ascending_longitude)]
    out = np.empty((2,))
    spa.longitude_obliquity_nutation(jce, *x, out)
    return float(spa.apparent_sun_longitude(theta, out[0], spa.aberration_correction(spa.heliocentric_radius_vector(jme))) % 360)


def solar_term_unix(year: int, target: float) -> float:
    """二分法求视黄经到达 target 的时刻。"""
    import datetime as dt

    # 以春分（3 月 20 日）为 0°，按平均角速度估一个起点
    approx = dt.datetime(year, 3, 20, tzinfo=dt.timezone.utc).timestamp() + ((target % 360) / 360) * 365.2422 * 86400
    if approx > dt.datetime(year + 1, 1, 1, tzinfo=dt.timezone.utc).timestamp():
        approx -= 365.2422 * 86400
    lo, hi = approx - 5 * 86400, approx + 5 * 86400

    def diff(t: float) -> float:
        return (apparent_longitude(t) - target + 540) % 360 - 180

    for _ in range(60):
        mid = (lo + hi) / 2
        if diff(mid) < 0:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def main() -> None:
    terms = [{"name": n, "year": y, "longitude": lon, "utcMs": round(solar_term_unix(y, lon) * 1000)} for n, y, lon in TERMS]
    rows = []
    for label, lat, lon, times in CASES:
        sp = pvlib.solarposition.spa_python(times, lat, lon, altitude=0, pressure=101325, temperature=12)
        for t, r in sp.iterrows():
            rows.append(
                {
                    "label": label,
                    "utcMs": int(t.value // 1_000_000),
                    "lat": lat,
                    "lon": lon,
                    "azimuth": round(float(r["azimuth"]), 5),
                    "elevation": round(float(r["elevation"]), 5),
                    "apparentElevation": round(float(r["apparent_elevation"]), 5),
                    "eotMinutes": round(float(r["equation_of_time"]), 4),
                }
            )
    out = {"source": f"pvlib {pvlib.__version__} spa_python (NREL SPA)", "terms": terms, "rows": rows}
    Path(sys.argv[1]).write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
