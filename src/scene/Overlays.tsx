import { Html, Line } from '@react-three/drei';
import { useMemo } from 'react';
import type { SceneData } from '../app/data';
import { useApp } from '../app/store';
import { type District, terrainAt } from '../engine/district';

const INK = '#0f1e33';

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

export function Overlays({ data }: { data: SceneData }) {
  const d = data.district;
  return (
    <>
      <SelectedCompound district={d} />
      <RouteLine district={d} />
      <SearchMarker district={d} />
    </>
  );
}
