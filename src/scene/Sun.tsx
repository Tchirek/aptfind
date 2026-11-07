import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { type DirectionalLight, Vector3 } from 'three';
import { useApp } from '../app/store';
import { sunAt } from '../app/time';
import { sunDirectionEnu } from '../engine/solar';
import { enuToWorld } from './coords';

export function Sun() {
  const date = useApp((s) => s.date);
  const minute = useApp((s) => s.minute);
  const light = useRef<DirectionalLight>(null);
  const { controls, camera, scene } = useThree();

  const sun = useMemo(() => {
    const p = sunAt(date, minute);
    const dir = new Vector3(...enuToWorld(...sunDirectionEnu(p.azimuth, p.apparentElevation)));
    return { dir: dir.normalize(), elevation: p.apparentElevation };
  }, [date, minute]);

  // 太阳贴近地平线时逐渐变暗，落山后只剩天光
  const intensity = 3.6 * Math.min(1, Math.max(0, sun.elevation) / 6);

  useEffect(() => {
    const l = light.current;
    if (!l) return;
    scene.add(l.target);
    return () => {
      scene.remove(l.target);
    };
  }, [scene]);

  // 阴影相机跟着视点走：拉近时覆盖范围小、阴影锐利，拉远时覆盖整个片区
  const target = useRef(new Vector3());
  useFrame(() => {
    const l = light.current;
    if (!l) return;
    const t = (controls as unknown as { target?: Vector3 } | null)?.target;
    if (t) target.current.copy(t);
    const dist = camera.position.distanceTo(target.current);
    const extent = Math.min(1800, Math.max(160, dist * 0.85));
    const cam = l.shadow.camera;
    if (cam.right !== extent) {
      cam.left = -extent;
      cam.right = extent;
      cam.top = extent;
      cam.bottom = -extent;
      cam.updateProjectionMatrix();
    }
    l.position.copy(target.current).addScaledVector(sun.dir, 3000);
    l.target.position.copy(target.current);
  });

  return (
    <>
      <hemisphereLight args={['#ffffff', '#d9d3c7', 0.8]} />
      <directionalLight
        ref={light}
        intensity={intensity}
        color={sun.elevation < 12 ? '#ffe2c4' : '#ffffff'}
        castShadow
        shadow-mapSize={[4096, 4096]}
        shadow-camera-near={10}
        shadow-camera-far={6000}
        shadow-bias={-0.0004}
        shadow-normalBias={0.6}
      />
    </>
  );
}
