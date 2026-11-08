import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { type Camera, type PerspectiveCamera, Vector3 } from 'three';
import { useApp } from '../app/store';
import { enuToWorld } from './coords';

interface Controls {
  target: Vector3;
  maxDistance: number;
  maxPolarAngle: number;
  update: () => void;
}

/** 镜头离目标点最远多少米：再远，片区外空荡荡的地面就露出来了 */
export const MAX_DISTANCE = 2800;
/** 建筑铺到片区中心外约 1450 m */
const BUILT_EXTENT = 1450;
/**
 * 目标点离片区中心最远多少米：镜头看到的半幅越大（离得远、屏幕宽），就越要靠近中间，
 * 这样画面边缘才不会露出片区外的空地。
 */
function panRange(dist: number, camera: Camera): number {
  const { fov, aspect } = camera as PerspectiveCamera;
  const half = dist * Math.tan((fov * Math.PI) / 360) * Math.max(aspect, 1.2);
  return Math.max(180, BUILT_EXTENT - 0.9 * half);
}
/** 离得越远，俯角要越大，不然视线越过片区看到地平线 */
function polarLimit(dist: number): number {
  const t = Math.min(1, Math.max(0, (dist - 500) / 2100));
  return 1.38 - t * 0.53;
}
const WIDE_POLAR = 1.42;

/** 可达范围全览、片区外的设施：镜头要出片区一趟，这时放宽范围 */
interface Wide {
  maxDistance: number;
  range: number;
}

const DURATION = 900;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * 响应 store.flyTo：保持当前视角方向，平滑移到新的目标点与距离。
 * 同时把镜头约束在有建筑的范围里；换选中对象时收回放宽的范围。
 */
export function CameraRig() {
  const flyTo = useApp((s) => s.flyTo);
  const selection = useApp((s) => s.selection);
  const wide = useRef<Wide | null>(null);
  const { camera, controls } = useThree();
  const anim = useRef<{
    t0: number;
    fromPos: Vector3;
    fromTarget: Vector3;
    toPos: Vector3;
    toTarget: Vector3;
  } | null>(null);

  // 这段必须在响应 flyTo 的那段之前：同一拍里换了选中又要飞，以飞行的范围为准
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只在选中对象变化时收回
  useEffect(() => {
    const c = controls as unknown as Controls | null;
    if (!c || !wide.current) return;
    wide.current = null;
    c.maxDistance = MAX_DISTANCE;
    const dist = camera.position.distanceTo(c.target);
    const range = panRange(Math.min(dist, MAX_DISTANCE), camera);
    const toTarget = new Vector3(
      Math.min(range, Math.max(-range, c.target.x)),
      c.target.y,
      Math.min(range, Math.max(-range, c.target.z)),
    );
    const dir = camera.position.clone().sub(c.target).normalize();
    anim.current = {
      t0: performance.now(),
      fromPos: camera.position.clone(),
      fromTarget: c.target.clone(),
      toTarget,
      toPos: toTarget.clone().addScaledVector(dir, Math.min(dist, MAX_DISTANCE)),
    };
  }, [selection]);

  useEffect(() => {
    const c = controls as unknown as Controls | null;
    if (!flyTo || !c) return;
    const toTarget = new Vector3(...enuToWorld(...flyTo.target));
    const farthest = Math.max(Math.abs(toTarget.x), Math.abs(toTarget.z));
    if (flyTo.distance > MAX_DISTANCE || farthest > panRange(flyTo.distance, camera)) {
      wide.current = {
        maxDistance: Math.max(MAX_DISTANCE, flyTo.distance * 1.3),
        range: farthest + flyTo.distance * 0.5,
      };
      c.maxDistance = wide.current.maxDistance;
      c.maxPolarAngle = WIDE_POLAR;
    }
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
    const c = controls as unknown as Controls | null;
    if (c && 'near' in camera) {
      const dist = camera.position.distanceTo(c.target);
      const near = Math.min(200, Math.max(2, dist * 0.004));
      const far = Math.max(16000, dist * 8);
      if (Math.abs(camera.near - near) > near * 0.2 || Math.abs(camera.far - far) > far * 0.2) {
        camera.near = near;
        camera.far = far;
        camera.updateProjectionMatrix();
      }
    }
    const a = anim.current;
    if (c && !a) {
      const dist = camera.position.distanceTo(c.target);
      // 用户自己拉回片区里了，就不再放宽
      if (
        wide.current &&
        dist < MAX_DISTANCE * 0.8 &&
        Math.max(Math.abs(c.target.x), Math.abs(c.target.z)) < panRange(dist, camera)
      ) {
        wide.current = null;
        c.maxDistance = MAX_DISTANCE;
      }
      if (!wide.current) c.maxPolarAngle = polarLimit(dist);
      const range = wide.current ? wide.current.range : panRange(dist, camera);
      const dx = Math.min(range, Math.max(-range, c.target.x)) - c.target.x;
      const dz = Math.min(range, Math.max(-range, c.target.z)) - c.target.z;
      if (dx !== 0 || dz !== 0) {
        // 目标点和镜头一起挪，视角不变
        c.target.x += dx;
        c.target.z += dz;
        camera.position.x += dx;
        camera.position.z += dz;
      }
    }
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
