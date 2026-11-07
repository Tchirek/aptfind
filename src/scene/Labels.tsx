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
 * - 按优先级逐个放置，与已放下的标注相交就跳过，所以拉远时只剩主干道和大地块，拉近逐渐变密。
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

  // 麦当劳、星巴克、海底捞：画品牌徽标
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
  return { points, roads: [...byName.values()] };
}

const FONT = '"PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei", system-ui, sans-serif';

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

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

  const last = useRef({ m: new Matrix4(), p: new Matrix4(), w: 0, night: -1 });
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

  useFrame(() => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    camera.updateMatrixWorld();
    const night = sceneUniforms.uNight.value > 0.5 ? 1 : 0;
    const L = last.current;
    if (
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
    const tooFar = (x: number, y: number, z: number) =>
      Math.hypot(x - cam.x, z - cam.y, -y - cam.z) > farLimit;
    const project = (x: number, y: number, z: number): [number, number] | null => {
      if (tooFar(x, y, z)) return null;
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

    const placed: Box[] = [];
    const free = (b: Box) => !placed.some((p) => overlaps(p, b));
    const ink = night ? '#e3eaf3' : '#3e5470';
    const inkStrong = night ? '#ffffff' : '#0f1e33';
    const halo = night ? 'rgba(14, 18, 28, 0.85)' : 'rgba(255, 255, 255, 0.92)';
    const roadInk = night ? '#bcc8d8' : '#66788f';

    type Item = { priority: number; d: number; draw: () => void };
    const items: Item[] = [];

    for (const p of labels.points) {
      if (dist > p.maxDistance * (compact ? 0.75 : 1)) continue;
      const d = Math.hypot(p.x - tx, p.y - ty);
      if (d > radius) continue;
      items.push({
        priority: p.priority,
        d,
        draw: () => {
          const s = project(p.x, p.y, p.z);
          if (!s) return;
          if (p.style === 'brand') {
            const img = p.logo ? logos.get(p.logo) : undefined;
            if (!img?.complete || !img.naturalWidth) return;
            const r = 11;
            const box = { x0: s[0] - r, y0: s[1] - r, x1: s[0] + r, y1: s[1] + r };
            if (!free(box)) return;
            placed.push(box);
            ctx.save();
            ctx.shadowColor = 'rgba(0, 0, 0, 0.28)';
            ctx.shadowBlur = 3;
            ctx.shadowOffsetY = 1;
            ctx.drawImage(img, box.x0, box.y0, 2 * r, 2 * r);
            ctx.restore();
            return;
          }
          const size = p.style === 'campus' ? 13 : p.style === 'station' ? 12 : 11;
          const weight = p.style === 'campus' || p.style === 'station' ? 600 : 500;
          const font = `${weight} ${size}px ${FONT}`;
          const w = measure(p.text, font);
          const pad = p.style === 'station' ? 5 : 2;
          const box = {
            x0: s[0] - w / 2 - pad,
            y0: s[1] - size / 2 - pad,
            x1: s[0] + w / 2 + pad,
            y1: s[1] + size / 2 + pad,
          };
          if (!free(box)) return;
          placed.push(box);
          ctx.font = font;
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
        },
      });
    }

    for (const r of labels.roads) {
      // 手机上不标支路，只留主干道
      if (compact && r.cls > 2) continue;
      if (dist > r.maxDistance) continue;
      const near = r.runs
        .map((run) => ({ run, d: Math.hypot(run.mx - tx, run.my - ty) }))
        .filter((x) => x.d < radius)
        .sort((a, b) => a.d - b.d);
      if (!near.length) continue;
      items.push({
        priority: r.priority,
        d: near[0]?.d ?? 0,
        draw: () => {
          const fontSize = r.cls <= 1 ? 12 : 11;
          const font = `${r.cls <= 2 ? 500 : 400} ${fontSize}px ${FONT}`;
          const w = measure(r.text, font);
          const mine: [number, number][] = [];
          for (const { run } of near) {
            if (mine.length >= 4) break;
            const a = project(run.ax, run.ay, run.az);
            const b = project(run.bx, run.by, run.bz);
            if (!a || !b) continue;
            const dx = b[0] - a[0];
            const dy = b[1] - a[1];
            const len = Math.hypot(dx, dy);
            if (len < w + 24) continue;
            const cx = (a[0] + b[0]) / 2;
            const cy = (a[1] + b[1]) / 2;
            if (cx < 0 || cy < 0 || cx > size.width || cy > size.height) continue;
            if (mine.some(([x, y]) => Math.hypot(x - cx, y - cy) < 320)) continue;
            let angle = Math.atan2(dy, dx);
            if (angle > Math.PI / 2) angle -= Math.PI;
            if (angle < -Math.PI / 2) angle += Math.PI;
            const hw = w / 2 + 3;
            const hh = fontSize / 2 + 2;
            const c = Math.abs(Math.cos(angle));
            const sn = Math.abs(Math.sin(angle));
            const ex = hw * c + hh * sn;
            const ey = hw * sn + hh * c;
            const box = { x0: cx - ex, y0: cy - ey, x1: cx + ex, y1: cy + ey };
            if (!free(box)) continue;
            placed.push(box);
            mine.push([cx, cy]);
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(angle);
            ctx.font = font;
            ctx.lineWidth = 3;
            ctx.strokeStyle = halo;
            ctx.strokeText(r.text, 0, 0);
            ctx.fillStyle = roadInk;
            ctx.fillText(r.text, 0, 0);
            ctx.restore();
          }
        },
      });
    }

    items.sort((a, b) => b.priority - a.priority || a.d - b.d);
    const limit = compact ? 16 : items.length;
    for (const it of items.slice(0, limit)) it.draw();
  });

  return null;
}
