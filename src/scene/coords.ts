/**
 * 引擎用东-北-天（ENU，z 向上）坐标；three.js 场景里 y 向上。
 * 所有 ENU 几何体都放进一个绕 x 轴转 −90° 的组里：(x, y, z)ENU → (x, z, −y)world。
 */
export const ENU_ROTATION_X = -Math.PI / 2;

export function enuToWorld(e: number, n: number, u: number): [number, number, number] {
  return [e, u, -n];
}
