import { useEffect, useMemo, useState } from 'react';
import { getEngine, type SceneData } from '../app/data';
import { formatClock, formatDuration, windowOrientation } from '../app/format';
import { buildingTitle } from '../app/search';
import { useApp } from '../app/store';
import { daylightSpec, dayTimes, formatDate } from '../app/time';
import { type Building, CLASS_LABEL, type District } from '../engine/district';
import { floorsOf } from '../engine/geometry';
import { AWAY, LIT, type Span, SunPath, TERRAIN } from '../engine/sunlight';
import { AccessSection } from './AccessSection';
import { LandPriceSection } from './LandPriceSection';
import { LivabilitySection } from './LivabilitySection';
import { THRESHOLD_MINUTES, warmSpanFor } from './palette';
import { ReachSection } from './ReachSection';
import { SunRamp } from './SunRamp';
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

/** 大寒日（真太阳时 8–16 时）的日照，对照 GB 50180 的 2 小时 */
function Verdict({ minutes }: { minutes: number }) {
  const ok = minutes >= THRESHOLD_MINUTES;
  return (
    <span className={`verdict ${ok ? 'good' : 'bad'}`}>
      <span aria-hidden>{ok ? '✓' : '!'}</span>
      大寒日 {formatDuration(minutes)} · {ok ? '满足' : '不足'} 2 小时
    </span>
  );
}

function Head({
  eyebrow,
  title,
  sub,
  back,
}: {
  eyebrow: string;
  title: string;
  sub?: string;
  /** 从窗位回到整栋楼 */
  back?: () => void;
}) {
  return (
    <header className="inspector-head">
      {back && (
        <button type="button" className="back" onClick={back}>
          ‹ 整栋楼
        </button>
      )}
      <div className="eyebrow">{eyebrow}</div>
      <h2>{title}</h2>
      {sub && <p className="sub">{sub}</p>}
    </header>
  );
}

/** 选中楼在所选日期的日照概况：边算边显示进度，算完给出最少、中位、最多，附外墙色带 */
function DateSunlight({ building }: { building: number }) {
  const date = useApp((s) => s.date);
  const sunlight = useApp((s) => s.sunlight);
  const mine = sunlight?.building === building ? sunlight : null;
  const n = mine?.minutes.length ?? 0;
  const done = mine?.done ?? 0;
  const stats = useMemo(() => {
    if (!mine || done < n || n === 0) return null;
    const sorted = Array.from(mine.minutes).sort((a, b) => a - b);
    return {
      min: sorted[0] as number,
      median: sorted[Math.floor(n / 2)] as number,
      max: sorted[n - 1] as number,
    };
  }, [mine, done, n]);
  const t = dayTimes(date);
  return (
    <section>
      <div className="label">{formatDate(date)} 日照</div>
      {stats ? (
        <div className="sun-stats">
          <div>
            <small>最少</small>
            <b>{formatDuration(stats.min)}</b>
          </div>
          <div>
            <small>中位</small>
            <b>{formatDuration(stats.median)}</b>
          </div>
          <div>
            <small>最多</small>
            <b>{formatDuration(stats.max)}</b>
          </div>
        </div>
      ) : (
        <p className="sub mono">{n ? `${done} / ${n}` : '…'}</p>
      )}
      <SunRamp warmSpan={warmSpanFor(t.sunset - t.sunrise)} />
    </section>
  );
}

function WindowDetail({ data, index }: { data: SceneData; index: number }) {
  const date = useApp((s) => s.date);
  const minute = useApp((s) => s.minute);
  const setFocus = useApp((s) => s.setFocusBuilding);
  const select = useApp((s) => s.select);
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
      const path = new SunPath(daylightSpec(date));
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
  }, [data, index, date]);

  const blockers = useMemo(
    () => (result ? result.spans.filter((s) => s.state !== LIT && s.state !== AWAY) : []),
    [result],
  );

  return (
    <>
      <Head
        eyebrow={[CLASS_LABEL[b.cls], subtitle, year ? `${year} 年建成` : '']
          .filter(Boolean)
          .join(' · ')}
        title={title}
        sub={`${windowOrientation(data.grid, index)} · ${floor} 层 / 共 ${floorsOf(b.height)} 层`}
        back={() => select({ kind: 'building', index: b.index })}
      />

      <section>
        <div className="label">{formatDate(date)} 日照</div>
        {result ? (
          <>
            <div className="big-number">{formatDuration(result.minutes)}</div>
            <Verdict minutes={data.dahanMinutes[index] as number} />
            <Timeline spans={result.spans} path={result.path} now={minute} onFocus={setFocus} />
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
      <ReachSection building={b.index} />
      <AccessSection ring={b.rings[0] as Float64Array} />
      <LandPriceSection />

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

  return (
    <>
      <Head
        eyebrow={[CLASS_LABEL[b.cls], subtitle, year ? `${year} 年建成` : '']
          .filter(Boolean)
          .join(' · ')}
        title={title}
        sub={heightNote(b)}
      />
      {count > 0 && <DateSunlight building={index} />}
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
      <LivabilitySection building={index} />
      <LandPriceSection />
      <ReachSection building={index} />
      <AccessSection ring={b.rings[0] as Float64Array} />
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
      <AccessSection ring={largest} />
      <LandPriceSection />
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
