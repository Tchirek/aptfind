import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { getEngine, type SceneData } from '../app/data';
import { builtLabel, formatClock, formatDuration, windowOrientation } from '../app/format';
import { usePhoto } from '../app/photos';
import { buildingTitle } from '../app/search';
import { useApp } from '../app/store';
import { daylightSpec, dayTimes, formatDate } from '../app/time';
import { type Building, CLASS_LABEL, type District } from '../engine/district';
import { floorsOf } from '../engine/geometry';
import { AWAY, LIT, type Span, SunPath, TERRAIN } from '../engine/sunlight';
import { AccessSection } from './AccessSection';
import { estatePrice, LandPriceSection } from './LandPriceSection';
import { LivabilitySection } from './LivabilitySection';
import { THRESHOLD_MINUTES, warmSpanFor } from './palette';
import { ReachSection } from './ReachSection';
import { Frame, Sheet } from './Sheet';
import { SunRamp } from './SunRamp';
import { Timeline } from './Timeline';
import { SHEET_QUERY, useMedia } from './useMedia';
import { ViewSection } from './ViewSection';

/** 遥感反演或按户数推算的楼高，层数前加一个小小的 ~ */
export const floorsEstimated = (b: Building) => b.source === 'cbmf' || b.source === 'plan';

function Floors({ b }: { b: Building }) {
  return (
    <>
      {floorsEstimated(b) && <span className="approx">~</span>}
      {floorsOf(b.height)} 层
    </>
  );
}

function heightNote(b: Building): ReactNode {
  if (b.source === 'survey')
    return (
      <>
        <Floors b={b} /> · 已核实
      </>
    );
  if (b.source === 'user')
    return (
      <>
        <Floors b={b} /> · 已修改
      </>
    );
  return (
    <>
      <Floors b={b} /> · {Math.round(b.height)} m
    </>
  );
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
  photo,
}: {
  eyebrow: string;
  title: string;
  sub?: ReactNode;
  /** 从窗位回到整栋楼 */
  back?: () => void;
  /** 题图按这些地块名依次找 */
  photo?: string[];
}) {
  return (
    <header className="inspector-head">
      <HeadPhoto names={photo ?? []} />
      {back && (
        <button type="button" className="back" onClick={back}>
          ‹ 返回
        </button>
      )}
      <div className="eyebrow">{eyebrow}</div>
      <h2>{title}</h2>
      {sub && <p className="sub">{sub}</p>}
    </header>
  );
}

/** 题图：无边框，铺满面板宽度；载入完成才淡入，载不到就不占位置 */
function HeadPhoto({ names }: { names: string[] }) {
  const photo = usePhoto(names);
  const [loaded, setLoaded] = useState<string | null>(null);
  if (!photo) return null;
  return (
    <img
      className={`head-photo${loaded === photo.url ? ' in' : ''}`}
      src={photo.url}
      alt={photo.name}
      ref={(el) => {
        // 缓存里的图可能在挂上 onLoad 之前就已载完
        if (el?.complete && el.naturalWidth > 0 && loaded !== photo.url) setLoaded(photo.url);
      }}
      onLoad={() => setLoaded(photo.url)}
      onError={(e) => {
        e.currentTarget.style.display = 'none';
      }}
      referrerPolicy="no-referrer"
      draggable={false}
    />
  );
}

/** 一栋楼的题图跟着它所属的地块；地块没有图就用上级（如校内的苑区用校园的） */
function photoNames(d: District, compound: number): string[] {
  const c = d.compounds[compound];
  if (!c) return [];
  const parent = c.parent >= 0 ? d.compounds[c.parent] : undefined;
  return parent ? [c.name, parent.name] : [c.name];
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
    <Frame
      head={
        <Head
          eyebrow={[CLASS_LABEL[b.cls], subtitle, year ? builtLabel(year) : '']
            .filter(Boolean)
            .join(' · ')}
          title={title}
          sub={
            <>
              {windowOrientation(data.grid, index)} · {floor} 层 / 共 <Floors b={b} />
            </>
          }
          back={() => select({ kind: 'building', index: b.index })}
          photo={photoNames(d, b.compound)}
        />
      }
    >
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
                    {ob ? (
                      <>
                        {buildingTitle(d, ob).title} · <Floors b={ob} />
                      </>
                    ) : (
                      '山体'
                    )}
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
      <LandPriceSection price={estatePrice(d, b.compound)} />

      <section className="note">
        <p>{heightNote(b)}</p>
      </section>
    </Frame>
  );
}

function BuildingDetail({ data, index }: { data: SceneData; index: number }) {
  const d = data.district;
  const b = d.buildings[index] as Building;
  const { title, subtitle } = buildingTitle(d, b);
  const year = builtYear(d, b.compound);
  const { below, count } = shortfall(data, [index]);

  return (
    <Frame
      head={
        <Head
          eyebrow={[CLASS_LABEL[b.cls], subtitle, year ? builtLabel(year) : '']
            .filter(Boolean)
            .join(' · ')}
          title={title}
          sub={heightNote(b)}
          photo={photoNames(d, b.compound)}
        />
      }
    >
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
      <LandPriceSection price={estatePrice(d, b.compound)} />
      <ReachSection building={index} />
      <AccessSection ring={b.rings[0] as Float64Array} />
    </Frame>
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
    <Frame
      head={
        <Head
          eyebrow={[KIND_LABEL[c.kind], parent?.name, c.builtYear ? builtLabel(c.builtYear) : '']
            .filter(Boolean)
            .join(' · ')}
          title={c.name}
          sub={`${members.length} 栋`}
          photo={photoNames(d, index)}
        />
      }
    >
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
      <LandPriceSection price={estatePrice(d, index)} />
    </Frame>
  );
}

export function Inspector({ data }: { data: SceneData }) {
  const selection = useApp((s) => s.selection);
  const select = useApp((s) => s.select);
  const sheet = useMedia(SHEET_QUERY);
  if (!selection) return null;
  const detail = (
    <>
      {selection.kind === 'window' && <WindowDetail data={data} index={selection.index} />}
      {selection.kind === 'building' && <BuildingDetail data={data} index={selection.index} />}
      {selection.kind === 'compound' && <CompoundDetail data={data} index={selection.index} />}
    </>
  );
  if (sheet) {
    return (
      <Sheet onClose={() => select(null)} openKey={`${selection.kind}:${selection.index}`}>
        {detail}
      </Sheet>
    );
  }
  return (
    <aside className="panel inspector">
      <button type="button" className="close" onClick={() => select(null)} aria-label="关闭">
        ×
      </button>
      {detail}
    </aside>
  );
}
