import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Matrix4, Vector3 } from 'three';
import { stationOfPoi } from '../app/data';
import { BRAND_CATEGORIES, type District, terrainAt } from '../engine/district';
import { isCampus } from './groundTexture';
import { sceneUniforms } from './lighting';

/**
 * 地图标注层：一张叠在 WebGL 画布上的 2D 画布，每当镜头动了才重画。
 *
 * - 地名（校园、小区、子片区、有名字的楼、地铁站）水平居中写在锚点上；
 * - 路名沿道路走向旋转，取道路上较直的一段，屏幕上放得下才写，同一条路相隔足够远才再写一次；
 * - 按优先级逐个放置，与已放下的标注相交就跳过，所以拉远时只剩主干道和大地块，拉近逐渐变密；
 * - 放置带记忆：已显示的标注排在同优先级前面，碰撞与距离阈值都比新标注宽松；新标注要连续放得下
 *   一小段时间才显示，显隐再淡入淡出。否则镜头每动一点，互相压着的标注就轮流胜出，满屏闪烁。
 */

interface PointLabel {
  key: string;
  text: string;
  x: number;
  y: number;
  z: number;
  /** 镜头离目标点小于它才显示 */
  maxDistance: number;
  priority: number;
  style: 'campus' | 'place' | 'building' | 'station' | 'brand';
  /** 品牌徽标（public/brands/ 下的文件名） */
  logo?: string;
}

/** 道路上较直的一段 */
interface Run {
  /** 路名 + 段号，用来记住这一段上的标注 */
  key: string;
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  mx: number;
  my: number;
}

interface RoadLabel {
  key: string;
  text: string;
  cls: number;
  runs: Run[];
  maxDistance: number;
  priority: number;
}

const ROAD_RANGE = [26000, 26000, 4200, 3000, 1500, 700];
const ROAD_PRIORITY = [80, 78, 62, 58, 40, 20];

function ringCenter(r: Float64Array): [number, number] {
  let x = 0;
  let y = 0;
  for (let i = 0; i < r.length; i += 2) {
    x += r[i] as number;
    y += r[i + 1] as number;
  }
  return [(2 * x) / r.length, (2 * y) / r.length];
}

/** 把折线切成方向变化不超过约 20° 的直段（至少 35 m，至多 360 m） */
function runsOf(d: District, pts: Float64Array): Run[] {
  const runs: Run[] = [];
  const n = pts.length / 2;
  let i0 = 0;
  while (i0 < n - 1) {
    const x0 = pts[2 * i0] as number;
    const y0 = pts[2 * i0 + 1] as number;
    let hx = (pts[2 * i0 + 2] as number) - x0;
    let hy = (pts[2 * i0 + 3] as number) - y0;
    const hl = Math.hypot(hx, hy) || 1;
    hx /= hl;
    hy /= hl;
    let i1 = i0 + 1;
    let len = hl;
    while (i1 < n - 1 && len < 360) {
      const dx = (pts[2 * i1 + 2] as number) - (pts[2 * i1] as number);
      const dy = (pts[2 * i1 + 3] as number) - (pts[2 * i1 + 1] as number);
      const l = Math.hypot(dx, dy) || 1;
      if ((dx * hx + dy * hy) / l < 0.94) break;
      len += l;
      i1++;
    }
    if (len >= 35) {
      const ax = x0;
      const ay = y0;
      const bx = pts[2 * i1] as number;
      const by = pts[2 * i1 + 1] as number;
      runs.push({
        key: '',
        ax,
        ay,
        az: terrainAt(d.terrain, ax, ay) + 1,
        bx,
        by,
        bz: terrainAt(d.terrain, bx, by) + 1,
        mx: (ax + bx) / 2,
        my: (ay + by) / 2,
      });
    }
    i0 = i1;
  }
  return runs;
}

function buildLabels(d: District): { points: PointLabel[]; roads: RoadLabel[] } {
  const points: PointLabel[] = [];
  d.compounds.forEach((c, k) => {
    const largest = [...c.rings].sort((a, b) => b.length - a.length)[0];
    if (!largest) return;
    const [x, y] = ringCenter(largest);
    const campus = isCampus(c.name) && c.parent < 0;
    points.push({
      key: `c${k}`,
      text: c.name,
      x,
      y,
      z: terrainAt(d.terrain, x, y) + 4,
      maxDistance: campus ? 9000 : c.parent >= 0 ? 900 : c.kind === 'other' ? 520 : 1600,
      priority: campus ? 100 : c.parent >= 0 ? 50 : c.kind === 'other' ? 34 : 70,
      style: campus ? 'campus' : 'place',
    });
  });
  // 同名的楼（一组楼共用一个名字）只标面积最大的那栋
  const seen = new Map<string, { area: number; label: PointLabel }>();
  for (const b of d.buildings) {
    if (!b.label) continue;
    const outer = b.rings[0] as Float64Array;
    const [x, y] = ringCenter(outer);
    let area = 0;
    for (let i = 0; i < outer.length; i += 2) {
      const j = (i + 2) % outer.length;
      area +=
        (outer[i] as number) * (outer[j + 1] as number) -
        (outer[j] as number) * (outer[i + 1] as number);
    }
    area = Math.abs(area) / 2;
    const key = `${b.compound}:${b.label}`;
    const prev = seen.get(key);
    if (prev && prev.area >= area) continue;
    seen.set(key, {
      area,
      label: {
        key: `b${b.index}`,
        text: b.label,
        x,
        y,
        z: b.base + b.height + 3,
        maxDistance: 480,
        priority: 30,
        style: 'building',
      },
    });
  }
  for (const { label } of seen.values()) points.push(label);
  // 地铁站：高德的"某某(地铁站)"是站本身，出入口不单独标
  for (const p of d.pois) {
    if (p.category !== 'metro' || !/\(地铁站\)|（地铁站）/.test(p.name)) continue;
    const name = stationOfPoi(p.name);
    if (!name) continue;
    points.push({
      key: `m${name}`,
      text: `${name}站`,
      x: p.x,
      y: p.y,
      z: terrainAt(d.terrain, p.x, p.y) + 6,
      maxDistance: 3200,
      priority: 90,
      style: 'station',
    });
  }

  // 麦当劳、肯德基、星巴克、盒马：画品牌徽标
  for (const p of d.pois) {
    if (!(BRAND_CATEGORIES as readonly string[]).includes(p.category)) continue;
    points.push({
      key: `p${p.category}${p.x.toFixed(0)},${p.y.toFixed(0)}`,
      text: p.name,
      x: p.x,
      y: p.y,
      z: terrainAt(d.terrain, p.x, p.y) + 8,
      maxDistance: 3600,
      priority: 88,
      style: 'brand',
      logo: p.category,
    });
  }

  const byName = new Map<string, RoadLabel>();
  for (const r of d.roads) {
    if (!r.name) continue;
    const runs = runsOf(d, r.points);
    if (!runs.length) continue;
    const prev = byName.get(r.name);
    if (prev) {
      prev.runs.push(...runs);
      if (r.cls < prev.cls) {
        prev.cls = r.cls;
        prev.maxDistance = ROAD_RANGE[r.cls] ?? 700;
        prev.priority = ROAD_PRIORITY[r.cls] ?? 20;
      }
    } else {
      byName.set(r.name, {
        key: `r${r.name}`,
        text: r.name,
        cls: r.cls,
        runs,
        maxDistance: ROAD_RANGE[r.cls] ?? 700,
        priority: ROAD_PRIORITY[r.cls] ?? 20,
      });
    }
  }
  const roads = [...byName.values()];
  for (const r of roads) {
    r.runs.forEach((run, i) => {
      run.key = `${r.key}#${i}`;
    });
  }
  return { points, roads };
}

const FONT = '"PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei", system-ui, sans-serif';

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

/** 品牌徽标的半径（像素） */
const LOGO_R = 11;
/** 已显示的标注，距离类阈值放宽的倍数：要大于一格滚轮的缩放（约 6%） */
const HOLD_SLACK = 1.12;
/** 已显示的标注碰撞框向内收、新标注向外放（像素），两者之差是显隐翻转的缓冲 */
const HOLD_INSET = 4;
const JOIN_OUTSET = 6;
/** 淡入淡出的时长（秒）：只跳一两帧的显隐变化几乎看不出来 */
const FADE_SECONDS = 0.16;
/** 新标注要连续放得下这么久（秒）才显示：镜头转动时一闪而过的空隙不算 */
const ADMIT_SECONDS = 0.2;

interface PointMark {
  kind: 'point';
  label: PointLabel;
}

interface RoadMark {
  kind: 'road';
  label: RoadLabel;
  run: Run;
  angle: number;
}

type Mark = PointMark | RoadMark;

/** 画着的标注：淡出时还要接着画，所以记着画什么 */
interface Shown {
  /** 上一次放置时放下了 */
  on: boolean;
  alpha: number;
  /** 最近一次放下时的重画序号 */
  stamp: number;
  /** 开始连续放得下的时刻（秒） */
  since: number;
  mark: Mark;
}

export function Labels({ district }: { district: District }) {
  const { camera, gl, size, controls } = useThree();
  const compact = size.width < 640;
  const labels = useMemo(() => buildLabels(district), [district]);
  const canvas = useMemo(() => {
    const c = document.createElement('canvas');
    Object.assign(c.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '5',
    });
    return c;
  }, []);

  useEffect(() => {
    const parent = gl.domElement.parentElement;
    parent?.appendChild(canvas);
    return () => canvas.remove();
  }, [gl, canvas]);

  useEffect(() => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
  }, [canvas, size]);

  const last = useRef({
    m: new Matrix4(),
    p: new Matrix4(),
    w: 0,
    night: -1,
    fading: false,
    stamp: 0,
    clock: 0,
  });
  const states = useRef(new Map<string, Shown>());
  // 品牌徽标图片：加载好后让标注层重画一次
  const logos = useMemo(() => {
    const map = new Map<string, HTMLImageElement>();
    for (const b of BRAND_CATEGORIES) {
      const img = new Image();
      img.onload = () => {
        last.current.w = -1;
      };
      img.src = `${import.meta.env.BASE_URL}brands/${b}.svg`;
      map.set(b, img);
    }
    return map;
  }, []);
  const widths = useRef(new Map<string, number>());
  const v = useMemo(() => new Vector3(), []);

  useFrame((_, delta) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    camera.updateMatrixWorld();
    const night = sceneUniforms.uNight.value > 0.5 ? 1 : 0;
    const L = last.current;
    if (
      !L.fading &&
      L.m.equals(camera.matrixWorld) &&
      L.p.equals(camera.projectionMatrix) &&
      L.w === canvas.width &&
      L.night === night
    ) {
      return;
    }
    L.m.copy(camera.matrixWorld);
    L.p.copy(camera.projectionMatrix);
    L.w = canvas.width;
    L.night = night;
    L.stamp++;
    const dt = Math.min(delta, 0.05);
    L.clock += dt;

    const dpr = canvas.width / Math.max(1, size.width);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';

    const target = (controls as unknown as { target?: Vector3 } | null)?.target;
    const dist = target ? camera.position.distanceTo(target) : 2000;
    // 世界坐标 (x, y, z) = ENU (x, z, −y)
    const tx = target?.x ?? 0;
    const ty = -(target?.z ?? 0);
    const radius = Math.max(300, dist * 1.4);

    // 离镜头太远的（地平线附近）不标：透视把它们挤在一起，只会糊成一片
    const farLimit = dist * 2.1;
    const cam = camera.position;
    const project = (x: number, y: number, z: number, slack = 1): [number, number] | null => {
      if (Math.hypot(x - cam.x, z - cam.y, -y - cam.z) > farLimit * slack) return null;
      v.set(x, z, -y).project(camera);
      if (v.z > 1 || v.z < -1) return null;
      return [((v.x + 1) / 2) * size.width, ((1 - v.y) / 2) * size.height];
    };
    const measure = (text: string, font: string) => {
      const k = `${font}|${text}`;
      let w = widths.current.get(k);
      if (w === undefined) {
        ctx.font = font;
        w = ctx.measureText(text).width;
        widths.current.set(k, w);
      }
      return w;
    };

    const state = states.current;
    const wasOn = (key: string) => state.get(key)?.on === true;
    const show = (key: string, mark: Mark) => {
      const s = state.get(key);
      if (s) {
        s.stamp = L.stamp;
        s.mark = mark;
      } else {
        state.set(key, { on: false, alpha: 0, stamp: L.stamp, since: L.clock, mark });
      }
    };

    const placed: Box[] = [];
    const free = (b: Box, on: boolean) => {
      const m = on ? -HOLD_INSET : JOIN_OUTSET;
      const grown = { x0: b.x0 - m, y0: b.y0 - m, x1: b.x1 + m, y1: b.y1 + m };
      return !placed.some((p) => overlaps(p, grown));
    };
    const ink = night ? '#e3eaf3' : '#3e5470';
    const inkStrong = night ? '#ffffff' : '#0f1e33';
    const halo = night ? 'rgba(14, 18, 28, 0.85)' : 'rgba(255, 255, 255, 0.92)';
    const roadInk = night ? '#bcc8d8' : '#66788f';

    const logoOf = (p: PointLabel) => {
      const img = p.logo ? logos.get(p.logo) : undefined;
      return img?.complete && img.naturalWidth ? img : null;
    };
    const pointFont = (p: PointLabel) => {
      const px = p.style === 'campus' ? 13 : p.style === 'station' ? 12 : 11;
      const weight = p.style === 'campus' || p.style === 'station' ? 600 : 500;
      return { px, font: `${weight} ${px}px ${FONT}` };
    };
    const pointBox = (p: PointLabel, s: [number, number]): Box => {
      if (p.style === 'brand') {
        return { x0: s[0] - LOGO_R, y0: s[1] - LOGO_R, x1: s[0] + LOGO_R, y1: s[1] + LOGO_R };
      }
      const { px, font } = pointFont(p);
      const w = measure(p.text, font);
      const pad = p.style === 'station' ? 5 : 2;
      return {
        x0: s[0] - w / 2 - pad,
        y0: s[1] - px / 2 - pad,
        x1: s[0] + w / 2 + pad,
        y1: s[1] + px / 2 + pad,
      };
    };
    const paintPoint = (p: PointLabel) => {
      const s = project(p.x, p.y, p.z, Number.POSITIVE_INFINITY);
      if (!s) return;
      const box = pointBox(p, s);
      if (p.style === 'brand') {
        const img = logoOf(p);
        if (!img) return;
        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.28)';
        ctx.shadowBlur = 3;
        ctx.shadowOffsetY = 1;
        ctx.drawImage(img, box.x0, box.y0, 2 * LOGO_R, 2 * LOGO_R);
        ctx.restore();
        return;
      }
      ctx.font = pointFont(p).font;
      if (p.style === 'station') {
        ctx.fillStyle = night ? 'rgba(255,255,255,0.92)' : 'rgba(15,30,51,0.86)';
        ctx.beginPath();
        ctx.roundRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0, 3);
        ctx.fill();
        ctx.fillStyle = night ? '#0f1e33' : '#ffffff';
        ctx.fillText(p.text, s[0], s[1] + 0.5);
        return;
      }
      ctx.lineWidth = 3;
      ctx.strokeStyle = halo;
      ctx.strokeText(p.text, s[0], s[1]);
      ctx.fillStyle = p.style === 'campus' ? inkStrong : ink;
      ctx.fillText(p.text, s[0], s[1]);
    };

    const roadFont = (r: RoadLabel) => {
      const px = r.cls <= 1 ? 12 : 11;
      return { px, font: `${r.cls <= 2 ? 500 : 400} ${px}px ${FONT}` };
    };
    const runPose = (run: Run, prev: number | undefined, slack: number) => {
      const a = project(run.ax, run.ay, run.az, slack);
      const b = project(run.bx, run.by, run.bz, slack);
      if (!a || !b) return null;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      let angle = Math.atan2(dy, dx);
      if (angle > Math.PI / 2) angle -= Math.PI;
      if (angle < -Math.PI / 2) angle += Math.PI;
      // 路接近竖直时角度会在 ±90° 间跳：已显示的沿用原朝向，转过头一些才翻面
      if (prev !== undefined) {
        const alt = angle > 0 ? angle - Math.PI : angle + Math.PI;
        if (Math.abs(alt - prev) < Math.abs(angle - prev) && Math.abs(alt) < Math.PI / 2 + 0.3) {
          angle = alt;
        }
      }
      return { cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, len: Math.hypot(dx, dy), angle };
    };
    const paintRoad = (mark: RoadMark) => {
      const pose = runPose(mark.run, mark.angle, Number.POSITIVE_INFINITY);
      if (!pose) return;
      mark.angle = pose.angle;
      ctx.save();
      ctx.translate(pose.cx, pose.cy);
      ctx.rotate(pose.angle);
      ctx.font = roadFont(mark.label).font;
      ctx.lineWidth = 3;
      ctx.strokeStyle = halo;
      ctx.strokeText(mark.label.text, 0, 0);
      ctx.fillStyle = roadInk;
      ctx.fillText(mark.label.text, 0, 0);
      ctx.restore();
    };

    type Item = { priority: number; sticky: number; d: number; place: () => void };
    const items: Item[] = [];

    for (const p of labels.points) {
      const on = wasOn(p.key);
      const slack = on ? HOLD_SLACK : 1;
      if (dist > p.maxDistance * (compact ? 0.75 : 1) * slack) continue;
      const d = Math.hypot(p.x - tx, p.y - ty);
      if (d > radius * slack) continue;
      items.push({
        priority: p.priority,
        sticky: on ? 1 : 0,
        d,
        place: () => {
          if (p.style === 'brand' && !logoOf(p)) return;
          const s = project(p.x, p.y, p.z, slack);
          if (!s) return;
          // 屏幕外的不占位也不画；已显示的可以探出去一点
          const edge = on ? -40 : 0;
          if (s[0] < edge || s[1] < edge || s[0] > size.width - edge || s[1] > size.height - edge) {
            return;
          }
          const box = pointBox(p, s);
          if (!free(box, on)) return;
          placed.push(box);
          show(p.key, { kind: 'point', label: p });
        },
      });
    }

    for (const r of labels.roads) {
      // 手机上不标支路，只留主干道
      if (compact && r.cls > 2) continue;
      const near = r.runs
        .map((run) => {
          const on = wasOn(run.key);
          return { run, on, d: Math.hypot(run.mx - tx, run.my - ty) };
        })
        .filter((x) => x.d < radius * (x.on ? HOLD_SLACK : 1))
        .sort((a, b) => Number(b.on) - Number(a.on) || a.d - b.d);
      const first = near[0];
      if (!first) continue;
      if (dist > r.maxDistance * (first.on ? HOLD_SLACK : 1)) continue;
      items.push({
        priority: r.priority,
        sticky: first.on ? 1 : 0,
        d: first.d,
        place: () => {
          const { px, font } = roadFont(r);
          const w = measure(r.text, font);
          const mine: [number, number][] = [];
          for (const { run, on } of near) {
            if (mine.length >= 4) break;
            const prev = state.get(run.key)?.mark;
            const pose = runPose(
              run,
              prev?.kind === 'road' ? prev.angle : undefined,
              on ? HOLD_SLACK : 1,
            );
            if (!pose) continue;
            const { cx, cy, angle, len } = pose;
            if (len < w + (on ? 12 : 30)) continue;
            // 已显示的可以探出屏幕一点，新标注要完全在屏内
            const edge = on ? -30 : 10;
            if (cx < edge || cy < edge || cx > size.width - edge || cy > size.height - edge) {
              continue;
            }
            const spacing = on ? 280 : 340;
            if (mine.some(([x, y]) => Math.hypot(x - cx, y - cy) < spacing)) continue;
            const hw = w / 2 + 3;
            const hh = px / 2 + 2;
            const c = Math.abs(Math.cos(angle));
            const sn = Math.abs(Math.sin(angle));
            const ex = hw * c + hh * sn;
            const ey = hw * sn + hh * c;
            const box = { x0: cx - ex, y0: cy - ey, x1: cx + ex, y1: cy + ey };
            if (!free(box, on)) continue;
            placed.push(box);
            mine.push([cx, cy]);
            show(run.key, { kind: 'road', label: r, run, angle });
          }
        },
      });
    }

    items.sort((a, b) => b.priority - a.priority || b.sticky - a.sticky || a.d - b.d);
    const limit = compact ? 16 : items.length;
    for (const it of items.slice(0, limit)) it.place();

    // 还在等准入的先占着位置不画；这一拍没放下的接着淡出，淡完才从记录里删掉
    const step = dt / FADE_SECONDS;
    let fading = false;
    for (const [key, s] of state) {
      const fits = s.stamp === L.stamp;
      if (fits && s.alpha === 0 && L.clock - s.since < ADMIT_SECONDS) {
        fading = true;
        continue;
      }
      s.on = fits;
      s.alpha = fits ? Math.min(1, s.alpha + step) : Math.max(0, s.alpha - step);
      if (!fits && s.alpha === 0) {
        state.delete(key);
        continue;
      }
      if (s.alpha < 1) fading = true;
      ctx.globalAlpha = s.alpha;
      if (s.mark.kind === 'point') paintPoint(s.mark.label);
      else paintRoad(s.mark);
    }
    ctx.globalAlpha = 1;
    L.fading = fading;
  });

  return null;
}
