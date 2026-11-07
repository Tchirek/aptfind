import { Html } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import { BufferAttribute, BufferGeometry, DoubleSide } from 'three';
import type { SceneData } from '../app/data';
import { formatDuration, windowOrientation } from '../app/format';
import { selectedBuilding, useApp } from '../app/store';
import { dayTimes } from '../app/time';
import type { WindowGrid } from '../engine/geometry';
import { warmSpanFor } from '../ui/palette';
import { buildingViewDistance, flyToBuilding, isDrag } from './Buildings';
import {
  buildFacadeGeometry,
  facadeMaterial,
  paintFacades,
  vertexToWindow,
} from './facadeGeometry';

/** 窗位的框：四条细边，比窗格再往外抬一点 */
function frameGeometry(grid: WindowGrid, i: number, width: number): BufferGeometry {
  const x0 = grid.x0[i] as number;
  const y0 = grid.y0[i] as number;
  const x1 = grid.x1[i] as number;
  const y1 = grid.y1[i] as number;
  const z0 = grid.z0[i] as number;
  const z1 = grid.z1[i] as number;
  const len = Math.hypot(x1 - x0, y1 - y0);
  const ux = (x1 - x0) / len;
  const uy = (y1 - y0) / len;
  const lift = 0.14;
  const nx = uy * lift;
  const ny = -ux * lift;
  const t = Math.max(0.1, Math.min(width, len * 0.06));
  const quads: number[][] = [];
  const quad = (a: number, b: number, za: number, zb: number) =>
    quads.push([a, za, b, za, b, zb, a, zb]);
  quad(0, len, z0, z0 + t);
  quad(0, len, z1 - t, z1);
  quad(0, t, z0, z1);
  quad(len - t, len, z0, z1);
  const pos: number[] = [];
  for (const q of quads) {
    const p = [0, 1, 2, 3].map((k) => {
      const s = q[2 * k] as number;
      const z = q[2 * k + 1] as number;
      return [x0 + ux * s + nx, y0 + uy * s + ny, z];
    });
    for (const k of [0, 1, 2, 0, 2, 3]) pos.push(...(p[k] as number[]));
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  return g;
}

function windowCenter(grid: WindowGrid, i: number): [number, number, number] {
  const x0 = grid.x0[i] as number;
  const y0 = grid.y0[i] as number;
  const x1 = grid.x1[i] as number;
  const y1 = grid.y1[i] as number;
  const len = Math.hypot(x1 - x0, y1 - y0);
  // 往墙外让出 0.6 m，标签不被墙面遮住
  return [
    (x0 + x1) / 2 + ((y1 - y0) / len) * 0.6,
    (y0 + y1) / 2 - ((x1 - x0) / len) * 0.6,
    (grid.z1[i] as number) + 0.3,
  ];
}

/**
 * 选中楼的外墙：按所选日期的逐窗日照着色，悬停的窗位描白框并标出层数与时长，点一下选中这扇窗。
 * 其他楼保持程序化立面，不着色。
 */
export function Facades({ data }: { data: SceneData }) {
  const selection = useApp((s) => s.selection);
  const select = useApp((s) => s.select);
  const requestFly = useApp((s) => s.requestFly);
  const sunlight = useApp((s) => s.sunlight);
  const { grid } = data;
  const building = selectedBuilding(selection, grid);
  const start = building === null ? 0 : (data.windowRange[2 * building] as number);
  const n = building === null ? 0 : (data.windowRange[2 * building + 1] as number);

  const geometry = useMemo(() => {
    if (n === 0) return null;
    const g = buildFacadeGeometry(grid, start, n);
    g.computeBoundsTree();
    return g;
  }, [grid, start, n]);
  useEffect(() => () => geometry?.dispose(), [geometry]);

  const material = useMemo(() => facadeMaterial(), []);
  const date = useApp((s) => s.date);
  useEffect(() => {
    const t = dayTimes(date);
    (material.uniforms.uWarmSpan as { value: number }).value = warmSpanFor(t.sunset - t.sunrise);
  }, [material, date]);

  useEffect(() => {
    if (geometry && sunlight && sunlight.building === building) {
      paintFacades(geometry, grid, start, sunlight.minutes);
    }
  }, [geometry, grid, start, building, sunlight]);

  // 悬停记下是哪栋楼的窗，换了楼自然作废
  const [hovered, setHover] = useState<{ building: number | null; index: number } | null>(null);
  const hover = hovered && hovered.building === building ? hovered.index : null;

  const selectedWindow = selection?.kind === 'window' ? selection.index : null;
  const frame = useMemo(
    () => (selectedWindow === null ? null : frameGeometry(grid, selectedWindow, 0.3)),
    [grid, selectedWindow],
  );
  const hoverFrame = useMemo(
    () => (hover === null || hover === selectedWindow ? null : frameGeometry(grid, hover, 0.18)),
    [grid, hover, selectedWindow],
  );

  if (!geometry) return null;

  const toWindow = (e: ThreeEvent<PointerEvent | MouseEvent>) =>
    e.face ? start + vertexToWindow(e.face.a) : null;

  // 选窗：楼已选中，这是"再点一下"，镜头还离得远就顺便拉过去
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (isDrag(e)) return;
    const i = toWindow(e);
    if (i === null) return;
    e.stopPropagation();
    select({ kind: 'window', index: i });
    const b = building === null ? undefined : data.district.buildings[building];
    if (b && e.camera.position.distanceTo(e.point) > buildingViewDistance(b) * 1.6) {
      flyToBuilding(b, requestFly);
    }
  };

  const hoverMinutes =
    hover !== null && sunlight?.building === building
      ? (sunlight.minutes[hover - start] as number)
      : Number.NaN;

  return (
    <group>
      <mesh
        geometry={geometry}
        material={material}
        onClick={onClick}
        onPointerMove={(e) => {
          e.stopPropagation();
          const i = toWindow(e);
          setHover(i === null ? null : { building, index: i });
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          setHover(null);
          document.body.style.cursor = '';
        }}
      />
      {hoverFrame && (
        <mesh geometry={hoverFrame} renderOrder={7}>
          <meshBasicMaterial color="#ffffff" side={DoubleSide} toneMapped={false} />
        </mesh>
      )}
      {frame && (
        <mesh geometry={frame} renderOrder={8}>
          <meshBasicMaterial color="#1f1f1c" side={DoubleSide} toneMapped={false} />
        </mesh>
      )}
      {hover !== null && (
        <Html
          position={windowCenter(grid, hover)}
          center
          zIndexRange={[35, 30]}
          className="window-tip"
          style={{ pointerEvents: 'none' }}
        >
          <b>{(grid.floor[hover] as number) + 1} 层</b>
          <span>{windowOrientation(grid, hover)}</span>
          <span className="mono">
            {Number.isNaN(hoverMinutes) ? '…' : formatDuration(hoverMinutes)}
          </span>
        </Html>
      )}
    </group>
  );
}
