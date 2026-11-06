/**
 * WGS-84 → GCJ-02（国测局加密坐标）。高德的接口只认 GCJ-02。
 * 公开的近似算法，境内误差约 1 m；反算在 Python 管线里迭代完成。
 */

const A = 6378245.0;
const EE = 0.00669342162296594323;

function transformLat(x: number, y: number): number {
  let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  r += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  r += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3;
  r += ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3;
  return r;
}

function transformLon(x: number, y: number): number {
  let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  r += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  r += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3;
  r += ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3;
  return r;
}

export function wgs84ToGcj02(lon: number, lat: number): [number, number] {
  let dLat = transformLat(lon - 105, lat - 35);
  let dLon = transformLon(lon - 105, lat - 35);
  const radLat = (lat / 180) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180) / (((A * (1 - EE)) / (magic * sqrtMagic)) * Math.PI);
  dLon = (dLon * 180) / ((A / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return [lon + dLon, lat + dLat];
}
