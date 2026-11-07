/**
 * 天空查找表的共用 uniform，以及让地面、建筑的远处按"那个方向地平线的天色"淡出的雾。
 * three.js 自带的雾只有一个颜色，黄昏时朝太阳与背太阳的地平线差得很远，天地交界会露出接缝；
 * 这里把 fog_fragment 换成按视线方位查天空查找表。
 */

import {
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  HalfFloatType,
  LinearFilter,
  type Material,
  RepeatWrapping,
  RGBAFormat,
} from 'three';
import { LUT_H, LUT_W } from './atmosphere';

export function createLutTexture(): DataTexture {
  const t = new DataTexture(
    new Uint16Array(LUT_W * LUT_H * 4),
    LUT_W,
    LUT_H,
    RGBAFormat,
    HalfFloatType,
  );
  t.wrapS = RepeatWrapping;
  t.wrapT = ClampToEdgeWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

export const skyUniforms = {
  uSkyLut: { value: createLutTexture() },
  /** 夜空底色（已曝光的线性 RGB），叠在查找表之上 */
  uSkyNight: { value: new Color(0, 0, 0) },
};

/** 世界坐标方向（y 向上，−z 指北）→ 查找表 UV；高度角按 √ 分布 */
export const skyLookupGlsl = /* glsl */ `
uniform sampler2D uSkyLut;
uniform vec3 uSkyNight;
vec3 jgSkyColor(vec3 dir) {
  vec3 d = normalize(dir);
  float az = atan(d.x, -d.z);
  float u = fract(az / 6.28318530718);
  float el = asin(clamp(d.y, 0.0, 1.0));
  float v = sqrt(el / 1.57079632679);
  return texture2D(uSkyLut, vec2(u, v)).rgb + uSkyNight;
}
`;

/** 给 three.js 内置材质换上按方位取色的雾；须与 scene.fog 一起用（雾的远近仍由它给） */
export function withSkyFog<T extends Material>(m: T): T {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer);
    Object.assign(shader.uniforms, skyUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSkyDir;')
      .replace(
        '#include <fog_vertex>',
        '#include <fog_vertex>\nvSkyDir = (modelMatrix * vec4(transformed, 1.0)).xyz - cameraPosition;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vSkyDir;\n${skyLookupGlsl}`)
      .replace(
        '#include <fog_fragment>',
        /* glsl */ `
#ifdef USE_FOG
  float jgFog = smoothstep(fogNear, fogFar, vFogDepth);
  // 取略高于地平线处的天色
  vec3 jgFogDir = vec3(vSkyDir.x, length(vSkyDir.xz) * 0.03, vSkyDir.z);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, linearToOutputTexel(vec4(jgSkyColor(jgFogDir), 1.0)).rgb, jgFog);
#endif`,
      );
  };
  const key = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => `${key()}-skyfog`;
  return m;
}
