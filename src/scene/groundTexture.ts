/**
 * 地面贴图：把道路、水系、小区与校园范围画到一张画布上，再贴到地形网格上。
 * 贴图天然随地形起伏，不会出现条带穿进坡面或悬空。
 */

import {
  CanvasTexture,
  ClampToEdgeWrapping,
  LinearMipmapLinearFilter,
  SRGBColorSpace,
} from 'three';
import type { District } from '../engine/district';
import type { Region } from '../engine/region';

export const GROUND = '#eef1f5';
const ROAD_MAJOR = '#cfd7e2';
const ROAD_MINOR = '#dce3ec';
const WATER = '#bfccd3';
const RESIDENTIAL_FILL = 'rgba(186, 200, 220, 0.22)';
const SCHOOL_FILL = 'rgba(201, 211, 190, 0.32)';
const BOUNDARY = 'rgba(90, 108, 135, 0.38)';
const CAMPUS_BOUNDARY = 'rgba(70, 92, 66, 0.6)';

/** 各级道路的路面宽度（米） */
const ROAD_WIDTH = [26, 20, 14, 9, 6, 3.5] as const;

export interface GroundExtent {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function terrainExtent(d: District): GroundExtent {
  const t = d.terrain;
  return {
    minX: t.x0,
    minY: t.y0,
    maxX: t.x0 + (t.nx - 1) * t.step,
    maxY: t.y0 + (t.ny - 1) * t.step,
  };
}

/** 识别川师狮子山校区：边界加粗 */
export const isCampus = (name: string) => name.includes('师范大学') && name.includes('狮子山');

export interface GroundTextures {
  map: CanvasTexture;
  /** 只有道路的贴图，夜里作为自发光，像路灯 */
  glow: CanvasTexture;
}

function toTexture(canvas: HTMLCanvasElement, srgb: boolean): CanvasTexture {
  const tex = new CanvasTexture(canvas);
  if (srgb) tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

export function buildGroundTexture(d: District, size = 4096): GroundTextures {
  const ext = terrainExtent(d);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 2D 画布');
  const sx = size / (ext.maxX - ext.minX);
  const sy = size / (ext.maxY - ext.minY);
  // 画布 y 向下，北在上
  const px = (x: number) => (x - ext.minX) * sx;
  const py = (y: number) => (ext.maxY - y) * sy;
  const path = (pts: Float64Array, close: boolean) => {
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 2) {
      const x = px(pts[i] as number);
      const y = py(pts[i + 1] as number);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    if (close) ctx.closePath();
  };

  ctx.fillStyle = GROUND;
  ctx.fillRect(0, 0, size, size);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // 小区与校园底色
  for (const c of d.compounds) {
    if (c.parent >= 0) continue;
    ctx.fillStyle = c.kind === 'school' ? SCHOOL_FILL : RESIDENTIAL_FILL;
    for (const r of c.rings) {
      path(r, true);
      ctx.fill();
    }
  }

  // 水系
  ctx.fillStyle = WATER;
  ctx.strokeStyle = WATER;
  for (const w of d.water) {
    if (w.ring) {
      path(w.ring, true);
      ctx.fill();
    } else if (w.line) {
      ctx.lineWidth = Math.max(1, w.width * sx);
      path(w.line, false);
      ctx.stroke();
    }
  }

  // 道路：先画次要的，再画主要的
  for (const minor of [true, false]) {
    ctx.strokeStyle = minor ? ROAD_MINOR : ROAD_MAJOR;
    for (const r of d.roads) {
      if (r.cls >= 4 !== minor) continue;
      ctx.lineWidth = (ROAD_WIDTH[r.cls] ?? 4) * sx;
      path(r.points, false);
      ctx.stroke();
    }
  }

  // 小区边界：OSM 的用实线，推算的用虚线；校园加粗
  for (const c of d.compounds) {
    const campus = isCampus(c.name) && c.parent < 0;
    ctx.strokeStyle = campus ? CAMPUS_BOUNDARY : BOUNDARY;
    ctx.lineWidth = (campus ? 1.6 : 0.8) * sx;
    ctx.setLineDash(c.source === 'derived' ? [4 * sx, 3 * sx] : []);
    for (const r of c.rings) {
      path(r, true);
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);

  // 楼脚的接地阴影：轮廓向外晕开几米，与外墙墙脚压暗接上
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = 'rgb(196, 205, 218)';
  ctx.shadowColor = 'rgba(40, 52, 70, 0.38)';
  ctx.shadowBlur = 5 * sx;
  for (const b of d.buildings) {
    const outer = b.rings[0];
    if (!outer) continue;
    path(outer, true);
    ctx.fill();
  }
  ctx.restore();

  // 夜里的路灯：只画道路，主干道更亮
  const glowSize = size / 2;
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = glowSize;
  glowCanvas.height = glowSize;
  const g = glowCanvas.getContext('2d');
  if (!g) throw new Error('无法创建 2D 画布');
  g.fillStyle = '#000';
  g.fillRect(0, 0, glowSize, glowSize);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const k = glowSize / size;
  for (const r of d.roads) {
    g.strokeStyle = r.cls <= 2 ? '#ffffff' : r.cls <= 4 ? '#8a8a8a' : '#3a3a3a';
    g.lineWidth = Math.max(1, (ROAD_WIDTH[r.cls] ?? 4) * sx * k * 0.8);
    g.beginPath();
    for (let i = 0; i < r.points.length; i += 2) {
      const x = px(r.points[i] as number) * k;
      const y = py(r.points[i + 1] as number) * k;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }

  return { map: toTexture(canvas, true), glow: toTexture(glowCanvas, false) };
}

export interface Basemap {
  texture: CanvasTexture;
  /** 贴图覆盖的范围（平面坐标） */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** 远景底图：片区以外的主干道、河流与地铁线，拉远看可达范围时用 */
export function buildBasemap(region: Region, size = 4096): Basemap {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const r of region.basemap.roads) {
    for (let i = 0; i < r.points.length; i += 2) {
      const x = r.points[i] as number;
      const y = r.points[i + 1] as number;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const span = Math.max(maxX - minX, maxY - minY);
  maxX = minX + span;
  maxY = minY + span;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 2D 画布');
  const s = size / span;
  const line = (pts: Float64Array) => {
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 2) {
      const x = ((pts[i] as number) - minX) * s;
      const y = (maxY - (pts[i + 1] as number)) * s;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };
  ctx.fillStyle = GROUND;
  ctx.fillRect(0, 0, size, size);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = WATER;
  for (const w of region.basemap.water) {
    ctx.lineWidth = Math.max(1.5, w.width * s);
    line(w.line);
  }
  for (const cls of [2, 1, 0]) {
    ctx.strokeStyle = cls === 2 ? ROAD_MINOR : ROAD_MAJOR;
    ctx.lineWidth = Math.max(1.2, (cls === 0 ? 30 : cls === 1 ? 22 : 15) * s);
    for (const r of region.basemap.roads) if (r.cls === cls) line(r.points);
  }
  // 地铁线作底图参考，压得很淡；坐过的那几段另由乘车轨迹画出
  ctx.globalAlpha = 0.32;
  for (const l of region.lines) {
    ctx.strokeStyle = l.colour;
    ctx.lineWidth = Math.max(1.2, 6 * s);
    for (const seg of l.segments) line(seg.points);
  }
  ctx.globalAlpha = 1;
  const texture = toTexture(canvas, true);
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  return { texture, minX, minY, maxX, maxY };
}
