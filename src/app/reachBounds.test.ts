import { DataUtils } from 'three';
import { describe, expect, it } from 'vitest';
import { fieldBounds } from './reachBounds';

function field(walk: number[], combined: number[], nx: number, ny: number) {
  const data = new Uint16Array(nx * ny * 2);
  for (let k = 0; k < nx * ny; k++) {
    data[2 * k] = DataUtils.toHalfFloat(walk[k] as number);
    data[2 * k + 1] = DataUtils.toHalfFloat(combined[k] as number);
  }
  return { grid: { x0: 100, y0: 200, cell: 10, nx, ny }, data };
}

describe('fieldBounds', () => {
  const f = field([60, 60, 60, 60, 5, 60, 60, 60, 60], [60, 20, 60, 60, 5, 20, 60, 60, 60], 3, 3);

  it('只框住限时以内的格子', () => {
    expect(fieldBounds(f, 0, 15, 0)).toEqual({ x0: 110, y0: 210, x1: 120, y1: 220 });
  });

  it('按通道分别算：步行加地铁的范围更大', () => {
    expect(fieldBounds(f, 1, 30, 0)).toEqual({ x0: 110, y0: 200, x1: 130, y1: 220 });
  });

  it('留出边距；一个格子都到不了时返回 null', () => {
    expect(fieldBounds(f, 0, 15, 50)).toEqual({ x0: 60, y0: 160, x1: 170, y1: 270 });
    expect(fieldBounds(f, 0, 1)).toBeNull();
  });
});
