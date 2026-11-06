import type { ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, DoubleSide } from 'three';
import type { SceneData } from '../app/data';
import { useApp } from '../app/store';
import type { WindowGrid } from '../engine/geometry';
import { isDrag } from './Buildings';
import {
  buildFacadeGeometry,
  facadeMaterial,
  paintFacades,
  vertexToWindow,
} from './facadeGeometry';

/** 选中窗位的黑框：四条细边，比窗格再往外抬一点 */
function frameGeometry(grid: WindowGrid, i: number): BufferGeometry {
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
  const t = Math.max(0.12, Math.min(0.3, len * 0.06));
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

export function Facades({ data }: { data: SceneData }) {
  const mode = useApp((s) => s.mode);
  const selection = useApp((s) => s.selection);
  const select = useApp((s) => s.select);

  const geometry = useMemo(() => {
    const g = buildFacadeGeometry(data.grid);
    g.computeBoundsTree();
    return g;
  }, [data.grid]);

  const material = useMemo(() => facadeMaterial(), []);

  useEffect(() => {
    paintFacades(geometry, data.grid, data.dahanMinutes);
  }, [geometry, data.grid, data.dahanMinutes]);

  const frame = useMemo(
    () => (selection?.kind === 'window' ? frameGeometry(data.grid, selection.index) : null),
    [data.grid, selection],
  );

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (isDrag(e) || !e.face) return;
    e.stopPropagation();
    select({ kind: 'window', index: vertexToWindow(e.face.a) });
  };

  return (
    <group>
      <mesh
        geometry={geometry}
        material={material}
        visible={mode === 'hours'}
        onClick={mode === 'hours' ? onClick : undefined}
      />
      {frame && (
        <mesh geometry={frame} renderOrder={7}>
          <meshBasicMaterial color="#1f1f1c" side={DoubleSide} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}
