import { Html, Line } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import type { Vector3 } from 'three';
import type { SceneData } from '../app/data';
import { useApp } from '../app/store';
import { type District, terrainAt } from '../engine/district';
import { isCampus } from './groundTexture';

const INK = '#1f1f1c';

/** 把平面折线贴到地形上：逐段加密到 4 m 以内，抬高 lift 米 */
function drape(
  d: District,
  pts: Float64Array,
  lift: number,
  closed = false,
): [number, number, number][] {
  const out: [number, number, number][] = [];
  const n = pts.length / 2;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const ax = pts[2 * i] as number;
    const ay = pts[2 * i + 1] as number;
    const j = (i + 1) % n;
    const bx = pts[2 * j] as number;
    const by = pts[2 * j + 1] as number;
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 4));
    for (let k = 0; k < steps; k++) {
      const x = ax + ((bx - ax) * k) / steps;
      const y = ay + ((by - ay) * k) / steps;
      out.push([x, y, terrainAt(d.terrain, x, y) + lift]);
    }
  }
  const ex = pts[closed ? 0 : 2 * (n - 1)] as number;
  const ey = pts[closed ? 1 : 2 * (n - 1) + 1] as number;
  out.push([ex, ey, terrainAt(d.terrain, ex, ey) + lift]);
  return out;
}

function RouteLine({ district }: { district: District }) {
  const route = useApp((s) => s.route);
  const points = useMemo(
    () => (route ? drape(district, route.points, 0.8) : null),
    [district, route],
  );
  if (!route || !points || points.length < 2) return null;
  const end = points[points.length - 1] as [number, number, number];
  return (
    <group>
      <Line points={points} color="#ffffff" lineWidth={6} depthTest={false} renderOrder={20} />
      <Line points={points} color={INK} lineWidth={2.5} depthTest={false} renderOrder={21} />
      <Html position={end} center zIndexRange={[30, 0]} className="map-label strong">
        {route.label}
      </Html>
    </group>
  );
}

function SearchMarker({ district }: { district: District }) {
  const marker = useApp((s) => s.marker);
  if (!marker) return null;
  const z = terrainAt(district.terrain, marker.x, marker.y);
  return (
    <group>
      <Line
        points={[
          [marker.x, marker.y, z],
          [marker.x, marker.y, z + 28],
        ]}
        color={INK}
        lineWidth={2}
      />
      <Html
        position={[marker.x, marker.y, z + 28]}
        center
        zIndexRange={[30, 0]}
        className="map-label strong"
      >
        {marker.label}
      </Html>
    </group>
  );
}

function SelectedCompound({ district }: { district: District }) {
  const selection = useApp((s) => s.selection);
  const lines = useMemo(() => {
    if (selection?.kind !== 'compound') return [];
    const c = district.compounds[selection.index];
    return c ? c.rings.map((r) => drape(district, r, 0.6, true)) : [];
  }, [district, selection]);
  return (
    <group>
      {lines.map((pts, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 环的顺序固定
        <Line key={i} points={pts} color={INK} lineWidth={2.5} depthTest={false} renderOrder={19} />
      ))}
    </group>
  );
}

interface Label {
  key: string;
  text: string;
  x: number;
  y: number;
  z: number;
  /** 镜头距离小于它才显示 */
  maxDistance: number;
  strong: boolean;
}

function ringCenter(r: Float64Array): [number, number] {
  let x = 0;
  let y = 0;
  for (let i = 0; i < r.length; i += 2) {
    x += r[i] as number;
    y += r[i + 1] as number;
  }
  return [(2 * x) / r.length, (2 * y) / r.length];
}

/**
 * 地名标注：拉远时只显示校园与较大的小区，拉近后显示子片区与有名字的楼。
 * 每 250 ms 按镜头位置重选一次，最多同时 24 个，同名或挨得太近的只留一个。
 */
function PlaceLabels({ district }: { district: District }) {
  const all = useMemo<Label[]>(() => {
    const out: Label[] = [];
    district.compounds.forEach((c, k) => {
      const largest = [...c.rings].sort((a, b) => b.length - a.length)[0];
      if (!largest) return;
      const [x, y] = ringCenter(largest);
      const campus = isCampus(c.name) && c.parent < 0;
      out.push({
        key: `c${k}`,
        text: c.name,
        x,
        y,
        z: terrainAt(district.terrain, x, y) + 4,
        // 酒店、商场这类"其他"地块只在拉得很近时才标，免得盖过小区名
        maxDistance: campus ? 4000 : c.parent >= 0 ? 700 : c.kind === 'other' ? 420 : 1300,
        strong: campus,
      });
    });
    for (const b of district.buildings) {
      if (!b.label) continue;
      const [x, y] = ringCenter(b.rings[0] as Float64Array);
      out.push({
        key: `b${b.index}`,
        text: b.label,
        x,
        y,
        z: b.base + b.height + 3,
        maxDistance: 420,
        strong: false,
      });
    }
    return out;
  }, [district]);

  const { camera, controls } = useThree();
  const [visible, setVisible] = useState<Label[]>([]);
  const last = useRef(0);
  useFrame(() => {
    const now = performance.now();
    if (now - last.current < 250) return;
    last.current = now;
    const t = (controls as unknown as { target?: Vector3 } | null)?.target;
    if (!t) return;
    const dist = camera.position.distanceTo(t);
    // 世界坐标 (x, y, z) = ENU (x, z, -y)
    const tx = t.x;
    const ty = -t.z;
    const radius = Math.max(250, dist * 0.9);
    const picked = all
      .filter((l) => dist < l.maxDistance && Math.hypot(l.x - tx, l.y - ty) < radius)
      .sort(
        (a, b) =>
          Number(b.strong) - Number(a.strong) ||
          Math.hypot(a.x - tx, a.y - ty) - Math.hypot(b.x - tx, b.y - ty),
      )
      .slice(0, 36);
    setVisible((prev) =>
      prev.length === picked.length && prev.every((p, i) => p.key === picked[i]?.key)
        ? prev
        : picked,
    );
  });

  return (
    <group>
      {visible.map((l) => (
        <Html
          key={l.key}
          position={[l.x, l.y, l.z]}
          center
          zIndexRange={[10, 0]}
          className={l.strong ? 'map-label strong' : 'map-label'}
        >
          {l.text}
        </Html>
      ))}
    </group>
  );
}

export function Overlays({ data }: { data: SceneData }) {
  const d = data.district;
  return (
    <>
      <SelectedCompound district={d} />
      <RouteLine district={d} />
      <SearchMarker district={d} />
      <PlaceLabels district={d} />
    </>
  );
}
