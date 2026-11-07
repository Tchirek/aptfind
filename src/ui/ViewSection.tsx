import { useEffect, useState } from 'react';
import { getEngine, type SceneData } from '../app/data';
import { buildingTitle } from '../app/search';
import { useApp } from '../app/store';
import { TERRAIN } from '../engine/sunlight';
import { type ViewMetrics, viewFrom } from '../engine/view';

/** 窗前视野：正对面多远是什么（楼间距），前方扇面有多开阔 */
function EyeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M1.5 8C3.2 5 5.4 3.5 8 3.5S12.8 5 14.5 8C12.8 11 10.6 12.5 8 12.5S3.2 11 1.5 8Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="2.1" fill="currentColor" />
    </svg>
  );
}

export function ViewSection({ data, index }: { data: SceneData; index: number }) {
  const [view, setView] = useState<ViewMetrics | null>(null);
  const shown = useApp((s) => s.viewshed === index);
  const toggleViewshed = useApp((s) => s.toggleViewshed);

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
      <div className="label-row">
        <div className="label">视野</div>
        {/* 与"再点一次这扇窗"等效；手机上没有悬停，靠这里打开 */}
        <button
          type="button"
          className="eye-toggle"
          aria-pressed={shown}
          onClick={() => toggleViewshed(index)}
        >
          <EyeIcon />
          视域
        </button>
      </div>
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
