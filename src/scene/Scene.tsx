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
import { Overlays } from './Overlays';
import { Reach } from './Reach';
import { Sun } from './Sun';

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
      <Sun />
      <group rotation-x={ENU_ROTATION_X}>
        <Ground district={data.district} />
        <Buildings data={data} />
        <Facades data={data} />
        <Overlays data={data} />
        <Reach district={data.district} />
      </group>
      <MapControls
        makeDefault
        target={[0, 16, 0]}
        enableDamping
        dampingFactor={0.12}
        minDistance={30}
        maxDistance={26000}
        maxPolarAngle={1.42}
        screenSpacePanning={false}
      />
      <CameraRig />
      {import.meta.env.DEV && <DevHandle />}
    </Canvas>
  );
}
