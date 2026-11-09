import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { type Camera, type PerspectiveCamera, Vector3 } from 'three';
import type { SceneData } from '../app/data';
import { selectedBuilding, useApp } from '../app/store';
import { centroid } from './Buildings';
import { enuToWorld } from './coords';
import { mapInsets } from './mapInsets';

interface Controls {
  target: Vector3;
  maxDistance: number;
  maxPolarAngle: number;
  update: () => void;
}

/** 镜头离目标点最远多少米：再远，片区外空荡荡的地面就露出来了 */
export const MAX_DISTANCE = 2800;
/** 选中了楼、地图上画着可达范围时能退到多远：装得下步行 15 分钟圈和旁边的详情面板 */
const FOCUS_DISTANCE = 3600;
/** 选中了楼时，目标点可以比这栋楼离片区中心再远多少米：给详情面板让位 */
const FOCUS_MARGIN = 520;
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
const clamp = (v: number, r: number) => Math.min(r, Math.max(-r, v));

/**
 * 响应 store.flyTo / fitTo：平滑移到新的目标点与距离。
 * 同时把镜头约束在有建筑的范围里：没选中楼时最紧；选中楼时放宽到装得下步行 15 分钟圈；
 * 看可达范围全图、去片区外的设施时临时放开，换选中对象时收回。
 */
export function CameraRig({ data }: { data: SceneData }) {
  const flyTo = useApp((s) => s.flyTo);
  const fitTo = useApp((s) => s.fitTo);
  const selection = useApp((s) => s.selection);
  const wide = useRef<Wide | null>(null);
  /** 选中的楼离片区中心多远（取东西、南北较大者），没选中为 null */
  const focus = useRef<number | null>(null);
  const { camera, controls, size } = useThree();
  const anim = useRef<{
    t0: number;
    fromPos: Vector3;
    fromTarget: Vector3;
    toPos: Vector3;
    toTarget: Vector3;
  } | null>(null);

  const limits = (dist: number) => {
    if (wide.current) return wide.current;
    const range = panRange(dist, camera);
    if (focus.current === null) return { maxDistance: MAX_DISTANCE, range };
    return { maxDistance: FOCUS_DISTANCE, range: Math.max(range, focus.current + FOCUS_MARGIN) };
  };

  const flyInto = (toTarget: Vector3, dir: Vector3, dist: number) => {
    const c = controls as unknown as Controls;
    const farthest = Math.max(Math.abs(toTarget.x), Math.abs(toTarget.z));
    const l = limits(dist);
    if (dist > l.maxDistance || farthest > l.range) {
      wide.current = {
        maxDistance: Math.max(FOCUS_DISTANCE, dist * 1.3),
        range: farthest + dist * 0.5,
      };
    }
    anim.current = {
      t0: performance.now(),
      fromPos: camera.position.clone(),
      fromTarget: c.target.clone(),
      toTarget,
      toPos: toTarget.clone().addScaledVector(dir, dist),
    };
  };

  // 这段必须在响应飞行的那几段之前：同一拍里换了选中又要飞，以飞行的范围为准
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只在选中对象变化时收回
  useEffect(() => {
    const b = selectedBuilding(selection, data.grid);
    const ring = b === null ? undefined : data.district.buildings[b]?.rings[0];
    if (ring) {
      const [x, y] = centroid(ring);
      focus.current = Math.max(Math.abs(x), Math.abs(y));
    } else {
      focus.current = null;
    }
    wide.current = null;
    const c = controls as unknown as Controls | null;
    if (!c) return;
    const now = camera.position.distanceTo(c.target);
    const { maxDistance, range } = limits(now);
    const dist = Math.min(now, maxDistance);
    const allowed = limits(dist).range;
    const x = clamp(c.target.x, Math.min(range, allowed));
    const z = clamp(c.target.z, Math.min(range, allowed));
    if (dist === now && x === c.target.x && z === c.target.z) return;
    const toTarget = new Vector3(x, c.target.y, z);
    const dir = camera.position.clone().sub(c.target).normalize();
    anim.current = {
      t0: performance.now(),
      fromPos: camera.position.clone(),
      fromTarget: c.target.clone(),
      toTarget,
      toPos: toTarget.clone().addScaledVector(dir, dist),
    };
  }, [selection]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 只响应新的飞行请求
  useEffect(() => {
    const c = controls as unknown as Controls | null;
    if (!flyTo || !c) return;
    flyInto(
      new Vector3(...enuToWorld(...flyTo.target)),
      camera.position.clone().sub(c.target).normalize(),
      flyTo.distance,
    );
  }, [flyTo]);

  // 把一块范围摆进地图没被面板挡住的那部分
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只响应新的取景请求
  useEffect(() => {
    const c = controls as unknown as Controls | null;
    if (!fitTo || !c) return;
    const { width: W, height: H } = size;
    const ins = mapInsets();
    const usableW = Math.max(60, W - ins.left - ins.right);
    const usableH = Math.max(60, H - ins.top - ins.bottom);
    const offset = camera.position.clone().sub(c.target);
    const theta = fitTo.azimuth ?? Math.atan2(offset.x, offset.z);
    const cosT = Math.abs(Math.cos(theta));
    const sinT = Math.abs(Math.sin(theta));
    const bw = fitTo.x1 - fitTo.x0;
    const bh = fitTo.y1 - fitTo.y0;
    // 转过方位后，范围在屏幕横竖方向上的跨度
    const across = bw * cosT + bh * sinT;
    const along = bw * sinT + bh * cosT;
    const tilt = Math.cos(fitTo.polar);
    const span = 2 * Math.tan(((camera as PerspectiveCamera).fov * Math.PI) / 360);
    const dist = (Math.max((across * H) / usableW, (along * tilt * H) / usableH) / span) * 1.08;
    const perPixel = (span * dist) / H;
    const dx = ((ins.left - ins.right) / 2) * perPixel;
    const dy = (((ins.top - ins.bottom) / 2) * perPixel) / tilt;
    const toTarget = new Vector3(
      (fitTo.x0 + fitTo.x1) / 2 - Math.cos(theta) * dx - Math.sin(theta) * dy,
      c.target.y,
      -(fitTo.y0 + fitTo.y1) / 2 + Math.sin(theta) * dx - Math.cos(theta) * dy,
    );
    const dir = new Vector3(
      Math.sin(fitTo.polar) * Math.sin(theta),
      Math.cos(fitTo.polar),
      Math.sin(fitTo.polar) * Math.cos(theta),
    );
    flyInto(toTarget, dir, dist);
  }, [fitTo]);

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
      if (wide.current) {
        const held = wide.current;
        wide.current = null;
        const normal = limits(dist);
        const inside =
          dist < normal.maxDistance * 0.8 &&
          Math.max(Math.abs(c.target.x), Math.abs(c.target.z)) < normal.range;
        if (!inside) wide.current = held;
      }
      const l = limits(dist);
      c.maxDistance = l.maxDistance;
      c.maxPolarAngle = wide.current ? WIDE_POLAR : polarLimit(dist);
      const dx = clamp(c.target.x, l.range) - c.target.x;
      const dz = clamp(c.target.z, l.range) - c.target.z;
      if (dx !== 0 || dz !== 0) {
        // 目标点和镜头一起挪，视角不变
        c.target.x += dx;
        c.target.z += dz;
        camera.position.x += dx;
        camera.position.z += dz;
      }
    }
    if (!a || !c) return;
    // 飞行途中不受限制，否则控制器每帧把镜头拽回上限，动画一开始就跳一下
    c.maxDistance = Number.POSITIVE_INFINITY;
    c.maxPolarAngle = WIDE_POLAR;
    const t = Math.min(1, (performance.now() - a.t0) / DURATION);
    const k = ease(t);
    camera.position.lerpVectors(a.fromPos, a.toPos, k);
    c.target.lerpVectors(a.fromTarget, a.toTarget, k);
    c.update();
    if (t >= 1) anim.current = null;
  });

  return null;
}
