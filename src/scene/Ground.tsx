import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import { BufferAttribute, BufferGeometry, Color, MeshStandardMaterial } from 'three';
import { getRegion } from '../app/data';
import type { District } from '../engine/district';
import {
  type Basemap,
  buildBasemap,
  buildGroundTexture,
  GROUND,
  terrainExtent,
} from './groundTexture';
import { sceneUniforms } from './lighting';
import { withReach } from './reachLayer';
import { withSkyFog } from './skyLayer';

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
      uv.set(
        [(x - ext.minX) / (ext.maxX - ext.minX), (y - ext.minY) / (ext.maxY - ext.minY)],
        k * 2,
      );
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

/** 远景地面的边长（米）：拉远看 30 分钟可达范围时也铺得满 */
const FAR_SIZE = 80_000;

export function Ground({ district }: { district: District }) {
  const geometry = useMemo(() => terrainGeometry(district), [district]);
  const textures = useMemo(() => buildGroundTexture(district), [district]);
  useEffect(
    () => () => {
      textures.map.dispose();
      textures.glow.dispose();
    },
    [textures],
  );

  const terrain = useMemo(
    () =>
      withSkyFog(
        withReach(
          new MeshStandardMaterial({
            map: textures.map,
            roughness: 1,
            emissiveMap: textures.glow,
            emissive: new Color('#ffb36b'),
            emissiveIntensity: 0,
          }),
          'terrain',
        ),
      ),
    [textures],
  );
  const far = useMemo(
    () => withSkyFog(withReach(new MeshStandardMaterial({ color: GROUND, roughness: 1 }), 'far')),
    [],
  );

  // 区域数据到了再铺远景底图
  const [basemap, setBasemap] = useState<Basemap | null>(null);
  useEffect(() => {
    let alive = true;
    getRegion().then(({ region }) => {
      if (alive) setBasemap(buildBasemap(region));
    });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!basemap) return;
    const w = basemap.maxX - basemap.minX;
    // 平面 UV 0–1 对应 [−FAR_SIZE/2, FAR_SIZE/2]，换算到底图覆盖的范围
    basemap.texture.repeat.set(FAR_SIZE / w, FAR_SIZE / w);
    basemap.texture.offset.set(
      (-FAR_SIZE / 2 - basemap.minX) / w,
      (-FAR_SIZE / 2 - basemap.minY) / w,
    );
    far.map = basemap.texture;
    far.color.set('#ffffff');
    far.needsUpdate = true;
    return () => basemap.texture.dispose();
  }, [basemap, far]);

  // 夜里路面微微发光
  useFrame(() => {
    terrain.emissiveIntensity = 0.55 * sceneUniforms.uNight.value;
  });

  return (
    <group>
      {/* 地形范围之外的远景地面，略低于最低点 */}
      <mesh position={[0, 0, -0.6]} receiveShadow material={far}>
        <planeGeometry args={[FAR_SIZE, FAR_SIZE]} />
      </mesh>
      <mesh geometry={geometry} receiveShadow castShadow material={terrain} />
    </group>
  );
}
