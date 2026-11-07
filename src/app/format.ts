import type { WindowGrid } from '../engine/geometry';
import { wallAzimuth } from '../engine/geometry';

/** 分钟数 → "1 小时 42 分" */
export function formatDuration(minutes: number): string {
  const m = Math.round(minutes);
  if (m <= 0) return '0 分钟';
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} 分钟`;
  return r === 0 ? `${h} 小时` : `${h} 小时 ${r} 分`;
}

/** 当日第几分钟 → "09:14" */
export function formatClock(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

const DIRS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'] as const;

/** 外墙朝向 → "南偏东 12°"；正对八方位 ±3° 内直接写方位 */
export function formatOrientation(azimuth: number): string {
  const a = ((azimuth % 360) + 360) % 360;
  const nearest = Math.round(a / 45) % 8;
  if (Math.abs(((a - nearest * 45 + 540) % 360) - 180) <= 3) return `朝${DIRS[nearest]}`;
  // 以最近的正方位为基准描述偏角
  const cardinal = Math.round(a / 90) % 4;
  const base = cardinal * 90;
  const off = ((a - base + 540) % 360) - 180;
  const names = ['北', '东', '南', '西'] as const;
  const side = (k: number) => names[((k % 4) + 4) % 4];
  return `${side(cardinal)}偏${off > 0 ? side(cardinal + 1) : side(cardinal - 1)} ${Math.round(Math.abs(off))}°`;
}

export function windowOrientation(grid: WindowGrid, i: number): string {
  return formatOrientation(wallAzimuth(grid, i));
}

/** "2015 年建成"；还没交付的写"预计 2027 年交付" */
export function builtLabel(year: number, now = new Date().getFullYear()): string {
  return year > now ? `预计 ${year} 年交付` : `${year} 年建成`;
}
