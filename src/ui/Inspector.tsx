import { useEffect, useMemo, useState } from 'react';
import { getEngine, type SceneData } from '../app/data';
import { formatClock, formatDuration, windowOrientation } from '../app/format';
import { presetDate, useApp } from '../app/store';
import { type Building, CLASS_LABEL } from '../engine/district';
import { floorsOf } from '../engine/geometry';
import { RULE_DAHAN } from '../engine/standard';
import { AWAY, LIT, type Span, SunPath } from '../engine/sunlight';
import { THRESHOLD_MINUTES } from './palette';
import { Timeline } from './Timeline';

function placeName(data: SceneData, b: Building): string {
  const c = data.district.compounds[b.compound];
  return c ? c.name : '未命名地块';
}

function heightNote(b: Building): string {
  const floors = floorsOf(b.height);
  if (b.source === 'survey') return `${floors} 层（实地核验）`;
  if (b.source === 'user') return `${floors} 层（你改过）`;
  return `${floors} 层，约 ${Math.round(b.height)} m（遥感反演，未核验，高层常偏低）`;
}

function Verdict({ minutes, isDahan }: { minutes: number; isDahan: boolean }) {
  if (!isDahan) return <span className="verdict neutral">仅供参考，标准按大寒日判定</span>;
  const ok = minutes >= THRESHOLD_MINUTES;
  return (
    <span className={`verdict ${ok ? 'good' : 'bad'}`}>
      <span aria-hidden>{ok ? '✓' : '!'}</span>
      {ok ? '满足大寒日 2 小时' : '不足大寒日 2 小时'}
    </span>
  );
}

function WindowDetail({ data, index }: { data: SceneData; index: number }) {
  const day = useApp((s) => s.day);
  const setFocus = useApp((s) => s.setFocusBuilding);
  const b = data.district.buildings[data.grid.building[index] as number] as Building;
  const floor = (data.grid.floor[index] as number) + 1;
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
        lat: data.district.origin.lat,
        lon: data.district.origin.lon,
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
  }, [data, index, day]);

  const blockers = useMemo(
    () => (result ? result.spans.filter((s) => s.state !== LIT && s.state !== AWAY) : []),
    [result],
  );

  return (
    <>
      <header className="inspector-head">
        <div className="eyebrow">{CLASS_LABEL[b.cls]}</div>
        <h2>{placeName(data, b)}</h2>
        <p className="sub">
          {windowOrientation(data.grid, index)} · 第 {floor} 层，共 {floorsOf(b.height)} 层
        </p>
      </header>

      <section>
        <div className="label">{day}日日照（真太阳时 8–16 时）</div>
        {result ? (
          <>
            <div className="big-number">{formatDuration(result.minutes)}</div>
            <Verdict minutes={result.minutes} isDahan={day === '大寒'} />
            <Timeline spans={result.spans} path={result.path} onFocus={setFocus} />
          </>
        ) : (
          <div className="big-number muted">计算中…</div>
        )}
      </section>

      {blockers.length > 0 && (
        <section>
          <div className="label">挡住阳光的楼</div>
          <ul className="blockers">
            {blockers.map((s) => {
              const ob = data.district.buildings[s.state] as Building;
              return (
                <li
                  key={`${s.from}-${s.state}`}
                  onPointerEnter={() => setFocus(s.state)}
                  onPointerLeave={() => setFocus(null)}
                >
                  <span className="mono">
                    {formatClock(result?.path.beijingAt(s.from) ?? s.from)}–
                    {formatClock(result?.path.beijingAt(s.to) ?? s.to)}
                  </span>
                  <span>
                    {placeName(data, ob)} · {floorsOf(ob.height)} 层
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="hint">时刻为北京时间。指向一行，场景里会标出那栋楼。</p>
        </section>
      )}

      <section className="note">
        <div className="label">楼高数据</div>
        <p>本楼：{heightNote(b)}</p>
      </section>
    </>
  );
}

function BuildingDetail({ data, index }: { data: SceneData; index: number }) {
  const b = data.district.buildings[index] as Building;
  const start = data.windowRange[2 * index] as number;
  const count = data.windowRange[2 * index + 1] as number;
  let below = 0;
  for (let i = start; i < start + count; i++)
    if ((data.dahanMinutes[i] as number) < THRESHOLD_MINUTES) below++;

  return (
    <>
      <header className="inspector-head">
        <div className="eyebrow">{CLASS_LABEL[b.cls]}</div>
        <h2>{placeName(data, b)}</h2>
        <p className="sub">{heightNote(b)}</p>
      </header>
      {count > 0 ? (
        <section>
          <div className="label">大寒日不足 2 小时的窗位</div>
          <div className="big-number">
            {Math.round((below / count) * 100)}
            <small>%</small>
          </div>
          <p className="sub">
            共 {count} 个窗位，{below} 个不足。点外墙上的格子看具体某一扇。
          </p>
        </section>
      ) : (
        <section>
          <p className="sub">这栋楼在核心区外，只作为遮挡物参与计算。</p>
        </section>
      )}
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
      {selection.kind === 'window' ? (
        <WindowDetail data={data} index={selection.index} />
      ) : (
        <BuildingDetail data={data} index={selection.index} />
      )}
    </aside>
  );
}
