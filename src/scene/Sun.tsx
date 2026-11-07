import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  BackSide,
  Color,
  type DirectionalLight,
  Fog,
  type HemisphereLight,
  type Mesh,
  ShaderMaterial,
  Vector3,
} from 'three';
import { useApp } from '../app/store';
import { sunAt } from '../app/time';
import { sunDirectionEnu } from '../engine/solar';
import { enuToWorld } from './coords';
import { lightPreset, litShare, sceneUniforms } from './lighting';

/** 天空：按视线仰角在地平线色与天顶色之间过渡，太阳附近略亮 */
function skyMaterial() {
  return new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uHorizon: { value: new Color() },
      uZenith: { value: new Color() },
      uSunDir: { value: new Vector3(0, 1, 0) },
      uSunGlow: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uHorizon;
      uniform vec3 uZenith;
      uniform vec3 uSunDir;
      uniform float uSunGlow;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 c = mix(uHorizon, uZenith, pow(h, 0.55));
        float glow = pow(max(dot(normalize(vDir), uSunDir), 0.0), 24.0) * uSunGlow;
        c += vec3(1.0, 0.86, 0.68) * glow * 0.35;
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
}

/**
 * 场景的光：按所选日期与时刻的真实太阳位置打平行光并投影，
 * 天空、雾、环境光随太阳高度在白天、黄昏、夜晚之间过渡，夜里窗户按时段亮灯。
 */
export function Sun() {
  const date = useApp((s) => s.date);
  const minute = useApp((s) => s.minute);
  const light = useRef<DirectionalLight>(null);
  const hemi = useRef<HemisphereLight>(null);
  const sky = useRef<Mesh>(null);
  const { controls, camera, scene } = useThree();

  const sun = useMemo(() => {
    const p = sunAt(date, minute);
    const dir = new Vector3(...enuToWorld(...sunDirectionEnu(p.azimuth, p.apparentElevation)));
    return { dir: dir.normalize(), elevation: p.apparentElevation };
  }, [date, minute]);
  const preset = useMemo(() => lightPreset(sun.elevation), [sun.elevation]);
  const material = useMemo(() => skyMaterial(), []);

  useEffect(() => {
    sceneUniforms.uNight.value = preset.night;
    sceneUniforms.uLitShare.value = litShare(minute);
    sceneUniforms.uSky.value.copy(preset.zenith).lerp(preset.horizon, 0.5);
    const u = material.uniforms as {
      uHorizon: { value: Color };
      uZenith: { value: Color };
      uSunDir: { value: Vector3 };
      uSunGlow: { value: number };
    };
    u.uHorizon.value.copy(preset.horizon);
    u.uZenith.value.copy(preset.zenith);
    u.uSunDir.value.copy(sun.dir);
    u.uSunGlow.value = Math.max(0, 1 - Math.abs(sun.elevation) / 20);
    scene.background = preset.horizon.clone();
    if (scene.fog instanceof Fog) scene.fog.color.copy(preset.horizon);
    else scene.fog = new Fog(preset.horizon.clone(), 3000, 9000);
  }, [preset, sun, minute, material, scene]);

  useEffect(() => {
    const l = light.current;
    if (!l) return;
    scene.add(l.target);
    return () => {
      scene.remove(l.target);
    };
  }, [scene]);

  // 阴影相机、雾与天空跟着视点走：拉近时阴影锐利，拉远时雾也推远
  const target = useRef(new Vector3());
  useFrame(() => {
    const l = light.current;
    const t = (controls as unknown as { target?: Vector3 } | null)?.target;
    if (t) target.current.copy(t);
    const dist = camera.position.distanceTo(target.current);
    if (l) {
      const extent = Math.min(1800, Math.max(160, dist * 0.85));
      const cam = l.shadow.camera;
      if (cam.right !== extent) {
        cam.left = -extent;
        cam.right = extent;
        cam.top = extent;
        cam.bottom = -extent;
        cam.updateProjectionMatrix();
      }
      l.position.copy(target.current).addScaledVector(sun.dir, 3000);
      l.target.position.copy(target.current);
    }
    if (scene.fog instanceof Fog) {
      scene.fog.near = Math.max(2400, dist * 2.2);
      scene.fog.far = Math.max(9000, dist * 6);
    }
    sky.current?.position.copy(camera.position);
  });

  return (
    <>
      <mesh ref={sky} material={material} renderOrder={-10} frustumCulled={false}>
        <sphereGeometry args={[1000, 32, 16]} />
      </mesh>
      <hemisphereLight
        ref={hemi}
        args={[preset.skyLight, preset.groundLight, preset.ambient]}
        color={preset.skyLight}
        groundColor={preset.groundLight}
        intensity={preset.ambient}
      />
      {/* 夜里一点冷色的月光，让楼的体块还看得出来 */}
      <directionalLight
        position={[-800, 1400, 600]}
        color="#9fb2d9"
        intensity={0.35 * preset.night}
      />
      <directionalLight
        ref={light}
        intensity={preset.sunIntensity}
        color={preset.sunColor}
        castShadow
        shadow-mapSize={[4096, 4096]}
        shadow-camera-near={10}
        shadow-camera-far={6000}
        shadow-bias={-0.0004}
        shadow-normalBias={0.6}
      />
    </>
  );
}
