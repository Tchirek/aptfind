import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { BufferAttribute, BufferGeometry, Color, ShaderMaterial, type Vector3 } from 'three';
import type { Reach as ReachData } from '../app/reach';
import { useApp } from '../app/store';
import { type District, terrainAt } from '../engine/district';
import { sceneUniforms } from './lighting';
import { boxOf, fieldTexture, reachUniforms } from './reachLayer';

/** 范围从 0 长到预算值所用的时间（毫秒） */
const GROW_MS = 2600;
const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** 乘车轨迹：沿轨道的一条带子，宽度在着色器里按镜头距离给，随 uReveal 从起点亮到终点 */
function trailGeometry(reach: ReachData, district: District): BufferGeometry | null {
  const pos: number[] = [];
  const nrm: number[] = [];
  const side: number[] = [];
  const time: number[] = [];
  const color: number[] = [];
  const index: number[] = [];
  const c = new Color();
  const t = district.terrain;
  const x1 = t.x0 + (t.nx - 1) * t.step;
  const y1 = t.y0 + (t.ny - 1) * t.step;
  for (const trail of reach.trails) {
    c.set(trail.colour);
    const n = trail.times.length;
    const base = pos.length / 3;
    for (let k = 0; k < n; k++) {
      const x = trail.points[2 * k] as number;
      const y = trail.points[2 * k + 1] as number;
      const a = Math.max(0, k - 1);
      const b = Math.min(n - 1, k + 1);
      const dx = (trail.points[2 * b] as number) - (trail.points[2 * a] as number);
      const dy = (trail.points[2 * b + 1] as number) - (trail.points[2 * a + 1] as number);
      const len = Math.hypot(dx, dy) || 1;
      const inside = x >= t.x0 && x <= x1 && y >= t.y0 && y <= y1;
      const z = (inside ? terrainAt(t, x, y) : 0) + 3;
      for (const s of [-1, 1]) {
        pos.push(x, y, z);
        nrm.push(-dy / len, dx / len);
        side.push(s);
        time.push(trail.times[k] as number);
        color.push(c.r, c.g, c.b);
      }
      if (k < n - 1) {
        const v = base + 2 * k;
        index.push(v, v + 1, v + 3, v, v + 3, v + 2);
      }
    }
  }
  if (!pos.length) return null;
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aNormal', new BufferAttribute(new Float32Array(nrm), 2));
  g.setAttribute('aSide', new BufferAttribute(new Float32Array(side), 1));
  g.setAttribute('aTime', new BufferAttribute(new Float32Array(time), 1));
  g.setAttribute('aColor', new BufferAttribute(new Float32Array(color), 3));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}

const trailUniforms = {
  uWidth: { value: 12 },
};

function trailMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      ...trailUniforms,
      uReveal: reachUniforms.uReachReveal,
      uBudget: reachUniforms.uReachBudget,
      uNight: sceneUniforms.uNight,
    },
    vertexShader: /* glsl */ `
      attribute vec2 aNormal;
      attribute float aSide;
      attribute float aTime;
      attribute vec3 aColor;
      uniform float uWidth;
      varying float vSide;
      varying float vTime;
      varying vec3 vColor;
      void main() {
        vSide = aSide;
        vTime = aTime;
        vColor = aColor;
        vec3 p = position + vec3(aNormal * aSide * uWidth * 0.5, 0.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uReveal;
      uniform float uBudget;
      uniform float uNight;
      varying float vSide;
      varying float vTime;
      varying vec3 vColor;
      void main() {
        if (vTime > uReveal) discard;
        float d = abs(vSide);
        // 中间是线路色，两侧一圈白边，在浅色底图和夜色上都看得清
        float body = 1.0 - smoothstep(0.55, 0.7, d);
        float rim = 1.0 - smoothstep(0.85, 1.0, d);
        float growing = 1.0 - step(uBudget + 0.5, uReveal);
        float head = exp(-pow((uReveal - vTime) / 0.5, 2.0)) * growing;
        vec3 c = mix(vec3(1.0), vColor, body);
        c = mix(c, vec3(1.0, 0.97, 0.88), head * 0.8);
        gl_FragColor = vec4(c, rim);
        #include <colorspace_fragment>
      }
    `,
  });
}

/**
 * 选中楼的可达范围：地面上的两条等时线与渐变填色（见 reachLayer），坐地铁的那几段沿轨道亮起，
 * 能出站的车站标上名字与出站时刻。新结果到来时，范围用约 2.6 秒从楼脚下沿街长出来。
 */
export function Reach({ district }: { district: District }) {
  const reach = useApp((s) => s.reach);
  const { camera, controls } = useThree();
  const start = useRef(0);

  useEffect(() => {
    const u = reachUniforms;
    if (!reach) {
      u.uReachOn.value = 0;
      return;
    }
    const near = reach.near ? fieldTexture(reach.near) : null;
    const far = reach.far ? fieldTexture(reach.far) : null;
    if (near && reach.near) {
      u.uReachNear.value = near;
      u.uReachNearBox.value.copy(boxOf(reach.near));
    }
    if (far && reach.far) {
      u.uReachFar.value = far;
      u.uReachFarBox.value.copy(boxOf(reach.far));
    }
    u.uReachBudget.value = reach.budget;
    u.uReachReveal.value = 0;
    u.uReachOn.value = 1;
    start.current = performance.now();
    return () => {
      near?.dispose();
      far?.dispose();
    };
  }, [reach]);

  const trails = useMemo(() => (reach ? trailGeometry(reach, district) : null), [reach, district]);
  useEffect(() => () => trails?.dispose(), [trails]);
  const material = useMemo(() => trailMaterial(), []);

  useFrame(() => {
    if (!reach) return;
    const k = Math.min(1, (performance.now() - start.current) / GROW_MS);
    reachUniforms.uReachReveal.value = k < 1 ? easeOut(k) * (reach.budget + 0.6) : reach.budget + 1;
    const target = (controls as unknown as { target?: Vector3 } | null)?.target;
    const dist = target ? camera.position.distanceTo(target) : 1000;
    trailUniforms.uWidth.value = Math.min(280, Math.max(8, dist * 0.011));
  });

  if (!reach) return null;
  return (
    <group>
      {trails && <mesh geometry={trails} material={material} renderOrder={12} />}
      {reach.stations.map((s) => (
        <Html
          key={s.name}
          position={[s.x, s.y, 12]}
          center
          zIndexRange={[20, 10]}
          className="map-label station"
        >
          {s.name}
          <small>{Math.round(s.exit)} 分</small>
        </Html>
      ))}
    </group>
  );
}
