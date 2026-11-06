import { useEffect, useMemo, useState } from 'react';
import { getEngine, type SceneData } from '../app/data';
import { formatClock, formatDuration, windowOrientation } from '../app/format';
import { buildingTitle } from '../app/search';
import { presetDate, useApp } from '../app/store';
import { type Building, CLASS_LABEL, type District } from '../engine/district';
import { floorsOf } from '../engine/geometry';
import { RULE_DAHAN } from '../engine/standard';
import { AWAY, LIT, type Span, SunPath, TERRAIN } from '../engine/sunlight';
import { AccessSection } from './AccessSection';
import { THRESHOLD_MINUTES } from './palette';
import { Timeline } from './Timeline';
import { ViewSection } from './ViewSection';

function heightNote(b: Building): string {
  const floors = floorsOf(b.height);
  if (b.source === 'survey') return `${floors} 层 · 已核实`;
  if (b.source === 'user') return `${floors} 层 · 已修改`;
  return `${floors} 层 · 约 ${Math.round(b.height)} m`;
}

function builtYear(d: District, k: number): number | null {
  const c = d.compounds[k];
  if (!c) return null;
  return c.builtYear ?? (c.parent >= 0 ? (d.compounds[c.parent]?.builtYear ?? null) : null);
}

function ringCenter(ring: Float64Array): [number, number] {
  let x = 0;
  let y = 0;
  for (let i = 0; i < ring.length; i += 2) {
    x += ring[i] as number;
    y += ring[i + 1] as number;
  }
  return [(2 * x) / ring.length, (2 * y) / ring.length];
}

/** 一组窗位里大寒日不足 2 小时的比例 */
function shortfall(data: SceneData, buildings: Iterable<number>): { below: number; count: number } {
  let below = 0;
  let count = 0;
  for (const b of buildings) {
    const start = data.windowRange[2 * b] as number;
    const n = data.windowRange[2 * b + 1] as number;
    for (let i = start; i < start + n; i++) {
      count++;
      if ((data.dahanMinutes[i] as number) < THRESHOLD_MINUTES) below++;
    }
  }
  return { below, count };
}

function Verdict({ minutes }: { minutes: number }) {
  const ok = minutes >= THRESHOLD_MINUTES;
  return (
    <span className={`verdict ${ok ? 'good' : 'bad'}`}>
      <span aria-hidden>{ok ? '✓' : '!'}</span>
      {ok ? '满足大寒日 2 小时' : '不足大寒日 2 小时'}
    </span>
  );
}

function Head({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) {
  return (
    <header className="inspector-head">
      <div className="eyebrow">{eyebrow}</div>
      <h2>{title}</h2>
      {sub && <p className="sub">{sub}</p>}
    </header>
  );
}

function WindowDetail({ data, index }: { data: SceneData; index: number }) {
  const day = useApp((s) => s.day);
  const setFocus = useApp((s) => s.setFocusBuilding);
  const d = data.district;
  const b = d.buildings[data.grid.building[index] as number] as Building;
  const floor = (data.grid.floor[index] as number) + 1;
  const { title, subtitle } = buildingTitle(d, b);
  const year = builtYear(d, b.compound);
  const [result, setResult] = useState<{ minutes: number; spans: Span[]; path: SunPath } | null>(
    null,
  );

  useEffect(() => {
    let alive = true;
    setResult(null);
    getEngine().then((engine) => {
      const path = new SunPath({
        date: presetDate(day),
        startTst: RULE_DAHAN.startTst,
        endTst: RULE_DAHAN.endTst,
        lat: d.origin.lat,
        lon: d.origin.lon,
      });
      const spans: Span[] = [];
      const minutes = engine.trace(
        data.grid,
        index,
        path,
        { coarseStep: 2, tolerance: 0.1 },
        spans,
      );
      if (alive) setResult({ minutes, spans, path });
    });
    return () => {
      alive = false;
    };
  }, [data, d, index, day]);

  const blockers = useMemo(
    () => (result ? result.spans.filter((s) => s.state !== LIT && s.state !== AWAY) : []),
    [result],
  );
  const [cx, cy] = ringCenter(b.rings[0] as Float64Array);

  return (
    <>
      <Head
        eyebrow={[CLASS_LABEL[b.cls], subtitle, year ? `${year} 年建成` : '']
          .filter(Boolean)
          .join(' · ')}
        title={title}
        sub={`${windowOrientation(data.grid, index)} · ${floor} 层 / 共 ${floorsOf(b.height)} 层`}
      />

      <section>
        <div className="label">{day}日照</div>
        {result ? (
          <>
            <div className="big-number">{formatDuration(result.minutes)}</div>
            {day === '大寒' && <Verdict minutes={result.minutes} />}
            <Timeline spans={result.spans} path={result.path} onFocus={setFocus} />
          </>
        ) : (
          <div className="big-number muted">…</div>
        )}
      </section>

      {blockers.length > 0 && (
        <section>
          <div className="label">遮挡来源</div>
          <ul className="blockers">
            {blockers.map((s) => {
              const ob = s.state === TERRAIN ? null : d.buildings[s.state];
              return (
                <li
                  key={`${s.from}-${s.state}`}
                  onPointerEnter={() => setFocus(ob ? s.state : null)}
                  onPointerLeave={() => setFocus(null)}
                >
                  <span className="mono">
                    {formatClock(result?.path.beijingAt(s.from) ?? s.from)}–
                    {formatClock(result?.path.beijingAt(s.to) ?? s.to)}
                  </span>
                  <span>
                    {ob ? `${buildingTitle(d, ob).title} · ${floorsOf(ob.height)} 层` : '山体'}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <ViewSection data={data} index={index} />
      <AccessSection x={cx} y={cy} />

      <section className="note">
        <p>{heightNote(b)}</p>
      </section>
    </>
  );
}

function BuildingDetail({ data, index }: { data: SceneData; index: number }) {
  const d = data.district;
  const b = d.buildings[index] as Building;
  const { title, subtitle } = buildingTitle(d, b);
  const year = builtYear(d, b.compound);
  const { below, count } = shortfall(data, [index]);
  const [cx, cy] = ringCenter(b.rings[0] as Float64Array);

  return (
    <>
      <Head
        eyebrow={[CLASS_LABEL[b.cls], subtitle, year ? `${year} 年建成` : '']
          .filter(Boolean)
          .join(' · ')}
        title={title}
        sub={heightNote(b)}
      />
      {count > 0 && (
        <section>
          <div className="label">大寒日不足 2 小时的窗位</div>
          <div className="big-number">
            {Math.round((below / count) * 100)}
            <small>%</small>
          </div>
          <p className="sub">
            {below} / {count}
          </p>
        </section>
      )}
      <AccessSection x={cx} y={cy} />
    </>
  );
}

const KIND_LABEL = { residential: '小区', school: '学校', other: '地块' } as const;

function CompoundDetail({ data, index }: { data: SceneData; index: number }) {
  const d = data.district;
  const c = d.compounds[index];
  const members = useMemo(() => {
    const children = new Set(d.compounds.flatMap((k, i) => (k.parent === index ? [i] : [])));
    return d.buildings
      .filter((b) => b.compound === index || children.has(b.compound))
      .map((b) => b.index);
  }, [d, index]);
  if (!c) return null;
  const { below, count } = shortfall(data, members);
  const largest = [...c.rings].sort((a, b) => b.length - a.length)[0] as Float64Array;
  const [cx, cy] = ringCenter(largest);
  const parent = c.parent >= 0 ? d.compounds[c.parent] : undefined;

  return (
    <>
      <Head
        eyebrow={[KIND_LABEL[c.kind], parent?.name, c.builtYear ? `${c.builtYear} 年建成` : '']
          .filter(Boolean)
          .join(' · ')}
        title={c.name}
        sub={`${members.length} 栋`}
      />
      {count > 0 && (
        <section>
          <div className="label">大寒日不足 2 小时的窗位</div>
          <div className="big-number">
            {Math.round((below / count) * 100)}
            <small>%</small>
          </div>
          <p className="sub">
            {below} / {count}
          </p>
        </section>
      )}
      <AccessSection x={cx} y={cy} />
    </>
  );
}

export function Inspector({ data }: { data: SceneData }) {
  const selection = useApp((s) => s.selection);
  const select = useApp((s) => s.select);
  if (!selection) return null;
  return (
    <aside className="panel inspector">
      <button type="button" className="close" onClick={() => select(null)} aria-label="关闭">
        ×
      </button>
      {selection.kind === 'window' && <WindowDetail data={data} index={selection.index} />}
      {selection.kind === 'building' && <BuildingDetail data={data} index={selection.index} />}
      {selection.kind === 'compound' && <CompoundDetail data={data} index={selection.index} />}
    </aside>
  );
}
