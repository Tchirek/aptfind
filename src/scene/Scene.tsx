import { MapControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { NeutralToneMapping } from 'three';
import type { SceneData } from '../app/data';
import { useApp } from '../app/store';
import { Buildings } from './Buildings';
import { CameraRig } from './CameraRig';
import { ENU_ROTATION_X } from './coords';
import { DevHandle } from './DevHandle';
import { Facades } from './Facades';
import { Ground } from './Ground';
import { Sun } from './Sun';

export const BACKGROUND = '#f3f2ee';

export function Scene({ data }: { data: SceneData }) {
  const select = useApp((s) => s.select);
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      gl={{ antialias: true, toneMapping: NeutralToneMapping }}
      camera={{ position: [620, 760, 980], fov: 30, near: 4, far: 14000 }}
      onPointerMissed={(e) => {
        if (e.type === 'click') select(null);
      }}
    >
      <color attach="background" args={[BACKGROUND]} />
      <fog attach="fog" args={[BACKGROUND, 3200, 9000]} />
      <Sun />
      <group rotation-x={ENU_ROTATION_X}>
        <Ground district={data.district} />
        <Buildings data={data} />
        <Facades data={data} />
      </group>
      <MapControls
        makeDefault
        target={[0, 0, 0]}
        enableDamping
        dampingFactor={0.12}
        minDistance={30}
        maxDistance={3600}
        maxPolarAngle={1.42}
        screenSpacePanning={false}
      />
      <CameraRig />
      {import.meta.env.DEV && <DevHandle />}
    </Canvas>
  );
}
