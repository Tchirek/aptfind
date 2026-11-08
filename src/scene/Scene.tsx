import { MapControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { NeutralToneMapping, type PerspectiveCamera } from 'three';
import type { SceneData } from '../app/data';
import { useApp } from '../app/store';
import { Buildings } from './Buildings';
import { CameraRig, MAX_DISTANCE } from './CameraRig';
import { ENU_ROTATION_X } from './coords';
import { DevHandle } from './DevHandle';
import { Facades } from './Facades';
import { Ground } from './Ground';
import { Labels } from './Labels';
import { Overlays } from './Overlays';
import { Reach } from './Reach';
import { Sun } from './Sun';
import { TouchGestures } from './TouchGestures';
import { Traffic } from './Traffic';
import { Viewshed } from './Viewshed';

/**
 * 竖屏时水平视野只有横屏的四成左右：把镜头拉远、视角放宽一点，
 * 否则手机上只能看到一小片楼。只在挂载时拉远一次，之后交给用户。
 */
function CameraFit() {
  const { camera, size } = useThree();
  const fitted = useRef(false);
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const portrait = aspect < 0.85;
    const p = camera as PerspectiveCamera;
    const fov = portrait ? 42 : 30;
    if (Math.abs(p.fov - fov) > 0.01) {
      p.fov = fov;
      p.updateProjectionMatrix();
    }
    if (!fitted.current) {
      fitted.current = true;
      if (portrait) camera.position.multiplyScalar(1.7);
    }
  }, [camera, size.width, size.height]);
  return null;
}

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
        <Traffic district={data.district} />
        <Reach district={data.district} />
        <Viewshed data={data} />
      </group>
      <MapControls
        makeDefault
        target={[0, 16, 0]}
        enableDamping
        dampingFactor={0.12}
        minDistance={30}
        maxDistance={MAX_DISTANCE}
        maxPolarAngle={1.38}
        screenSpacePanning={false}
      />
      <CameraRig />
      <TouchGestures />
      <CameraFit />
      <Labels district={data.district} />
      {import.meta.env.DEV && <DevHandle />}
    </Canvas>
  );
}
