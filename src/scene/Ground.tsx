import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry } from 'three';
import type { District } from '../engine/district';
import { buildGroundTexture, GROUND, terrainExtent } from './groundTexture';

/** 地形网格（ENU，z 向上），UV 按平面坐标铺满地面贴图 */
function terrainGeometry(d: District): BufferGeometry {
  const t = d.terrain;
  const ext = terrainExtent(d);
  const pos = new Float32Array(t.nx * t.ny * 3);
  const uv = new Float32Array(t.nx * t.ny * 2);
  for (let j = 0; j < t.ny; j++) {
    for (let i = 0; i < t.nx; i++) {
      const k = j * t.nx + i;
      const x = t.x0 + i * t.step;
      const y = t.y0 + j * t.step;
      pos.set([x, y, t.z[k] as number], k * 3);
      uv.set([(x - ext.minX) / (ext.maxX - ext.minX), (y - ext.minY) / (ext.maxY - ext.minY)], k * 2);
    }
  }
  const index = new Uint32Array((t.nx - 1) * (t.ny - 1) * 6);
  let o = 0;
  for (let j = 0; j < t.ny - 1; j++) {
    for (let i = 0; i < t.nx - 1; i++) {
      const a = j * t.nx + i;
      const b = a + 1;
      const c = a + t.nx + 1;
      const e = a + t.nx;
      index.set([a, b, c, a, c, e], o);
      o += 6;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(new BufferAttribute(index, 1));
  g.computeVertexNormals();
  return g;
}

export function Ground({ district }: { district: District }) {
  const geometry = useMemo(() => terrainGeometry(district), [district]);
  const texture = useMemo(() => buildGroundTexture(district), [district]);
  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <group>
      {/* 地形范围之外的远景地面，略低于最低点，被雾吞没 */}
      <mesh position={[0, 0, -0.6]} receiveShadow>
        <planeGeometry args={[14000, 14000]} />
        <meshStandardMaterial color={GROUND} roughness={1} />
      </mesh>
      <mesh geometry={geometry} receiveShadow castShadow>
        <meshStandardMaterial map={texture} roughness={1} />
      </mesh>
    </group>
  );
}
