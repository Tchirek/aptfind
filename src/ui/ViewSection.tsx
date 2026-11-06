import { useEffect, useState } from 'react';
import { getEngine, type SceneData } from '../app/data';
import { buildingTitle } from '../app/search';
import { TERRAIN } from '../engine/sunlight';
import { type ViewMetrics, viewFrom } from '../engine/view';

/** 窗前视野：正对面多远是什么（楼间距），前方扇面有多开阔 */
export function ViewSection({ data, index }: { data: SceneData; index: number }) {
  const [view, setView] = useState<ViewMetrics | null>(null);

  useEffect(() => {
    let alive = true;
    setView(null);
    getEngine().then((engine) => {
      if (alive) setView(viewFrom(engine, data.grid, index));
    });
    return () => {
      alive = false;
    };
  }, [data, index]);

  if (!view) return null;
  const owner =
    view.frontOwner === null
      ? ''
      : view.frontOwner === TERRAIN
        ? '山体'
        : (() => {
            const b = data.district.buildings[view.frontOwner];
            return b ? buildingTitle(data.district, b).title : '';
          })();

  return (
    <section>
      <div className="label">视野</div>
      <dl className="facts">
        <dt>正对面</dt>
        <dd>
          {view.frontDistance === null ? (
            '300 m 内无遮挡'
          ) : (
            <>
              <span className="mono">{Math.round(view.frontDistance)} m</span>
              {owner && <span className="muted"> · {owner}</span>}
            </>
          )}
        </dd>
        <dt>开阔度</dt>
        <dd>
          <span className="meter" aria-hidden>
            <i style={{ width: `${view.openness * 100}%` }} />
          </span>
          <span className="mono">{Math.round(view.openness * 100)}%</span>
        </dd>
      </dl>
    </section>
  );
}
