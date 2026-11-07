import type { ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { EdgesGeometry } from 'three';
import type { SceneData } from '../app/data';
import { selectedBuilding, useApp } from '../app/store';
import { buildSolids } from '../engine/geometry';
import { buildBuildingGeometry } from './buildingGeometry';
import { buildingUniforms, createBuildingMaterial } from './buildingMaterial';

const OUTLINE_COLOR = '#1f1f1c';

/** 轮廓顶点的平均值，作为镜头对准的点 */
export function centroid(ring: Float64Array): [number, number] {
  let x = 0;
  let y = 0;
  const n = ring.length / 2;
  for (let i = 0; i < ring.length; i += 2) {
    x += ring[i] as number;
    y += ring[i + 1] as number;
  }
  return [x / n, y / n];
}

/** 拖动视角时不算点击 */
export const isDrag = (e: ThreeEvent<MouseEvent>) => e.delta > 4;

/**
 * 全部建筑合成一个网格：程序化立面 + 实时阴影。
 * 核心区的楼可以悬停、点选；外圈的楼只作为遮挡物与背景，不响应指针。
 */
export function Buildings({ data }: { data: SceneData }) {
  const selection = useApp((s) => s.selection);
  const focus = useApp((s) => s.focusBuilding);
  const select = useApp((s) => s.select);
  const requestFly = useApp((s) => s.requestFly);
  const { buildings } = data.district;

  const mesh = useMemo(() => {
    const m = buildBuildingGeometry(buildings);
    m.geometry.computeBoundsTree();
    return m;
  }, [buildings]);
  const material = useMemo(() => createBuildingMaterial(), []);

  const current = selectedBuilding(selection, data.grid);
  useEffect(() => {
    buildingUniforms.uSelected.value = current ?? -1;
  }, [current]);
  useEffect(() => {
    buildingUniforms.uFocus.value = focus ?? -1;
  }, [focus]);

  const outline = useMemo(() => {
    const b = current === null ? undefined : buildings[current];
    return b ? new EdgesGeometry(buildSolids([b]).geometry, 25) : null;
  }, [buildings, current]);
  useEffect(() => () => outline?.dispose(), [outline]);

  const pick = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    if (!e.face) return null;
    const b = mesh.vertexBuilding[e.face.a];
    const building = b === undefined ? undefined : buildings[b];
    return building?.core ? building : null;
  };

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (isDrag(e)) return;
    const building = pick(e);
    if (!building) return;
    e.stopPropagation();
    if (building.index === current) return;
    select({ kind: 'building', index: building.index });
    const [cx, cy] = centroid(building.rings[0] as Float64Array);
    requestFly(
      [cx, cy, building.base + building.height * 0.45],
      Math.max(110, building.height * 3.2),
    );
  };

  return (
    <group>
      <mesh
        geometry={mesh.geometry}
        material={material}
        castShadow
        receiveShadow
        onClick={onClick}
        onPointerMove={(e) => {
          const b = pick(e);
          buildingUniforms.uHover.value = b ? b.index : -1;
          document.body.style.cursor = b ? 'pointer' : '';
        }}
        onPointerOut={() => {
          buildingUniforms.uHover.value = -1;
          document.body.style.cursor = '';
        }}
      />
      {outline && (
        <lineSegments geometry={outline} renderOrder={6}>
          <lineBasicMaterial color={OUTLINE_COLOR} depthTest={false} transparent opacity={0.85} />
        </lineSegments>
      )}
    </group>
  );
}
