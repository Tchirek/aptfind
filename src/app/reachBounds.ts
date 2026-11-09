import { DataUtils } from 'three';

export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Field {
  grid: { x0: number; y0: number; cell: number; nx: number; ny: number };
  data: Uint16Array;
}

/**
 * 到达时间场里 limit 分钟以内的格子的外接框（米）。
 * channel：0 只步行，1 步行 + 地铁。取景按真正到得了的范围，不按算场时留了余量的网格。
 */
export function fieldBounds(
  { grid, data }: Field,
  channel: 0 | 1,
  limit: number,
  padding = 90,
): Bounds | null {
  let minI = Number.POSITIVE_INFINITY;
  let maxI = Number.NEGATIVE_INFINITY;
  let minJ = Number.POSITIVE_INFINITY;
  let maxJ = Number.NEGATIVE_INFINITY;
  for (let j = 0; j < grid.ny; j++) {
    for (let i = 0; i < grid.nx; i++) {
      if (DataUtils.fromHalfFloat(data[2 * (j * grid.nx + i) + channel] as number) > limit)
        continue;
      if (i < minI) minI = i;
      if (i > maxI) maxI = i;
      if (j < minJ) minJ = j;
      if (j > maxJ) maxJ = j;
    }
  }
  if (!Number.isFinite(minI)) return null;
  return {
    x0: grid.x0 + minI * grid.cell - padding,
    y0: grid.y0 + minJ * grid.cell - padding,
    x1: grid.x0 + (maxI + 1) * grid.cell + padding,
    y1: grid.y0 + (maxJ + 1) * grid.cell + padding,
  };
}
