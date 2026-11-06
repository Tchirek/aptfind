"""地形：从 Copernicus GLO-30 地表模型（DSM）里去掉建筑与树冠，得到地面高程（DTM）。

Copernicus DEM 是雷达测得的地表高程，城区里包含楼房和树。做法：
1. 把建筑轮廓栅格化到 DSM 网格上（5×5 超采样），得到每个像元的建筑覆盖率；
2. 只保留覆盖率低、且不贴着楼的像元作为地面候选；
3. 候选值若比周围 150 m 内的最低候选高出太多（多半是树冠），剔除；
4. 用剩下的地面点做线性插值，再做一次高斯平滑，最后保证地面不高于 DSM。

数据：Copernicus DEM GLO-30，© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH
2014-2018 provided under COPERNICUS by the European Union and ESA。
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import rasterio
from rasterio.features import rasterize
from rasterio.transform import Affine
from rasterio.windows import from_bounds
from scipy import ndimage
from scipy.interpolate import griddata

DEM_URL = (
    "/vsicurl/https://copernicus-dem-30m.s3.amazonaws.com/"
    "Copernicus_DSM_COG_10_N30_00_E104_00_DEM/Copernicus_DSM_COG_10_N30_00_E104_00_DEM.tif"
)
ATTRIBUTION = "地形：Copernicus DEM GLO-30（© DLR e.V. / © Airbus DS，经去建筑处理）"

SUPERSAMPLE = 5
MAX_COVERAGE = 0.08
TREE_TOLERANCE = 6.0  # m，地面候选比周边最低点高出更多则视为树冠或构筑物


@dataclass
class TerrainGrid:
    """局部平面坐标下的规则网格：z[j, i] 是 (x0 + i·step, y0 + j·step) 处的地面高程（相对 base）"""

    x0: float
    y0: float
    step: float
    z: np.ndarray
    base: float

    def sample(self, x: np.ndarray, y: np.ndarray) -> np.ndarray:
        """双线性插值，越界取边缘值"""
        fx = np.clip((x - self.x0) / self.step, 0, self.z.shape[1] - 1.000001)
        fy = np.clip((y - self.y0) / self.step, 0, self.z.shape[0] - 1.000001)
        i = np.floor(fx).astype(int)
        j = np.floor(fy).astype(int)
        tx = fx - i
        ty = fy - j
        z = self.z
        return (
            z[j, i] * (1 - tx) * (1 - ty)
            + z[j, i + 1] * tx * (1 - ty)
            + z[j + 1, i] * (1 - tx) * ty
            + z[j + 1, i + 1] * tx * ty
        )


def read_dsm(west: float, south: float, east: float, north: float) -> tuple[np.ndarray, Affine]:
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"):
        with rasterio.open(DEM_URL) as src:
            win = from_bounds(west, south, east, north, src.transform).round_offsets().round_lengths()
            dsm = src.read(1, window=win).astype(np.float64)
            transform = src.window_transform(win)
    return dsm, transform


def building_coverage(polys_wgs84, shape: tuple[int, int], transform: Affine) -> np.ndarray:
    fine = transform * Affine.scale(1 / SUPERSAMPLE)
    hi = rasterize(
        ((p, 1) for p in polys_wgs84),
        out_shape=(shape[0] * SUPERSAMPLE, shape[1] * SUPERSAMPLE),
        transform=fine,
        fill=0,
        dtype="uint8",
    )
    return hi.reshape(shape[0], SUPERSAMPLE, shape[1], SUPERSAMPLE).mean(axis=(1, 3))


def dsm_to_dtm(dsm: np.ndarray, coverage: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """返回 (DTM, 地面候选掩膜)"""
    near_building = ndimage.maximum_filter(coverage, size=3) > 0.5
    candidate = (coverage < MAX_COVERAGE) & ~near_building
    # 树冠：比 5×5 邻域（约 150 m）内候选最低值高出太多
    masked = np.where(candidate, dsm, np.inf)
    local_min = ndimage.minimum_filter(masked, size=5)
    candidate &= dsm <= local_min + TREE_TOLERANCE

    jj, ii = np.nonzero(candidate)
    pts = np.column_stack([ii, jj]).astype(float)
    vals = dsm[jj, ii]
    gj, gi = np.mgrid[0 : dsm.shape[0], 0 : dsm.shape[1]]
    dtm = griddata(pts, vals, (gi, gj), method="linear")
    holes = np.isnan(dtm)
    if holes.any():
        dtm[holes] = griddata(pts, vals, (gi[holes], gj[holes]), method="nearest")
    dtm = ndimage.gaussian_filter(dtm, sigma=1.0)
    return np.minimum(dtm, dsm), candidate


def build_terrain(bounds_wgs84, polys_wgs84, to_local, step: float = 20.0, margin_deg: float = 0.004):
    """bounds_wgs84 = (west, south, east, north)。返回 TerrainGrid（局部坐标）与诊断信息。"""
    west, south, east, north = bounds_wgs84
    dsm, transform = read_dsm(west - margin_deg, south - margin_deg, east + margin_deg, north + margin_deg)
    cov = building_coverage(polys_wgs84, dsm.shape, transform)
    dtm, candidate = dsm_to_dtm(dsm, cov)

    # DTM 像元中心 → 局部坐标，再插值到局部规则网格
    rows, cols = np.mgrid[0 : dsm.shape[0], 0 : dsm.shape[1]]
    lon, lat = rasterio.transform.xy(transform, rows.ravel(), cols.ravel())
    lx, ly = to_local(np.asarray(lon), np.asarray(lat))
    (x_min, y_min) = to_local(np.array([west]), np.array([south]))
    (x_max, y_max) = to_local(np.array([east]), np.array([north]))
    x0 = float(np.floor(x_min[0] / step) * step)
    y0 = float(np.floor(y_min[0] / step) * step)
    nx = int(np.ceil((x_max[0] - x0) / step)) + 1
    ny = int(np.ceil((y_max[0] - y0) / step)) + 1
    gy, gx = np.mgrid[0:ny, 0:nx]
    z = griddata(np.column_stack([lx, ly]), dtm.ravel(), (x0 + gx * step, y0 + gy * step), method="linear")
    base = float(np.floor(np.nanmin(z)))
    grid = TerrainGrid(x0=x0, y0=y0, step=step, z=z - base, base=base)

    building_px = cov > 0.5
    diag = {
        "dsm_range": (float(dsm.min()), float(dsm.max())),
        "dtm_range": (float(np.nanmin(z)), float(np.nanmax(z))),
        "ground_candidates": int(candidate.sum()),
        "pixels": int(dsm.size),
        "dsm_minus_dtm_on_buildings_median": float(np.median((dsm - dtm)[building_px])) if building_px.any() else 0.0,
        "grid": (nx, ny, step),
    }
    return grid, diag
