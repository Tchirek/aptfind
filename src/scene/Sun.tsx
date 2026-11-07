import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Color, type DirectionalLight, Fog, type HemisphereLight, Vector3 } from 'three';
import { useApp } from '../app/store';
import { sunAt } from '../app/time';
import { sunDirectionEnu } from '../engine/solar';
import { enuToWorld } from './coords';
import { lightPreset, litShare, sceneUniforms } from './lighting';
import { Sky, skyState } from './Sky';

/**
 * 场景的光：按所选日期与时刻的真实太阳位置打平行光并投影，
 * 天空、雾、环境光随太阳高度在白天、黄昏、夜晚之间过渡，夜里窗户按时段亮灯。
 */
const WHITE = new Color('#ffffff');
const skyLight = new Color();

export function Sun() {
  const date = useApp((s) => s.date);
  const minute = useApp((s) => s.minute);
  const light = useRef<DirectionalLight>(null);
  const hemi = useRef<HemisphereLight>(null);
  const { controls, camera, scene } = useThree();

  const sun = useMemo(() => {
    const p = sunAt(date, minute);
    const dir = new Vector3(...enuToWorld(...sunDirectionEnu(p.azimuth, p.apparentElevation)));
    return { dir: dir.normalize(), elevation: p.apparentElevation };
  }, [date, minute]);
  const preset = useMemo(() => lightPreset(sun.elevation), [sun.elevation]);

  useEffect(() => {
    sceneUniforms.uNight.value = preset.night;
    sceneUniforms.uLitShare.value = litShare(minute);
  }, [preset, minute]);

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
    // 光色取自大气模型：直射光是穿过大气后的太阳色，天光是天顶附近的天色
    if (l) l.color.copy(skyState.sunColor);
    const h = hemi.current;
    if (h) {
      sceneUniforms.uSky.value.copy(skyState.zenith).lerp(skyState.horizon, 0.4);
      h.color
        .copy(skyLight.copy(skyState.zenith).lerp(WHITE, 0.55))
        .lerp(preset.skyLight, preset.night);
    }
  });

  return (
    <>
      <Sky />
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
