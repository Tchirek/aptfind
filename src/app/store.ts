import { create } from 'zustand';
import type { WindowGrid } from '../engine/geometry';
import type { CivilDate } from '../engine/solar';
import type { BuildingSunlight } from './buildingSunlight';
import { nowBeijing } from './time';

export type Selection =
  | { kind: 'window'; index: number }
  | { kind: 'building'; index: number }
  | { kind: 'compound'; index: number }
  | null;

/** 选中的楼：选中一扇窗时即这扇窗所在的楼 */
export function selectedBuilding(s: Selection, grid: WindowGrid): number | null {
  if (s?.kind === 'building') return s.index;
  if (s?.kind === 'window') return grid.building[s.index] ?? null;
  return null;
}

/** 地图上的点标记：搜索到的设施、道路等没有对应楼的位置 */
export interface Marker {
  x: number;
  y: number;
  label: string;
}

/** 正在显示的步行路线（平面坐标折线） */
export interface Route {
  points: Float64Array;
  label: string;
}

/** 镜头飞行请求：看向 ENU 坐标 target，相机距离 distance（米） */
export interface FlyTo {
  target: [number, number, number];
  distance: number;
  nonce: number;
}

interface AppState {
  /** 场景日期（北京时间） */
  date: CivilDate;
  /** 北京时间，当日第几分钟，可带小数 */
  minute: number;
  /** 跟随现在：每过一会儿同步到当前时刻；拖动时间轴、换日期或播放时退出 */
  live: boolean;
  playing: boolean;
  selection: Selection;
  /** 在时间轴上悬停/点选的挡光建筑，用于在场景里高亮 */
  focusBuilding: number | null;
  flyTo: FlyTo | null;
  marker: Marker | null;
  route: Route | null;
  /** 选中楼在所选日期的逐窗日照（边算边更新） */
  sunlight: BuildingSunlight | null;
  setDate: (date: CivilDate) => void;
  setMinute: (minute: number) => void;
  /** 回到现在，并开始跟随 */
  goLive: () => void;
  /** 跟随现在时由定时器调用 */
  syncNow: () => void;
  setPlaying: (playing: boolean) => void;
  select: (s: Selection) => void;
  setFocusBuilding: (b: number | null) => void;
  requestFly: (target: [number, number, number], distance: number) => void;
  setMarker: (m: Marker | null) => void;
  setRoute: (r: Route | null) => void;
  setSunlight: (s: BuildingSunlight | null) => void;
}

export const useApp = create<AppState>((set, get) => ({
  ...nowBeijing(),
  live: true,
  playing: false,
  selection: null,
  focusBuilding: null,
  flyTo: null,
  marker: null,
  route: null,
  sunlight: null,
  setDate: (date) => set({ date, live: false }),
  setMinute: (minute) => set({ minute: ((minute % 1440) + 1440) % 1440, live: false }),
  goLive: () => set({ ...nowBeijing(), live: true, playing: false }),
  syncNow: () => {
    if (get().live) set(nowBeijing());
  },
  setPlaying: (playing) => set(playing ? { playing, live: false } : { playing }),
  select: (selection) => set({ selection, focusBuilding: null, route: null }),
  setFocusBuilding: (focusBuilding) => set({ focusBuilding }),
  requestFly: (target, distance) => set({ flyTo: { target, distance, nonce: Math.random() } }),
  setMarker: (marker) => set({ marker }),
  setRoute: (route) => set({ route }),
  setSunlight: (sunlight) => set({ sunlight }),
}));
