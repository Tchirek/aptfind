import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { type DirectionalLight, Vector3 } from 'three';
import { presetDate, useApp } from '../app/store';
import { sunDirectionEnu, sunPosition, trueSolarTimeToUtc } from '../engine/solar';
import { enuToWorld } from './coords';

const ORIGIN = { lat: 30.616, lon: 104.12 };

/** 日照时数模式用的固定光：东南方 45° 仰角，只为把体块交代清楚 */
const STUDIO_DIR = new Vector3(...enuToWorld(...sunDirectionEnu(150, 45))).normalize();

export function Sun() {
  const mode = useApp((s) => s.mode);
  const day = useApp((s) => s.day);
  const tst = useApp((s) => s.tst);
  const light = useRef<DirectionalLight>(null);
  const { controls, camera, scene } = useThree();

  const sun = useMemo(() => {
    const utc = trueSolarTimeToUtc(presetDate(day), tst, ORIGIN.lon);
    const p = sunPosition(utc, ORIGIN.lat, ORIGIN.lon);
    const dir = new Vector3(...enuToWorld(...sunDirectionEnu(p.azimuth, p.apparentElevation)));
    return { dir: dir.normalize(), elevation: p.apparentElevation };
  }, [day, tst]);

  const shadowMode = mode === 'shadow';
  const dir = shadowMode ? sun.dir : STUDIO_DIR;
  // 太阳贴近地平线时逐渐变暗，落山后只剩天光
  const intensity = shadowMode ? 3.6 * Math.min(1, Math.max(0, sun.elevation) / 6) : 2.2;

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
    l.position.copy(target.current).addScaledVector(dir, 3000);
    l.target.position.copy(target.current);
  });

  return (
    <>
      <hemisphereLight args={['#ffffff', '#d9d3c7', shadowMode ? 0.8 : 1.5]} />
      <directionalLight
        ref={light}
        intensity={intensity}
        color={shadowMode && sun.elevation < 12 ? '#ffe2c4' : '#ffffff'}
        castShadow={shadowMode}
        shadow-mapSize={[4096, 4096]}
        shadow-camera-near={10}
        shadow-camera-far={6000}
        shadow-bias={-0.0004}
        shadow-normalBias={0.6}
      />
    </>
  );
}
