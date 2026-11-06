/**
 * 日照时数的分色：以大寒日 2 小时为界的发散色阶。
 * 不足 2 小时用冷色（越少越深），达标用暖色（越多越深）。
 * 两条色阶都过了色盲模拟与对比度校验（OKLCH 明度单调、相邻 ΔL ≥ 0.06、浅端对背景 ≥ 2:1）。
 */

export interface HourBin {
  /** 分钟，含下界、不含上界 */
  from: number;
  to: number;
  color: string;
}

export const HOUR_BINS: readonly HourBin[] = [
  { from: 0, to: 30, color: '#0d366b' },
  { from: 30, to: 60, color: '#1c5cab' },
  { from: 60, to: 90, color: '#3987e5' },
  { from: 90, to: 120, color: '#6da7ec' },
  { from: 120, to: 180, color: '#e3925a' },
  { from: 180, to: 240, color: '#d06f32' },
  { from: 240, to: 360, color: '#ad5119' },
  { from: 360, to: Number.POSITIVE_INFINITY, color: '#7a360c' },
];

export const THRESHOLD_MINUTES = 120;

export function binOf(minutes: number): number {
  for (let i = 0; i < HOUR_BINS.length; i++) if (minutes < (HOUR_BINS[i] as HourBin).to) return i;
  return HOUR_BINS.length - 1;
}

/** 每个分档的 sRGB 字节，供顶点颜色使用 */
export const BIN_RGB: Uint8Array = Uint8Array.from(
  HOUR_BINS.flatMap((b) => [1, 3, 5].map((k) => Number.parseInt(b.color.slice(k, k + 2), 16))),
);

/** 时间轴上的状态色 */
export const SPAN_COLOR = {
  lit: '#d06f32',
  blocked: '#5c5a55',
  away: '#d9d5cc',
} as const;
