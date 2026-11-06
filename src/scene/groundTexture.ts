/**
 * 地面贴图：把道路、水系、小区与校园范围画到一张画布上，再贴到地形网格上。
 * 贴图天然随地形起伏，不会出现条带穿进坡面或悬空。
 */

import { CanvasTexture, LinearMipmapLinearFilter, SRGBColorSpace } from 'three';
import type { District } from '../engine/district';

export const GROUND = '#e9e7e1';
const ROAD_MAJOR = '#d3cfc5';
const ROAD_MINOR = '#dedad1';
const WATER = '#bfccd3';
const RESIDENTIAL_FILL = 'rgba(214, 205, 186, 0.22)';
const SCHOOL_FILL = 'rgba(201, 211, 190, 0.32)';
const BOUNDARY = 'rgba(120, 112, 98, 0.55)';
const CAMPUS_BOUNDARY = 'rgba(70, 92, 66, 0.85)';

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

export function buildGroundTexture(d: District, size = 4096): CanvasTexture {
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
    ctx.lineWidth = (campus ? 2.4 : 1.1) * sx;
    ctx.setLineDash(c.source === 'derived' ? [6 * sx, 4 * sx] : []);
    for (const r of c.rings) {
      path(r, true);
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}
