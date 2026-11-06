import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { Vector3 } from 'three';
import { useApp } from '../app/store';
import { enuToWorld } from './coords';

interface Controls {
  target: Vector3;
  update: () => void;
}

const DURATION = 900;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** 响应 store.flyTo：保持当前视角方向，平滑移到新的目标点与距离 */
export function CameraRig() {
  const flyTo = useApp((s) => s.flyTo);
  const { camera, controls } = useThree();
  const anim = useRef<{
    t0: number;
    fromPos: Vector3;
    fromTarget: Vector3;
    toPos: Vector3;
    toTarget: Vector3;
  } | null>(null);

  useEffect(() => {
    const c = controls as unknown as Controls | null;
    if (!flyTo || !c) return;
    const toTarget = new Vector3(...enuToWorld(...flyTo.target));
    const dir = camera.position.clone().sub(c.target).normalize();
    anim.current = {
      t0: performance.now(),
      fromPos: camera.position.clone(),
      fromTarget: c.target.clone(),
      toTarget,
      toPos: toTarget.clone().addScaledVector(dir, flyTo.distance),
    };
  }, [flyTo, camera, controls]);

  useFrame(() => {
    const a = anim.current;
    const c = controls as unknown as Controls | null;
    if (!a || !c) return;
    const t = Math.min(1, (performance.now() - a.t0) / DURATION);
    const k = ease(t);
    camera.position.lerpVectors(a.fromPos, a.toPos, k);
    c.target.lerpVectors(a.fromTarget, a.toTarget, k);
    c.update();
    if (t >= 1) anim.current = null;
  });

  return null;
}
