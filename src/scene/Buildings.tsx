import type { ThreeEvent } from '@react-three/fiber';
import { useMemo } from 'react';
import { EdgesGeometry } from 'three';
import type { SceneData } from '../app/data';
import { useApp } from '../app/store';
import { buildSolids } from '../engine/geometry';

const CORE_COLOR = '#f7f6f2';
const BUFFER_COLOR = '#ecebe6';
const FOCUS_COLOR = '#6b675f';
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

export function Buildings({ data }: { data: SceneData }) {
  const selection = useApp((s) => s.selection);
  const focus = useApp((s) => s.focusBuilding);
  const select = useApp((s) => s.select);
  const requestFly = useApp((s) => s.requestFly);
  const { buildings } = data.district;

  const core = useMemo(() => {
    const s = buildSolids(buildings.filter((b) => b.core));
    s.geometry.computeBoundsTree();
    return s;
  }, [buildings]);
  const buffer = useMemo(() => buildSolids(buildings.filter((b) => !b.core)).geometry, [buildings]);

  const selectedBuilding =
    selection?.kind === 'building'
      ? selection.index
      : selection?.kind === 'window'
        ? (data.grid.building[selection.index] ?? null)
        : null;

  const outline = useMemo(() => {
    const b = selectedBuilding === null ? undefined : buildings[selectedBuilding];
    return b ? new EdgesGeometry(buildSolids([b]).geometry, 25) : null;
  }, [buildings, selectedBuilding]);

  const focusGeometry = useMemo(() => {
    const b = focus === null ? undefined : buildings[focus];
    return b ? buildSolids([b]).geometry : null;
  }, [buildings, focus]);

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (isDrag(e) || !e.face) return;
    e.stopPropagation();
    const b = core.vertexBuilding[e.face.a];
    const building = b === undefined ? undefined : buildings[b];
    if (b === undefined || !building) return;
    select({ kind: 'building', index: b });
    const [cx, cy] = centroid(building.rings[0] as Float64Array);
    requestFly(
      [cx, cy, building.base + building.height * 0.45],
      Math.max(110, building.height * 3.2),
    );
  };

  return (
    <group>
      <mesh geometry={core.geometry} castShadow receiveShadow onClick={onClick}>
        <meshStandardMaterial color={CORE_COLOR} roughness={0.92} />
      </mesh>
      <mesh geometry={buffer} castShadow receiveShadow>
        <meshStandardMaterial color={BUFFER_COLOR} roughness={0.95} />
      </mesh>
      {focusGeometry && (
        <mesh geometry={focusGeometry} renderOrder={5}>
          <meshStandardMaterial
            color={FOCUS_COLOR}
            roughness={0.9}
            polygonOffset
            polygonOffsetFactor={-2}
            polygonOffsetUnits={-2}
          />
        </mesh>
      )}
      {outline && (
        <lineSegments geometry={outline} renderOrder={6}>
          <lineBasicMaterial color={OUTLINE_COLOR} depthTest={false} transparent opacity={0.85} />
        </lineSegments>
      )}
    </group>
  );
}
