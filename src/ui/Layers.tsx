import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app/store';
import { TRAFFIC_LEVELS } from '../engine/flows';
import { PROFILE_KEYS, PROFILES } from '../engine/profiles';
import { CROWD_COLOR, TRAFFIC_COLORS } from '../scene/trafficStyle';
import './layers.css';

function LayersIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 2.5 18 7l-8 4.5L2 7z" fill="currentColor" />
      <path d="m3.6 10.1-1.6.9 8 4.5 8-4.5-1.6-.9L10 13.7z" fill="currentColor" opacity="0.55" />
    </svg>
  );
}

function TrafficKey() {
  return (
    <div className="lg-traffic">
      {TRAFFIC_LEVELS.map((label, i) => (
        <span key={label}>
          <i style={{ background: TRAFFIC_COLORS[i] }} />
          {label}
        </span>
      ))}
    </div>
  );
}

function CrowdKey() {
  return (
    <div className="lg-crowd">
      <span>稀</span>
      <i style={{ background: `linear-gradient(90deg, ${CROWD_COLOR}14, ${CROWD_COLOR})` }} />
      <span>密</span>
    </div>
  );
}

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`lg-switch${on ? ' on' : ''}`}
      onClick={() => onChange(!on)}
    >
      <span className="lg-switch-track" aria-hidden>
        <span />
      </span>
      {label}
    </button>
  );
}

/** 价值取向：换一种人的需求，屋顶颜色和评分都跟着变 */
function ProfilePicker() {
  const profile = useApp((s) => s.profile);
  const setProfile = useApp((s) => s.setProfile);
  return (
    <div className="layers-row">
      <div className="layers-title">价值取向</div>
      <div className="lg-profiles" role="radiogroup" aria-label="价值取向">
        {PROFILE_KEYS.map((key) => (
          <label key={key} className={profile === key ? 'on' : ''}>
            <input
              type="radio"
              name="profile"
              checked={profile === key}
              onChange={() => setProfile(key)}
            />
            {PROFILES[key].label}
          </label>
        ))}
      </div>
    </div>
  );
}

/**
 * 图层：右上角的按钮，点开后可以开关"典型路况"与"人流热度"（各带图例），再选价值取向；
 * 宽屏上图层打开时，左下角常驻一张小图例。
 */
export function Layers() {
  const layers = useApp((s) => s.layers);
  const setLayer = useApp((s) => s.setLayer);
  const profile = useApp((s) => s.profile);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <>
      <div className="layers" ref={root}>
        {profile !== 'balanced' && !open && (
          <span className="layers-tag">{PROFILES[profile].label}</span>
        )}
        <button
          type="button"
          className={`layers-btn${open ? ' on' : ''}`}
          aria-label="图层"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <LayersIcon />
        </button>
        {open && (
          <div className="panel layers-pop">
            <div className="layers-row">
              <div className="layers-title">图层</div>
              <Toggle
                on={layers.traffic}
                onChange={(v) => setLayer('traffic', v)}
                label="典型路况"
              />
              <TrafficKey />
            </div>
            <div className="layers-row">
              <Toggle on={layers.crowd} onChange={(v) => setLayer('crowd', v)} label="人流热度" />
              <CrowdKey />
            </div>
            <ProfilePicker />
          </div>
        )}
      </div>
      {(layers.traffic || layers.crowd) && (
        <div className="panel layers-legend" aria-hidden>
          {layers.traffic && (
            <div className="layers-legend-row">
              <b>路况</b>
              <TrafficKey />
            </div>
          )}
          {layers.crowd && (
            <div className="layers-legend-row">
              <b>人流</b>
              <CrowdKey />
            </div>
          )}
        </div>
      )}
    </>
  );
}
