import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import {
  BufferAttribute,
  Color,
  DataTexture,
  FloatType,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  RedFormat,
  ShaderMaterial,
  type Vector3,
} from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { useApp } from '../app/store';
import { dayInfo } from '../engine/calendar';
import { type District, terrainAt } from '../engine/district';
import {
  flowFactors,
  pedestrianLoad,
  roadFlowWeights,
  tidalFactor,
  trafficLevel,
  vehicleLoad,
} from '../engine/flows';
import { CROWD_COLOR, TRAFFIC_COLORS } from './trafficStyle';

/** 地面上各级道路画出的路面宽度（与 groundTexture 一致） */
const ROAD_WIDTH = [26, 20, 14, 9, 6, 3.5] as const;
const LEVEL_COLORS = TRAFFIC_COLORS.map((c) => new Color(c));

/** 路况线：每条车行方向一段，记下所属道路与行车方向，换时刻时重新着色 */
interface TrafficSegments {
  positions: Float32Array;
  road: Int32Array;
  dir: Float32Array;
}

/**
 * 干道（支路及以上）逐段铺路况线。双向路分成两条：中国靠右行驶，
 * 顺折线方向的车走折线右侧，逆向的走左侧；单行路（OSM 里分幅的干道多是这样）只一条，画在中线上。
 */
function traffic(d: District): TrafficSegments {
  const pos: number[] = [];
  const road: number[] = [];
  const dir: number[] = [];
  d.roads.forEach((r, ri) => {
    if (r.cls > 3) return;
    const half = (ROAD_WIDTH[r.cls] ?? 9) / 4;
    const lanes: [number, 1 | -1][] = r.oneway
      ? [[0, r.oneway]]
      : [
          [half, 1],
          [-half, -1],
        ];
    const p = r.points;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const x0 = p[i] as number;
      const y0 = p[i + 1] as number;
      const x1 = p[i + 2] as number;
      const y1 = p[i + 3] as number;
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (len < 0.5) continue;
      const ux = (x1 - x0) / len;
      const uy = (y1 - y0) / len;
      // 行进方向的右手法向
      const rx = uy;
      const ry = -ux;
      for (const [off, s] of lanes) {
        const ax = x0 + rx * off;
        const ay = y0 + ry * off;
        const bx = x1 + rx * off;
        const by = y1 + ry * off;
        pos.push(
          ax,
          ay,
          terrainAt(d.terrain, ax, ay) + 1,
          bx,
          by,
          terrainAt(d.terrain, bx, by) + 1,
        );
        road.push(ri);
        dir.push(s * ux, s * uy);
      }
    }
  });
  return {
    positions: Float32Array.from(pos),
    road: Int32Array.from(road),
    dir: Float32Array.from(dir),
  };
}

/** 人流热度：沿两侧人行道每隔一段放一个柔和的圆斑，叠起来就是一条由浅到深的热度带 */
function crowdGeometry(d: District): InstancedBufferGeometry {
  const center: number[] = [];
  const road: number[] = [];
  const SPACING = 12;
  d.roads.forEach((r, ri) => {
    if (r.cls < 1) return;
    const side = (ROAD_WIDTH[r.cls] ?? 6) / 2 + 2;
    const p = r.points;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const x0 = p[i] as number;
      const y0 = p[i + 1] as number;
      const x1 = p[i + 2] as number;
      const y1 = p[i + 3] as number;
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (len < 1) continue;
      const nx = (y1 - y0) / len;
      const ny = -(x1 - x0) / len;
      const n = Math.max(1, Math.round(len / SPACING));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const x = x0 + (x1 - x0) * t;
        const y = y0 + (y1 - y0) * t;
        for (const s of [1, -1]) {
          const cx = x + nx * side * s;
          const cy = y + ny * side * s;
          center.push(cx, cy, terrainAt(d.terrain, cx, cy) + 0.6);
          road.push(ri);
        }
      }
    }
  });
  const g = new InstancedBufferGeometry();
  g.setAttribute(
    'position',
    new BufferAttribute(Float32Array.of(-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0), 3),
  );
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.setAttribute('aCenter', new InstancedBufferAttribute(Float32Array.from(center), 3));
  g.setAttribute('aRoad', new InstancedBufferAttribute(Float32Array.from(road), 1));
  g.instanceCount = road.length;
  return g;
}

function crowdMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
    uniforms: {
      uLoad: { value: new DataTexture(new Float32Array(1), 1, 1, RedFormat, FloatType) },
      uRoads: { value: 1 },
      uRadius: { value: 18 },
      uColor: { value: new Color(CROWD_COLOR) },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aCenter;
      attribute float aRoad;
      uniform sampler2D uLoad;
      uniform float uRoads;
      uniform float uRadius;
      varying vec2 vUv;
      varying float vLoad;
      void main() {
        vLoad = texture2D(uLoad, vec2((aRoad + 0.5) / uRoads, 0.5)).r;
        // 冷清的街不画，省得满城都是一层薄雾
        if (vLoad < 0.3) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        vUv = position.xy;
        vec3 p = aCenter + vec3(position.xy * uRadius, 0.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying vec2 vUv;
      varying float vLoad;
      void main() {
        float r2 = dot(vUv, vUv);
        if (r2 > 1.0) discard;
        // 高斯形的圆斑，越热闹越浓
        float a = exp(-r2 * 3.5) * smoothstep(0.3, 0.95, vLoad) * 0.085;
        gl_FragColor = vec4(uColor, a);
        #include <colorspace_fragment>
      }
    `,
  });
}

/**
 * 路况与人流热度：跟着时间轴的日期与时刻（每 5 分钟）重算。
 * 路况是沿车行方向的彩色线，宽度按屏幕像素不随远近变化；人流是人行道两侧的紫色热度带。
 */
export function Traffic({ district }: { district: District }) {
  const date = useApp((s) => s.date);
  const minute = useApp((s) => Math.floor(s.minute / 5) * 5);
  const showTraffic = useApp((s) => s.layers.traffic);
  const showCrowd = useApp((s) => s.layers.crowd);
  const { camera, controls, size } = useThree();

  const weights = useMemo(() => roadFlowWeights(district), [district]);

  const lines = useMemo(() => {
    const seg = traffic(district);
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(seg.positions);
    geometry.setColors(new Float32Array(seg.positions.length));
    const material = new LineMaterial({
      vertexColors: true,
      linewidth: 3,
      worldUnits: false,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    material.polygonOffset = true;
    material.polygonOffsetFactor = -2;
    material.polygonOffsetUnits = -4;
    const object = new LineSegments2(geometry, material);
    object.frustumCulled = false;
    object.renderOrder = 11;
    return { seg, geometry, material, object };
  }, [district]);

  const crowd = useMemo(
    () => ({ geometry: crowdGeometry(district), material: crowdMaterial() }),
    [district],
  );

  useEffect(
    () => () => {
      lines.geometry.dispose();
      lines.material.dispose();
      crowd.geometry.dispose();
      crowd.material.dispose();
    },
    [lines, crowd],
  );

  useEffect(() => {
    lines.material.resolution.set(size.width, size.height);
  }, [lines, size.width, size.height]);

  // 换时刻：给每段路况线上色，人流写进 1 × N 的纹理
  useEffect(() => {
    const f = flowFactors(date, minute);
    const work = dayInfo(date).kind === 'work';
    const { seg } = lines;
    const pressure = weights.map((w) => vehicleLoad(w, f.vehicle).pressure);
    const colors = new Float32Array(seg.road.length * 6);
    for (let k = 0; k < seg.road.length; k++) {
      const p =
        (pressure[seg.road[k] as number] ?? 0) *
        tidalFactor(seg.dir[2 * k] as number, seg.dir[2 * k + 1] as number, minute, work);
      const c = LEVEL_COLORS[trafficLevel(p)] as Color;
      colors.set([c.r, c.g, c.b, c.r, c.g, c.b], 6 * k);
    }
    lines.geometry.setColors(colors);

    const load = Float32Array.from(weights, (w) => pedestrianLoad(w, f.pedestrian));
    const u = crowd.material.uniforms as {
      uLoad: { value: DataTexture };
      uRoads: { value: number };
    };
    u.uLoad.value.dispose();
    const tex = new DataTexture(load, load.length, 1, RedFormat, FloatType);
    tex.needsUpdate = true;
    u.uLoad.value = tex;
    u.uRoads.value = load.length;
  }, [date, minute, weights, lines, crowd]);

  useFrame(() => {
    const target = (controls as unknown as { target?: Vector3 } | null)?.target;
    const dist = target ? camera.position.distanceTo(target) : 1000;
    // 近处粗一些、远处细一些，始终是几个像素
    lines.material.linewidth = Math.min(4.5, Math.max(2, 5 - dist / 900));
    (crowd.material.uniforms.uRadius as { value: number }).value = Math.min(
      30,
      Math.max(12, dist / 80),
    );
  });

  return (
    <>
      {showCrowd && (
        <mesh
          geometry={crowd.geometry}
          material={crowd.material}
          renderOrder={9}
          frustumCulled={false}
        />
      )}
      {showTraffic && <primitive object={lines.object} />}
    </>
  );
}
