/**
 * 随太阳高度变化的光照预设：白天、黄昏、夜晚之间连续过渡。
 * 太阳位置来自真实的日期与时刻，这里只决定天空、雾、环境光的颜色与强度，以及夜里亮灯的比例。
 */

import { Color } from 'three';

interface Stop {
  /** 太阳视高度角（度） */
  elevation: number;
  horizon: string;
  zenith: string;
  /** 环境光：天空色、地面色、强度 */
  skyLight: string;
  groundLight: string;
  ambient: number;
}

/** 由低到高排列 */
const STOPS: Stop[] = [
  {
    elevation: -12,
    horizon: '#1b2232',
    zenith: '#0a0f1c',
    skyLight: '#33415f',
    groundLight: '#12151d',
    ambient: 0.55,
  },
  {
    elevation: -4,
    horizon: '#4a4b5d',
    zenith: '#1b2540',
    skyLight: '#5a6585',
    groundLight: '#262630',
    ambient: 0.6,
  },
  {
    elevation: 1,
    horizon: '#e2bf9f',
    zenith: '#7f93b4',
    skyLight: '#c9cbd6',
    groundLight: '#8b8174',
    ambient: 0.7,
  },
  {
    elevation: 9,
    horizon: '#efe2cf',
    zenith: '#bccbdc',
    skyLight: '#f4f1ea',
    groundLight: '#c9c1b2',
    ambient: 0.8,
  },
  {
    elevation: 25,
    horizon: '#efede7',
    zenith: '#cbd8e4',
    skyLight: '#ffffff',
    groundLight: '#d9d3c7',
    ambient: 0.85,
  },
];

export interface LightPreset {
  horizon: Color;
  zenith: Color;
  skyLight: Color;
  groundLight: Color;
  ambient: number;
  /** 太阳直射光 */
  sunColor: Color;
  sunIntensity: number;
  /** 0 白天 → 1 夜晚 */
  night: number;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const SUN_LOW = new Color('#ffc58f');
const SUN_HIGH = new Color('#fff6ea');

export function lightPreset(elevation: number, out?: LightPreset): LightPreset {
  const p = out ?? {
    horizon: new Color(),
    zenith: new Color(),
    skyLight: new Color(),
    groundLight: new Color(),
    ambient: 0,
    sunColor: new Color(),
    sunIntensity: 0,
    night: 0,
  };
  let i = 0;
  while (i < STOPS.length - 2 && elevation > (STOPS[i + 1] as Stop).elevation) i++;
  const a = STOPS[i] as Stop;
  const b = STOPS[i + 1] as Stop;
  const t = Math.min(1, Math.max(0, (elevation - a.elevation) / (b.elevation - a.elevation)));
  p.horizon.set(a.horizon).lerp(new Color(b.horizon), t);
  p.zenith.set(a.zenith).lerp(new Color(b.zenith), t);
  p.skyLight.set(a.skyLight).lerp(new Color(b.skyLight), t);
  p.groundLight.set(a.groundLight).lerp(new Color(b.groundLight), t);
  p.ambient = a.ambient + (b.ambient - a.ambient) * t;
  p.sunColor.copy(SUN_LOW).lerp(SUN_HIGH, smooth(2, 30, elevation));
  p.sunIntensity = 3.4 * smooth(-0.5, 8, elevation);
  p.night = 1 - smooth(-6, 3, elevation);
  return p;
}

/**
 * 夜里亮着灯的窗户比例（按北京时间）：傍晚最多，后半夜最少，清晨又多起来。
 * 只是让夜景可信，不代表任何统计数据。
 */
export function litShare(minute: number): number {
  const h = (((minute / 60) % 24) + 24) % 24;
  const KEYS: [number, number][] = [
    [0, 0.28],
    [1, 0.16],
    [3, 0.06],
    [5, 0.08],
    [6.5, 0.22],
    [8, 0.18],
    [17, 0.3],
    [19, 0.62],
    [21.5, 0.6],
    [23, 0.42],
    [24, 0.28],
  ];
  for (let k = 0; k < KEYS.length - 1; k++) {
    const [h0, v0] = KEYS[k] as [number, number];
    const [h1, v1] = KEYS[k + 1] as [number, number];
    if (h >= h0 && h <= h1) return v0 + ((v1 - v0) * (h - h0)) / (h1 - h0);
  }
  return 0.3;
}

/** 建筑、地面材质共用的 uniform，由 Sun 每帧写入 */
export const sceneUniforms = {
  uNight: { value: 0 },
  uLitShare: { value: 0.3 },
  uSky: { value: new Color('#cbd8e4') },
};
