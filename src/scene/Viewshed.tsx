import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BufferAttribute, BufferGeometry, DoubleSide, ShaderMaterial, Vector3 } from 'three';
import { getEngine, type SceneData } from '../app/data';
import { useApp } from '../app/store';
import { type Viewshed as ViewshedData, viewshedFrom } from '../engine/view';

const GROW_MS = 1500;

/**
 * 视域网：每条视线的终点连成一张面，再用扇面把面的四条边连回眼睛，
 * 成为"从这扇窗看得到的空间"的外壳。顶点只存方向与长度，位置在着色器里按展开进度算，
 * 视域就从窗口向外涨开。
 */
function viewshedGeometry(v: ViewshedData): BufferGeometry {
  const { cols, rows } = v;
  const n = cols * rows;
  // 最后一个顶点是眼睛
  const dir = new Float32Array((n + 1) * 3);
  dir.set(v.dirs);
  const dist = new Float32Array(n + 1);
  dist.set(v.dist);
  const hit = new Float32Array(n + 1);
  const uv = new Float32Array((n + 1) * 2);
  for (let k = 0; k < n; k++) {
    hit[k] = (v.owner[k] as number) === -1 ? 0 : 1;
    uv[2 * k] = (k % cols) / (cols - 1);
    uv[2 * k + 1] = Math.floor(k / cols) / (rows - 1);
  }
  hit[n] = 1;
  uv[2 * n] = 0.5;
  uv[2 * n + 1] = 0.5;

  const index: number[] = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      index.push(a, a + 1, a + cols, a + 1, a + cols + 1, a + cols);
    }
  }
  // 四条边连回眼睛
  const eye = n;
  for (let c = 0; c < cols - 1; c++) {
    index.push(eye, c, c + 1);
    index.push(eye, (rows - 1) * cols + c + 1, (rows - 1) * cols + c);
  }
  for (let r = 0; r < rows - 1; r++) {
    index.push(eye, (r + 1) * cols, r * cols);
    index.push(eye, r * cols + cols - 1, (r + 1) * cols + cols - 1);
  }

  const g = new BufferGeometry();
  const pos = new Float32Array((n + 1) * 3);
  for (let k = 0; k <= n; k++) {
    for (let a = 0; a < 3; a++) {
      pos[3 * k + a] = (v.eye[a] as number) + (dir[3 * k + a] as number) * (dist[k] as number);
    }
  }
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('aDir', new BufferAttribute(dir, 3));
  g.setAttribute('aDist', new BufferAttribute(dist, 1));
  g.setAttribute('aHit', new BufferAttribute(hit, 1));
  g.setAttribute('aUv', new BufferAttribute(uv, 2));
  g.setIndex(index);
  return g;
}

function viewshedMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    // 命中处与外墙几乎共面，再往镜头方向让一点，免得转动镜头时与外墙争深度而闪烁
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
    uniforms: {
      uEye: { value: new Vector3() },
      uReveal: { value: 0 },
      uFar: { value: 900 },
      uGrid: { value: [68, 40] },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aDir;
      attribute float aDist;
      attribute float aHit;
      attribute vec2 aUv;
      uniform vec3 uEye;
      uniform float uReveal;
      varying float vD;
      varying float vHit;
      varying float vFront;
      varying vec2 vUv;
      void main() {
        // 打在楼或地上的点往眼睛方向收回一点（远处收得多些，深度精度差），不与外墙共面
        float pull = aHit > 0.5 ? min(3.0, 0.3 + aDist * 0.004) : 0.0;
        float d = min(max(aDist - pull, 0.0), uReveal);
        vD = d;
        vHit = aHit;
        // 还没涨到命中处的顶点停在波前上
        vFront = step(uReveal, aDist - 0.01);
        vUv = aUv;
        vec3 p = uEye + aDir * d;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uFar;
      uniform vec2 uGrid;
      varying float vD;
      varying float vHit;
      varying float vFront;
      varying vec2 vUv;
      void main() {
        float t = clamp(vD / uFar, 0.0, 1.0);
        // 近处亮青，远处深蓝
        vec3 col = mix(vec3(0.55, 0.88, 1.0), vec3(0.16, 0.42, 0.92), sqrt(t));
        // 经纬细线：每 4 格一条
        vec2 g = vUv * uGrid / 4.0;
        vec2 w = fwidth(g);
        vec2 f = abs(fract(g + 0.5) - 0.5);
        vec2 l = 1.0 - smoothstep(vec2(0.0), w * 1.5, f);
        // 掠射角下一个像素里挤了好几条线，会闪成摩尔纹，这时淡掉
        float line = max(l.x, l.y) * (1.0 - smoothstep(0.12, 0.45, max(w.x, w.y)));
        // 打在楼或地面上的部分实一些；一直看到最远的天空部分只留一层薄雾
        float a = mix(0.05, mix(0.4, 0.2, t), vHit);
        a += line * mix(0.05, 0.35, vHit) * (1.0 - t * 0.6);
        col = mix(col, vec3(1.0), line * 0.6);
        // 波前发亮
        a = mix(a, 0.55, vFront * (1.0 - t));
        gl_FragColor = vec4(col, a);
        #include <colorspace_fragment>
      }
    `,
  });
}

/** 再点一次已选中的窗：从这扇窗看出去，视线能到达的空间 */
export function Viewshed({ data }: { data: SceneData }) {
  const index = useApp((s) => s.viewshed);
  const [shed, setShed] = useState<ViewshedData | null>(null);
  const material = useMemo(() => viewshedMaterial(), []);
  const start = useRef(0);

  useEffect(() => {
    if (index === null) {
      setShed(null);
      return;
    }
    let alive = true;
    getEngine().then((engine) => {
      if (!alive) return;
      setShed(viewshedFrom(engine, data.grid, index));
      start.current = performance.now();
    });
    return () => {
      alive = false;
    };
  }, [data, index]);

  const geometry = useMemo(() => (shed ? viewshedGeometry(shed) : null), [shed]);
  useEffect(() => () => geometry?.dispose(), [geometry]);

  useFrame(() => {
    if (!shed) return;
    const u = material.uniforms as {
      uEye: { value: Vector3 };
      uReveal: { value: number };
      uFar: { value: number };
      uGrid: { value: number[] };
    };
    u.uEye.value.set(shed.eye[0], shed.eye[1], shed.eye[2]);
    u.uFar.value = shed.far;
    u.uGrid.value = [shed.cols - 1, shed.rows - 1];
    const k = Math.min(1, (performance.now() - start.current) / GROW_MS);
    // 先快后慢：近处一下子铺开，远处慢慢涨到头
    u.uReveal.value = k >= 1 ? shed.far + 1 : shed.far * (1 - (1 - k) ** 3);
  });

  if (!geometry) return null;
  return <mesh geometry={geometry} material={material} renderOrder={14} frustumCulled={false} />;
}
