import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataUtils,
  Fog,
  type Mesh,
  type Points,
  ShaderMaterial,
  Vector3,
} from 'three';
import { useApp } from '../app/store';
import { beijingToUtc, SITE, sunAt } from '../app/time';
import { sunDirectionEnu } from '../engine/solar';
import {
  buildSkyLut,
  EXPOSURE,
  LUT_H,
  LUT_W,
  lutRingAverage,
  sunTransmittance,
} from './atmosphere';
import { sceneUniforms } from './lighting';
import { skyLookupGlsl, skyUniforms } from './skyLayer';

/** 天空着色、太阳圆盘、夜空底色共用的状态，Sun 读取它来定光色 */
export const skyState = {
  /** 地平线一圈的平均天色（已曝光线性 RGB），雾与远景用 */
  horizon: new Color('#dfe6e8'),
  /** 天顶附近的平均天色，环境光用 */
  zenith: new Color('#8fa9c4'),
  /** 太阳直射光穿过大气后的颜色（最大分量归一） */
  sunColor: new Color('#fff6ea'),
};

const NIGHT_SKY = new Color(0.006, 0.009, 0.02);

function skyDomeMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      ...skyUniforms,
      uSunDir: { value: new Vector3(0, 1, 0) },
      uSunColor: { value: new Color() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      ${skyLookupGlsl}
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = jgSkyColor(d);
        // 太阳圆盘：视半径约 0.27°，画成 0.5° 便于看见，边缘柔一点
        float cosA = dot(d, normalize(uSunDir));
        float disk = smoothstep(0.99995, 0.999975, cosA);
        c += uSunColor * disk;
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
}

/** B−V 色指数 → 星的颜色（近似黑体，偏淡） */
function starColor(ci: number): [number, number, number] {
  const t = Math.min(1, Math.max(0, (ci + 0.2) / 1.8));
  // 蓝白 → 白 → 橙
  const r = 0.72 + 0.28 * Math.min(1, t * 1.6);
  const g = 0.8 + 0.15 * Math.sin(Math.PI * t) - 0.1 * t;
  const b = 1 - 0.55 * t;
  return [r, g, b];
}

interface StarCatalog {
  stars: [number, number, number, number][];
}

/** 格林尼治平恒星时（度） */
function gmstDeg(utcMs: number): number {
  const jd = utcMs / 86_400_000 + 2440587.5;
  return (((280.46061837 + 360.98564736629 * (jd - 2451545.0)) % 360) + 360) % 360;
}

function starMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
    uniforms: { uNight: sceneUniforms.uNight, uPixel: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float aMag;
      attribute vec3 aColor;
      uniform float uPixel;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vColor = aColor;
        // 越亮越大；近地平线有消光
        float alt = normalize(position).y;
        vAlpha = clamp(1.25 - aMag * 0.2, 0.15, 1.0) * smoothstep(0.0, 0.18, alt);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
        gl_PointSize = clamp(3.4 - aMag * 0.55, 1.0, 3.6) * uPixel;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uNight;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec2 q = gl_PointCoord * 2.0 - 1.0;
        float r = dot(q, q);
        if (r > 1.0) discard;
        float a = (1.0 - r) * vAlpha * smoothstep(0.55, 0.95, uNight);
        gl_FragColor = vec4(vColor * a, a);
      }
    `,
  });
}

const DOME_RADIUS = 1000;

/**
 * 天空：大气散射查找表 + 太阳圆盘 + 夜里按日期时刻算出真实位置的亮星。
 * 查找表只在太阳挪动超过约 0.2° 时重算（播放时至多每 120 ms 一次）。
 */
export function Sky() {
  const date = useApp((s) => s.date);
  const minute = useApp((s) => s.minute);
  const { camera, scene, gl } = useThree();
  const dome = useRef<Mesh>(null);
  const starsRef = useRef<Points>(null);
  const material = useMemo(() => skyDomeMaterial(), []);
  const starMat = useMemo(() => starMaterial(), []);

  const sunEnu = useMemo(() => {
    const p = sunAt(date, minute);
    return sunDirectionEnu(p.azimuth, p.apparentElevation);
  }, [date, minute]);

  // 场景雾：远近随镜头距离调整（在 Sun 里），颜色按方位查表（skyLayer），这里只保证有一个 Fog
  useEffect(() => {
    if (!(scene.fog instanceof Fog)) scene.fog = new Fog(skyState.horizon.clone(), 3000, 9000);
    scene.background = null;
  }, [scene]);

  const lut = useRef({ data: new Float32Array(LUT_W * LUT_H * 4), sun: [0, 0, -2], at: 0 });
  const pending = useRef(true);
  // sunEnu 只是"太阳动了"的信号，查表在 useFrame 里按限频重算
  // biome-ignore lint/correctness/useExhaustiveDependencies: 依赖即触发条件
  useEffect(() => {
    pending.current = true;
  }, [sunEnu]);

  useFrame(() => {
    dome.current?.position.copy(camera.position);
    starsRef.current?.position.copy(camera.position);
    const L = lut.current;
    const now = performance.now();
    if (!pending.current || now - L.at < 120) return;
    const [x, y, z] = sunEnu;
    const moved = Math.acos(
      Math.min(1, x * (L.sun[0] as number) + y * (L.sun[1] as number) + z * (L.sun[2] as number)),
    );
    pending.current = false;
    if (moved < 0.0035 && L.at > 0) return;
    L.sun = [x, y, z];
    L.at = now;
    buildSkyLut(sunEnu, L.data);
    const tex = skyUniforms.uSkyLut.value;
    const half = tex.image.data as Uint16Array;
    for (let i = 0; i < L.data.length; i++) half[i] = DataUtils.toHalfFloat(L.data[i] as number);
    tex.needsUpdate = true;

    const night = sceneUniforms.uNight.value;
    skyUniforms.uSkyNight.value.copy(NIGHT_SKY).multiplyScalar(night);
    const hz = lutRingAverage(L.data, 1);
    const zen = lutRingAverage(L.data, LUT_H - 3);
    skyState.horizon.setRGB(hz[0], hz[1], hz[2]).add(skyUniforms.uSkyNight.value);
    skyState.zenith.setRGB(zen[0], zen[1], zen[2]).add(skyUniforms.uSkyNight.value);
    if (scene.fog instanceof Fog) scene.fog.color.copy(skyState.horizon);

    const t = sunTransmittance(sunEnu);
    const m = Math.max(t[0], t[1], t[2], 1e-4);
    skyState.sunColor.setRGB(t[0] / m, t[1] / m, t[2] / m);
    const u = material.uniforms as { uSunDir: { value: Vector3 }; uSunColor: { value: Color } };
    u.uSunDir.value.set(x, z, -y);
    // 太阳圆盘亮度随透射率变化，落山后消失
    u.uSunColor.value.setRGB(
      1 - Math.exp(-t[0] * 30 * EXPOSURE),
      1 - Math.exp(-t[1] * 30 * EXPOSURE),
      1 - Math.exp(-t[2] * 30 * EXPOSURE),
    );
  });

  // 亮星：赤道坐标 → 地平坐标，随日期时刻更新
  const [catalog, setCatalog] = useState<StarCatalog | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`${import.meta.env.BASE_URL}data/stars.json`)
      .then((r) => r.json() as Promise<StarCatalog>)
      .then((c) => {
        if (alive) setCatalog(c);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const starGeometry = useMemo(() => {
    if (!catalog) return null;
    const n = catalog.stars.length;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3));
    const mag = new Float32Array(n);
    const col = new Float32Array(n * 3);
    catalog.stars.forEach((s, i) => {
      mag[i] = s[2];
      col.set(starColor(s[3]), i * 3);
    });
    g.setAttribute('aMag', new BufferAttribute(mag, 1));
    g.setAttribute('aColor', new BufferAttribute(col, 3));
    return g;
  }, [catalog]);

  useEffect(() => {
    if (!catalog || !starGeometry) return;
    const lst = gmstDeg(beijingToUtc(date, minute)) + SITE.lon;
    const phi = (SITE.lat * Math.PI) / 180;
    const pos = starGeometry.getAttribute('position') as BufferAttribute;
    const arr = pos.array as Float32Array;
    catalog.stars.forEach(([ra, dec], i) => {
      const h = ((lst - ra) * Math.PI) / 180;
      const d = (dec * Math.PI) / 180;
      const sinAlt = Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(h);
      const alt = Math.asin(sinAlt);
      const az = Math.atan2(
        -Math.sin(h) * Math.cos(d),
        Math.cos(phi) * Math.sin(d) - Math.sin(phi) * Math.cos(d) * Math.cos(h),
      );
      const c = Math.cos(alt);
      const e = c * Math.sin(az);
      const nn = c * Math.cos(az);
      arr.set([e * DOME_RADIUS * 0.9, sinAlt * DOME_RADIUS * 0.9, -nn * DOME_RADIUS * 0.9], i * 3);
    });
    pos.needsUpdate = true;
    starGeometry.computeBoundingSphere();
  }, [catalog, starGeometry, date, minute]);

  useEffect(() => {
    (starMat.uniforms.uPixel as { value: number }).value = gl.getPixelRatio();
  }, [gl, starMat]);

  return (
    <>
      <mesh ref={dome} material={material} renderOrder={-10} frustumCulled={false}>
        <sphereGeometry args={[DOME_RADIUS, 48, 24]} />
      </mesh>
      {starGeometry && (
        <points
          ref={starsRef}
          geometry={starGeometry}
          material={starMat}
          renderOrder={-9}
          frustumCulled={false}
        />
      )}
    </>
  );
}
