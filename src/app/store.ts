import { create } from 'zustand';
import {
  type CivilDate,
  type SolarTermName,
  solarTermUtc,
  utcToBeijingDate,
} from '../engine/solar';

export type ViewMode = 'hours' | 'shadow';

export type DayPreset = '大寒' | '冬至' | '春分' | '夏至';

/** 节气取离现在最近的一次（2026 年 11 月起算：冬至 2026，其余 2027） */
const PRESET_YEAR: Record<DayPreset, number> = { 冬至: 2026, 大寒: 2027, 春分: 2027, 夏至: 2027 };

export function presetDate(p: DayPreset): CivilDate {
  return utcToBeijingDate(solarTermUtc(PRESET_YEAR[p], p as SolarTermName));
}

export type Selection =
  | { kind: 'window'; index: number }
  | { kind: 'building'; index: number }
  | null;

/** 镜头飞行请求：看向 ENU 坐标 target，相机距离 distance（米） */
export interface FlyTo {
  target: [number, number, number];
  distance: number;
  nonce: number;
}

interface AppState {
  mode: ViewMode;
  day: DayPreset;
  /** 光影模式下的时刻：真太阳时，当日第几分钟 */
  tst: number;
  playing: boolean;
  selection: Selection;
  /** 在时间轴上悬停/点选的挡光建筑，用于在场景里高亮 */
  focusBuilding: number | null;
  flyTo: FlyTo | null;
  setMode: (mode: ViewMode) => void;
  setDay: (day: DayPreset) => void;
  setTst: (tst: number) => void;
  setPlaying: (playing: boolean) => void;
  select: (s: Selection) => void;
  setFocusBuilding: (b: number | null) => void;
  requestFly: (target: [number, number, number], distance: number) => void;
}

export const useApp = create<AppState>((set) => ({
  mode: 'hours',
  day: '大寒',
  tst: 10 * 60,
  playing: false,
  selection: null,
  focusBuilding: null,
  flyTo: null,
  setMode: (mode) => set({ mode }),
  setDay: (day) => set({ day }),
  setTst: (tst) => set({ tst }),
  setPlaying: (playing) => set({ playing }),
  select: (selection) => set({ selection, focusBuilding: null }),
  setFocusBuilding: (focusBuilding) => set({ focusBuilding }),
  requestFly: (target, distance) => set({ flyTo: { target, distance, nonce: Math.random() } }),
}));
