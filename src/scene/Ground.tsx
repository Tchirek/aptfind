import { useMemo } from 'react';
import { DoubleSide } from 'three';
import type { District } from '../engine/district';
import { buildRoadGeometry, buildWaterGeometry } from './groundGeometry';

const GROUND = '#e8e6df';
const ROAD_MAJOR = '#d6d2c8';
const ROAD_MINOR = '#dfdbd2';
const WATER = '#c4d0d6';

export function Ground({ district }: { district: District }) {
  const major = useMemo(() => buildRoadGeometry(district.roads, false), [district]);
  const minor = useMemo(() => buildRoadGeometry(district.roads, true), [district]);
  const water = useMemo(() => buildWaterGeometry(district.water), [district]);

  return (
    <group>
      <mesh receiveShadow position={[0, 0, -0.05]}>
        <planeGeometry args={[12000, 12000]} />
        <meshStandardMaterial color={GROUND} roughness={1} />
      </mesh>
      <mesh geometry={water} receiveShadow renderOrder={1}>
        <meshStandardMaterial
          color={WATER}
          roughness={0.6}
          side={DoubleSide}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
        />
      </mesh>
      <mesh geometry={minor} receiveShadow renderOrder={2}>
        <meshStandardMaterial
          color={ROAD_MINOR}
          roughness={1}
          side={DoubleSide}
          polygonOffset
          polygonOffsetFactor={-2}
          polygonOffsetUnits={-2}
        />
      </mesh>
      <mesh geometry={major} receiveShadow renderOrder={3}>
        <meshStandardMaterial
          color={ROAD_MAJOR}
          roughness={1}
          side={DoubleSide}
          polygonOffset
          polygonOffsetFactor={-3}
          polygonOffsetUnits={-3}
        />
      </mesh>
    </group>
  );
}
