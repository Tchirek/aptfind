import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import {
  BufferAttribute,
  DataTexture,
  FloatType,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  RGFormat,
  ShaderMaterial,
  type Vector3,
} from 'three';
import { useApp } from '../app/store';
import { type District, terrainAt } from '../engine/district';
import { flowFactors, pedestrianLoad, roadFlowWeights, vehicleLoad } from '../engine/flows';

/** 地面上各级道路画出的路面宽度（与 groundTexture 一致） */
const ROAD_WIDTH = [26, 20, 14, 9, 6, 3.5] as const;
/** 车流的光点每隔多少米放一个（再按密度决定亮不亮） */
const CAR_SPACING = 14;
const PED_SPACING = 9;
/** 畅通时的车速、步速（米/秒） */
const CAR_SPEED = [16, 13, 11, 9, 6, 4] as const;
const WALK_SPEED = 1.3;

interface Instances {
  a: number[];
  b: number[];
  road: number[];
  rand: number[];
  phase: number[];
  /** 畅通时的速度（米/秒） */
  speed: number[];
}

/** 伪随机：同一份数据每次加载结果相同 */
function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * 沿每条路逐段铺光点：offsets 是各条"车道"（或人行道）相对中线的横向偏移与行进方向，
 * 每个光点记下所在线段的两端、所属道路、一个随机数（决定亮不亮、快慢）与起始相位。
 */
function lay(
  d: District,
  pick: (cls: number) => boolean,
  lanes: (r: District['roads'][number]) => { offset: number; dir: 1 | -1 }[],
  spacing: number,
  lift: number,
  speedOf: (cls: number) => number,
): Instances {
  const out: Instances = { a: [], b: [], road: [], rand: [], phase: [], speed: [] };
  let seed = 1;
  d.roads.forEach((r, ri) => {
    if (!pick(r.cls)) return;
    const p = r.points;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const x0 = p[i] as number;
      const y0 = p[i + 1] as number;
      const x1 = p[i + 2] as number;
      const y1 = p[i + 3] as number;
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (len < 2) continue;
      const nx = -(y1 - y0) / len;
      const ny = (x1 - x0) / len;
      for (const { offset, dir } of lanes(r)) {
        const ax = x0 + nx * offset;
        const ay = y0 + ny * offset;
        const bx = x1 + nx * offset;
        const by = y1 + ny * offset;
        const [sx, sy, ex, ey] = dir === 1 ? [ax, ay, bx, by] : [bx, by, ax, ay];
        const sz = terrainAt(d.terrain, sx, sy) + lift;
        const ez = terrainAt(d.terrain, ex, ey) + lift;
        const n = Math.max(1, Math.round(len / spacing));
        for (let k = 0; k < n; k++) {
          out.a.push(sx, sy, sz);
          out.b.push(ex, ey, ez);
          out.road.push(ri);
          out.rand.push(hash(seed++));
          out.phase.push((k + hash(seed++)) / n);
          out.speed.push(speedOf(r.cls));
        }
      }
    }
  });
  return out;
}

function geometryOf(inst: Instances): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry();
  // 一个单位四边形：x 沿行进方向（−0.5 尾 → 0.5 头），y 横向
  g.setAttribute(
    'position',
    new BufferAttribute(Float32Array.of(-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0), 3),
  );
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.setAttribute('aA', new InstancedBufferAttribute(new Float32Array(inst.a), 3));
  g.setAttribute('aB', new InstancedBufferAttribute(new Float32Array(inst.b), 3));
  g.setAttribute('aRoad', new InstancedBufferAttribute(new Float32Array(inst.road), 1));
  g.setAttribute('aRand', new InstancedBufferAttribute(new Float32Array(inst.rand), 1));
  g.setAttribute('aPhase', new InstancedBufferAttribute(new Float32Array(inst.phase), 1));
  g.setAttribute('aSpeed', new InstancedBufferAttribute(new Float32Array(inst.speed), 1));
  g.instanceCount = inst.rand.length;
  return g;
}

const VERTEX = /* glsl */ `
  attribute vec3 aA;
  attribute vec3 aB;
  attribute float aRoad;
  attribute float aRand;
  attribute float aPhase;
  attribute float aSpeed;
  uniform sampler2D uLoad;
  uniform float uRoads;
  uniform float uTime;
  uniform float uScale;
  uniform vec2 uSize;
  uniform float uSlow;
  varying float vPressure;
  varying vec2 vLocal;
  void main() {
    vec2 load = texture2D(uLoad, vec2((aRoad + 0.5) / uRoads, 0.5)).rg;
    // 密度决定这一个光点亮不亮；不亮的挪到裁剪空间外
    if (aRand > load.x) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    vec3 d3 = aB - aA;
    float len = max(length(d3.xy), 1.0);
    vec2 dir = d3.xy / len;
    vec2 nrm = vec2(-dir.y, dir.x);
    // 越挤越慢
    float speed = aSpeed * mix(1.0, uSlow, load.y) * (0.8 + 0.4 * fract(aRand * 7.31));
    float t = fract(aPhase + uTime * speed / len);
    vec3 p = mix(aA, aB, t);
    p.xy += dir * position.x * uSize.x * uScale + nrm * position.y * uSize.y * uScale;
    vPressure = load.y;
    vLocal = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

function material(fragment: string, size: [number, number], slow: number) {
  const tex = new DataTexture(new Float32Array(2), 1, 1, RGFormat, FloatType);
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uLoad: { value: tex },
      uRoads: { value: 1 },
      uTime: { value: 0 },
      uScale: { value: 1 },
      uSize: { value: size },
      uSlow: { value: slow },
    },
    vertexShader: VERTEX,
    fragmentShader: fragment,
  });
}

/** 车：尾部渐隐的短光条；畅通偏蓝灰，渐挤渐成琥珀，堵成红 */
const CAR_FRAGMENT = /* glsl */ `
  varying float vPressure;
  varying vec2 vLocal;
  void main() {
    // 颜色按 sRGB 写，换成线性再输出（输出时会转回 sRGB）
    vec3 free = pow(vec3(0.62, 0.72, 0.84), vec3(2.2));
    vec3 slow = pow(vec3(0.96, 0.68, 0.22), vec3(2.2));
    vec3 jam = pow(vec3(0.86, 0.2, 0.15), vec3(2.2));
    vec3 c = vPressure < 0.55 ? mix(free, slow, smoothstep(0.3, 0.55, vPressure)) : mix(slow, jam, smoothstep(0.55, 0.85, vPressure));
    float head = smoothstep(-0.5, 0.45, vLocal.x);
    float edge = 1.0 - smoothstep(0.25, 0.5, abs(vLocal.y));
    gl_FragColor = vec4(c, head * edge * 0.9);
    #include <colorspace_fragment>
  }
`;

/** 人：小小的紫色圆点 */
const PED_FRAGMENT = /* glsl */ `
  varying vec2 vLocal;
  void main() {
    float r = length(vLocal) * 2.0;
    if (r > 1.0) discard;
    gl_FragColor = vec4(pow(vec3(0.5, 0.42, 0.95), vec3(2.2)), (1.0 - r * r) * 0.85);
    #include <colorspace_fragment>
  }
`;

/**
 * 道路上的车流与人流：按日期与时刻（跟随时间轴、播放时随之变化）推算每条路的压力，
 * 车是沿车道行进的光条，人是走在两侧人行道上的圆点。
 */
export function Flows({ district }: { district: District }) {
  const date = useApp((s) => s.date);
  const minute = useApp((s) => Math.floor(s.minute / 5) * 5);
  const { camera, controls } = useThree();

  const weights = useMemo(() => roadFlowWeights(district), [district]);

  const cars = useMemo(() => {
    const inst = lay(
      district,
      (c) => c <= 4,
      (r) => {
        const w = ROAD_WIDTH[r.cls] ?? 6;
        if (r.oneway) return [{ offset: 0, dir: r.oneway }];
        return [
          { offset: -w / 4, dir: 1 },
          { offset: w / 4, dir: -1 },
        ];
      },
      CAR_SPACING,
      0.9,
      (c) => CAR_SPEED[c] ?? 6,
    );
    return { geometry: geometryOf(inst), material: material(CAR_FRAGMENT, [7, 1.6], 0.2) };
  }, [district]);

  const people = useMemo(() => {
    const inst = lay(
      district,
      (c) => c >= 1,
      (r) => {
        const side = (ROAD_WIDTH[r.cls] ?? 6) / 2 + 1.2;
        return [
          { offset: side, dir: 1 },
          { offset: side, dir: -1 },
          { offset: -side, dir: 1 },
          { offset: -side, dir: -1 },
        ];
      },
      PED_SPACING * 2,
      0.7,
      () => WALK_SPEED,
    );
    return { geometry: geometryOf(inst), material: material(PED_FRAGMENT, [1.3, 1.3], 0.6) };
  }, [district]);

  useEffect(
    () => () => {
      cars.geometry.dispose();
      cars.material.dispose();
      people.geometry.dispose();
      people.material.dispose();
    },
    [cars, people],
  );

  // 每 5 分钟（或换日期）重算一次各条路的压力，写进一张 1 × N 的浮点纹理
  useEffect(() => {
    const f = flowFactors(date, minute);
    const n = weights.length;
    const car = new Float32Array(n * 2);
    const ped = new Float32Array(n * 2);
    weights.forEach((w, i) => {
      const v = vehicleLoad(w, f.vehicle);
      car[2 * i] = v.density * 0.9;
      car[2 * i + 1] = v.pressure;
      ped[2 * i] = pedestrianLoad(w, f.pedestrian) * 0.8;
      ped[2 * i + 1] = ped[2 * i] as number;
    });
    for (const [m, data] of [
      [cars.material, car],
      [people.material, ped],
    ] as const) {
      const u = m.uniforms as { uLoad: { value: DataTexture }; uRoads: { value: number } };
      u.uLoad.value.dispose();
      const tex = new DataTexture(data, n, 1, RGFormat, FloatType);
      tex.needsUpdate = true;
      u.uLoad.value = tex;
      u.uRoads.value = n;
    }
  }, [date, minute, weights, cars, people]);

  useFrame(() => {
    const t = performance.now() / 1000;
    const target = (controls as unknown as { target?: Vector3 } | null)?.target;
    const dist = target ? camera.position.distanceTo(target) : 1000;
    // 拉远时光点按比例放大，不至于缩成看不见的噪点
    const scale = Math.min(5, Math.max(1, dist / 450));
    for (const m of [cars.material, people.material]) {
      (m.uniforms.uTime as { value: number }).value = t;
      (m.uniforms.uScale as { value: number }).value = scale;
    }
  });

  return (
    <>
      <mesh
        geometry={people.geometry}
        material={people.material}
        renderOrder={9}
        frustumCulled={false}
      />
      <mesh
        geometry={cars.geometry}
        material={cars.material}
        renderOrder={10}
        frustumCulled={false}
      />
    </>
  );
}
