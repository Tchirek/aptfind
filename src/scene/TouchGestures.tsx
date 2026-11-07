import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { Plane, Raycaster, Spherical, Vector2, Vector3 } from 'three';

interface ControlsLike {
  enabled: boolean;
  target: Vector3;
  minDistance: number;
  maxDistance: number;
  minPolarAngle: number;
  maxPolarAngle: number;
  update: () => void;
}

/** 手指移动多少像素后判定手势 */
const DECIDE_PX = 12;

/**
 * 手机上的双指手势，照 Google 地图、Mapbox 的习惯：
 * - 两指平行上下推：调俯仰（往上推，视线放平）；
 * - 两指捏合：缩放；两指转动：转方向；两指一起挪：平移。
 * 动了十来个像素后锁定是"俯仰"还是"缩放旋转平移"，免得互相串。
 * 单指仍交给 MapControls 平移；双指期间暂停它，所有手指抬起后再交还。
 */
export function TouchGestures() {
  const { camera, gl, controls, size } = useThree();

  useEffect(() => {
    const c = controls as unknown as ControlsLike | null;
    if (!c) return;
    const root = gl.domElement.parentElement ?? gl.domElement;
    const pts = new Map<number, Vector2>();
    const start = new Map<number, Vector2>();
    let mode: 'none' | 'undecided' | 'pitch' | 'roto' = 'none';
    let prev: { d: number; a: number; cx: number; cy: number } | null = null;
    let pitchFrom = 0;
    let pitchY = 0;
    let frame = 0;

    const ray = new Raycaster();
    const plane = new Plane(new Vector3(0, 1, 0), 0);
    const ndc = new Vector2();
    const hitA = new Vector3();
    const hitB = new Vector3();
    const offset = new Vector3();
    const sph = new Spherical();

    const pair = () => {
      const [a, b] = [...pts.values()] as [Vector2, Vector2];
      return {
        d: a.distanceTo(b),
        a: Math.atan2(b.y - a.y, b.x - a.x),
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
      };
    };

    const ground = (x: number, y: number, out: Vector3) => {
      const r = root.getBoundingClientRect();
      ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      plane.constant = -c.target.y;
      return ray.ray.intersectPlane(plane, out);
    };

    const place = () => {
      offset.setFromSpherical(sph);
      camera.position.copy(c.target).add(offset);
      camera.lookAt(c.target);
    };

    const apply = () => {
      frame = 0;
      if (pts.size !== 2 || !prev) return;
      const now = pair();
      if (mode === 'undecided') {
        const ids = [...pts.keys()];
        const v = ids.map((id) => {
          const p = pts.get(id) as Vector2;
          const s = start.get(id) as Vector2;
          return new Vector2(p.x - s.x, p.y - s.y);
        }) as [Vector2, Vector2];
        if (Math.max(v[0].length(), v[1].length()) < DECIDE_PX) return;
        const vertical = (u: Vector2) => Math.abs(u.y) > 1.6 * Math.abs(u.x);
        const together = v[0].y * v[1].y > 0;
        const spread = Math.abs(now.d - prev.d) / Math.max(1, prev.d);
        mode = vertical(v[0]) && vertical(v[1]) && together && spread < 0.12 ? 'pitch' : 'roto';
        offset.copy(camera.position).sub(c.target);
        sph.setFromVector3(offset);
        pitchFrom = sph.phi;
        pitchY = now.cy;
        prev = now;
        return;
      }
      offset.copy(camera.position).sub(c.target);
      sph.setFromVector3(offset);
      if (mode === 'pitch') {
        // 往上推（y 变小）视线放平：极角变大；推满一屏约转 90°
        const dphi = ((pitchY - now.cy) / size.height) * Math.PI * 0.55;
        sph.phi = Math.min(
          c.maxPolarAngle,
          Math.max(Math.max(0.05, c.minPolarAngle), pitchFrom + dphi),
        );
        place();
      } else {
        // 捏合缩放、转动旋转，都绕当前目标点
        sph.radius = Math.min(
          c.maxDistance,
          Math.max(c.minDistance, sph.radius * (prev.d / Math.max(1, now.d))),
        );
        let da = now.a - prev.a;
        if (da > Math.PI) da -= 2 * Math.PI;
        if (da < -Math.PI) da += 2 * Math.PI;
        sph.theta += da;
        place();
        // 平移：上一帧两指中点下的地面点，挪到这一帧的中点下
        if (ground(prev.cx, prev.cy, hitA) && ground(now.cx, now.cy, hitB)) {
          hitA.sub(hitB);
          c.target.add(hitA);
          camera.position.add(hitA);
        }
      }
      c.update();
      prev = now;
    };

    const inside = (e: PointerEvent) => e.target instanceof Node && root.contains(e.target);

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !inside(e)) return;
      const p = new Vector2(e.clientX, e.clientY);
      pts.set(e.pointerId, p);
      start.set(e.pointerId, p.clone());
      if (pts.size === 2) {
        // 第二根手指落下：MapControls 先停，这根手指的按下也不交给它
        c.enabled = false;
        e.stopImmediatePropagation();
        for (const [id, q] of pts) start.set(id, q.clone());
        mode = 'undecided';
        prev = pair();
      } else if (pts.size > 2) {
        e.stopImmediatePropagation();
      }
    };
    const onMove = (e: PointerEvent) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      p.set(e.clientX, e.clientY);
      if (mode !== 'none') {
        e.stopImmediatePropagation();
        if (!frame) frame = requestAnimationFrame(apply);
      }
    };
    const onUp = (e: PointerEvent) => {
      if (!pts.delete(e.pointerId)) return;
      start.delete(e.pointerId);
      if (pts.size < 2 && mode !== 'none') {
        // 双指结束：剩下那根手指不再接着平移，等全部抬起
        mode = 'none';
        prev = null;
      }
      if (pts.size === 0) c.enabled = true;
    };

    const opts = { capture: true } as const;
    window.addEventListener('pointerdown', onDown, opts);
    window.addEventListener('pointermove', onMove, opts);
    window.addEventListener('pointerup', onUp, opts);
    window.addEventListener('pointercancel', onUp, opts);
    return () => {
      window.removeEventListener('pointerdown', onDown, opts);
      window.removeEventListener('pointermove', onMove, opts);
      window.removeEventListener('pointerup', onUp, opts);
      window.removeEventListener('pointercancel', onUp, opts);
      if (frame) cancelAnimationFrame(frame);
      c.enabled = true;
    };
  }, [camera, gl, controls, size.height]);

  return null;
}
