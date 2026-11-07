/**
 * 高德数据采集页（仅本地开发服务器可用，不进生产构建）。
 *
 * 这个 Key 是"Web端（JS API）"类型，REST 接口不认，只能在浏览器里调 JS API。
 * 采集结果 POST 给开发服务器的 /__collect，落盘到 pipeline/raw/amap/，由 Python 管线读取。
 *
 * 在浏览器控制台里调用：
 *   await jgCollect.regeo()   逆地理编码：每栋楼所在的 AOI（小区/校园）与附近 POI
 *   await jgCollect.roads()   逆地理编码：OSM 里没有名字的道路，沿线样点附近的道路名
 *   await jgCollect.pois()    按类别搜索片区内的设施 POI
 *   await jgCollect.brands()  麦当劳、星巴克、海底捞（片区外扩约 3 km）
 */

import { wgs84ToGcj02 } from './gcj02';

declare global {
  interface Window {
    _AMapSecurityConfig?: { securityJsCode: string };
    // biome-ignore lint/suspicious/noExplicitAny: 高德 JS API 没有官方类型
    AMap: any;
    jgCollect: typeof api;
    jgStatus: string;
  }
}

const log = (s: string) => {
  window.jgStatus = s;
  const el = document.getElementById('log');
  if (el) el.textContent = `${s}\n${el.textContent ?? ''}`.slice(0, 4000);
};

function loadAMap(): Promise<void> {
  const key = import.meta.env.VITE_AMAP_KEY as string | undefined;
  const code = import.meta.env.VITE_AMAP_SECURITY_CODE as string | undefined;
  if (!key || !code)
    throw new Error('缺少 .env.local 里的 VITE_AMAP_KEY / VITE_AMAP_SECURITY_CODE');
  window._AMapSecurityConfig = { securityJsCode: code };
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://webapi.amap.com/maps?v=2.0&key=${key}&plugin=AMap.Geocoder,AMap.PlaceSearch`;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('高德 JS API 加载失败'));
    document.head.append(s);
  });
}

async function save(name: string, data: unknown): Promise<void> {
  const res = await fetch(`/__collect?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`保存 ${name} 失败：${res.status}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface InputPoint {
  id: string;
  lon: number;
  lat: number;
}

/** 逆地理编码：每批 20 个点，返回所在 AOI、所在住宅区、附近 POI */
async function regeo(radius = 60): Promise<number> {
  const input = (await (
    await fetch('/pipeline/raw/amap/input-points.json')
  ).json()) as InputPoint[];
  const geocoder = new window.AMap.Geocoder({ radius, extensions: 'all', batch: true });
  const out: unknown[] = [];
  for (let i = 0; i < input.length; i += 20) {
    const batch = input.slice(i, i + 20);
    const lnglats = batch.map((p) => wgs84ToGcj02(p.lon, p.lat));
    // biome-ignore lint/suspicious/noExplicitAny: 高德回调结果
    const result = await new Promise<any>((resolve, reject) => {
      // biome-ignore lint/suspicious/noExplicitAny: 高德回调结果
      geocoder.getAddress(lnglats, (status: string, r: any) =>
        status === 'complete'
          ? resolve(r)
          : reject(new Error(`regeo ${status}: ${JSON.stringify(r)}`)),
      );
    });
    const list = result.regeocodes ?? [result.regeocode];
    batch.forEach((p, k) => {
      const r = list[k];
      out.push({
        id: p.id,
        aois: r?.aois ?? [],
        pois: (r?.pois ?? []).map((x: Record<string, unknown>) => ({
          id: x.id,
          name: x.name,
          type: x.type,
          location: String(x.location),
          distance: x.distance,
        })),
        neighborhood: r?.addressComponent?.neighborhood ?? '',
        neighborhoodType: r?.addressComponent?.neighborhoodType ?? '',
        building: r?.addressComponent?.building ?? '',
        buildingType: r?.addressComponent?.buildingType ?? '',
      });
    });
    log(`逆地理编码 ${Math.min(i + 20, input.length)} / ${input.length}`);
    await sleep(80);
  }
  await save('regeo', out);
  log(`逆地理编码完成：${out.length} 个点`);
  return out.length;
}

// biome-ignore lint/suspicious/noExplicitAny: 高德 Geocoder 实例
function getAddress(geocoder: any, lnglats: [number, number][]): Promise<any> {
  return new Promise((resolve, reject) => {
    // biome-ignore lint/suspicious/noExplicitAny: 高德回调结果
    geocoder.getAddress(lnglats, (status: string, r: any) =>
      status === 'complete'
        ? resolve(r)
        : reject(new Error(`regeo ${status}: ${JSON.stringify(r)}`)),
    );
  });
}

/** 道路样点：每批 20 个，记下附近道路的名称、距离与方位，供管线给无名道路投票 */
async function roads(radius = 60): Promise<number> {
  const input = (await (await fetch('/pipeline/raw/amap/road-points.json')).json()) as InputPoint[];
  const geocoder = new window.AMap.Geocoder({ radius, extensions: 'all', batch: true });
  const out: unknown[] = [];
  for (let i = 0; i < input.length; i += 20) {
    const batch = input.slice(i, i + 20);
    const lnglats = batch.map((p) => wgs84ToGcj02(p.lon, p.lat));
    // biome-ignore lint/suspicious/noExplicitAny: 高德回调结果
    let result: any;
    for (let attempt = 0; ; attempt++) {
      try {
        result = await getAddress(geocoder, lnglats);
        break;
      } catch (e) {
        if (attempt >= 6 || !String((e as Error).message).includes('QPS')) throw e;
        await sleep(1000 * 2 ** attempt);
      }
    }
    const list = result.regeocodes ?? [result.regeocode];
    batch.forEach((p, k) => {
      const r = list[k];
      out.push({
        id: p.id,
        roads: (r?.roads ?? []).map((x: Record<string, unknown>) => ({
          name: x.name,
          distance: Number(x.distance),
          direction: x.direction,
        })),
        street: r?.addressComponent?.street ?? '',
      });
    });
    log(`道路样点 ${Math.min(i + 20, input.length)} / ${input.length}`);
    await sleep(120);
  }
  await save('roads', out);
  log(`道路样点完成：${out.length} 个`);
  return out.length;
}

/** 片区外框（WGS-84），切成 n×n 块逐块搜索，避开单次搜索的结果上限 */
const BOUNDS = { south: 30.6035, west: 104.1055, north: 30.6285, east: 104.1345 };

export const CATEGORIES: { key: string; type?: string; keyword?: string }[] = [
  { key: 'metro', type: '150500' },
  { key: 'bus', type: '150700' },
  { key: 'grocery', type: '060200|060400' },
  { key: 'market', keyword: '菜市场' },
  { key: 'food', type: '050000' },
  { key: 'medical', type: '090000' },
  { key: 'school', type: '141200' },
  { key: 'park', type: '110100' },
  { key: 'sport', type: '080100' },
  { key: 'campus', keyword: '四川师范大学' },
];

// biome-ignore lint/suspicious/noExplicitAny: 高德 PlaceSearch 实例
function searchOnce(ps: any, keyword: string, bounds: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    // biome-ignore lint/suspicious/noExplicitAny: 高德回调结果
    ps.searchInBounds(keyword, bounds, (status: string, r: any) => {
      if (status === 'complete') resolve(r);
      else if (status === 'no_data') resolve({ poiList: { pois: [], count: 0 } });
      else reject(new Error(`search ${status}: ${JSON.stringify(r)}`));
    });
  });
}

/** 撞上 QPS 限流（CUQPS_HAS_EXCEEDED_THE_LIMIT）时退避重试 */
// biome-ignore lint/suspicious/noExplicitAny: 高德 PlaceSearch 实例
async function searchPage(ps: any, keyword: string, bounds: unknown): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await searchOnce(ps, keyword, bounds);
    } catch (e) {
      if (attempt >= 6 || !String((e as Error).message).includes('QPS')) throw e;
      await sleep(1000 * 2 ** attempt);
    }
  }
}

async function pois(grid = 3, only?: string[]): Promise<Record<string, number>> {
  const summary: Record<string, number> = {};
  for (const cat of CATEGORIES) {
    if (only && !only.includes(cat.key)) continue;
    const found = new Map<string, unknown>();
    const n = cat.key === 'food' ? grid + 1 : grid;
    for (let gx = 0; gx < n; gx++) {
      for (let gy = 0; gy < n; gy++) {
        const w = BOUNDS.west + ((BOUNDS.east - BOUNDS.west) * gx) / n;
        const e = BOUNDS.west + ((BOUNDS.east - BOUNDS.west) * (gx + 1)) / n;
        const s = BOUNDS.south + ((BOUNDS.north - BOUNDS.south) * gy) / n;
        const nn = BOUNDS.south + ((BOUNDS.north - BOUNDS.south) * (gy + 1)) / n;
        const bounds = new window.AMap.Bounds(wgs84ToGcj02(w, s), wgs84ToGcj02(e, nn));
        for (let page = 1; page <= 20; page++) {
          const ps = new window.AMap.PlaceSearch({
            type: cat.type ?? '',
            pageSize: 50,
            pageIndex: page,
            extensions: 'base',
          });
          const r = await searchPage(ps, cat.keyword ?? '', bounds);
          const list = r.poiList?.pois ?? [];
          for (const p of list) {
            found.set(p.id, {
              id: p.id,
              name: p.name,
              type: p.type,
              typecode: p.typecode ?? '',
              address: typeof p.address === 'string' ? p.address : '',
              location: `${p.location.lng},${p.location.lat}`,
            });
          }
          log(`${cat.key} 块 ${gx},${gy} 第 ${page} 页：${list.length} 条，累计 ${found.size}`);
          await sleep(380);
          if (list.length < 50) break;
        }
      }
    }
    await save(`poi-${cat.key}`, [...found.values()]);
    summary[cat.key] = found.size;
  }
  log(`POI 完成：${JSON.stringify(summary)}`);
  return summary;
}

/** 几个指名的连锁品牌：片区外扩约 3 km 内按关键词搜，供"最近一家多远"与地图标注 */
export const BRANDS = ['麦当劳', '星巴克', '海底捞'] as const;

async function brands(): Promise<number> {
  const WIDE = { south: 30.578, west: 104.075, north: 30.655, east: 104.165 };
  const found = new Map<string, unknown>();
  for (const brand of BRANDS) {
    const bounds = new window.AMap.Bounds(
      wgs84ToGcj02(WIDE.west, WIDE.south),
      wgs84ToGcj02(WIDE.east, WIDE.north),
    );
    for (let page = 1; page <= 10; page++) {
      const ps = new window.AMap.PlaceSearch({ pageSize: 50, pageIndex: page, extensions: 'base' });
      const r = await searchPage(ps, brand, bounds);
      const list = r.poiList?.pois ?? [];
      for (const p of list) {
        found.set(p.id, {
          id: p.id,
          brand,
          name: p.name,
          type: p.type,
          address: typeof p.address === 'string' ? p.address : '',
          location: `${p.location.lng},${p.location.lat}`,
        });
      }
      log(`${brand} 第 ${page} 页：${list.length} 条，累计 ${found.size}`);
      await sleep(380);
      if (list.length < 50) break;
    }
  }
  await save('poi-brands', [...found.values()]);
  log(`品牌完成：${found.size} 条`);
  return found.size;
}

/** 川师狮子山校区范围内按关键词补采校内建筑名（宿舍、教学楼、食堂等） */
async function campusNames(): Promise<number> {
  const CAMPUS = { south: 30.6105, west: 104.1125, north: 30.6215, east: 104.1265 };
  const keywords = [
    '宿舍',
    '舍',
    '教学楼',
    '实验楼',
    '食堂',
    '公寓',
    '苑',
    '楼',
    '馆',
    '学院',
    '中心',
    '办公',
  ];
  const found = new Map<string, unknown>();
  const bounds = new window.AMap.Bounds(
    wgs84ToGcj02(CAMPUS.west, CAMPUS.south),
    wgs84ToGcj02(CAMPUS.east, CAMPUS.north),
  );
  for (const kw of keywords) {
    for (let page = 1; page <= 10; page++) {
      const ps = new window.AMap.PlaceSearch({ pageSize: 50, pageIndex: page, extensions: 'base' });
      const r = await searchPage(ps, kw, bounds);
      const list = r.poiList?.pois ?? [];
      for (const p of list)
        found.set(p.id, {
          id: p.id,
          name: p.name,
          type: p.type,
          location: `${p.location.lng},${p.location.lat}`,
        });
      log(`校内"${kw}"第 ${page} 页：${list.length} 条，累计 ${found.size}`);
      await sleep(380);
      if (list.length < 50) break;
    }
  }
  await save('poi-campus2', [...found.values()]);
  return found.size;
}

const api = { regeo, roads, pois, brands, campusNames };

loadAMap()
  .then(() => {
    window.jgCollect = api;
    log('高德 JS API 已就绪');
  })
  .catch((e: Error) => log(`错误：${e.message}`));
