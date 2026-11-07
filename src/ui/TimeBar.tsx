import { useEffect } from 'react';
import { formatClock } from '../app/format';
import { useApp } from '../app/store';
import {
  dateToIso,
  dayTimes,
  isoToDate,
  nowBeijing,
  sameDate,
  TERM_PICKS,
  upcomingTerm,
} from '../app/time';
import './timebar.css';

const PLAY_SPEED = 40;

function PlayIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <polygon points="3,1 11,6 3,11" fill="currentColor" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <rect x="2" y="1" width="3" height="10" fill="currentColor" />
      <rect x="7" y="1" width="3" height="10" fill="currentColor" />
    </svg>
  );
}

/** 逆时针箭头绕着一个点：回到现在 */
function NowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3.2 6.2A5.2 5.2 0 1 1 3 9.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M1.6 3.4v3.4H5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="1.4" fill="currentColor" />
    </svg>
  );
}

export function TimeBar() {
  const date = useApp((s) => s.date);
  const minute = useApp((s) => s.minute);
  const live = useApp((s) => s.live);
  const playing = useApp((s) => s.playing);
  const { setDate, setMinute, setPlaying, goLive, syncNow } = useApp.getState();

  const { sunrise, sunset } = dayTimes(date);

  useEffect(() => {
    const id = setInterval(syncNow, 30_000);
    return () => clearInterval(id);
  }, [syncNow]);

  useEffect(() => {
    if (!playing) return;

    const s0 = useApp.getState();
    const { sunrise: sr, sunset: ss } = dayTimes(s0.date);
    const rangeStart = sr - 30;
    const rangeEnd = ss + 30;
    if (s0.minute < rangeStart || s0.minute > rangeEnd) {
      useApp.setState({ minute: rangeStart });
    }

    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const s = useApp.getState();
      const { sunrise: sr2, sunset: ss2 } = dayTimes(s.date);
      const rs = sr2 - 30;
      const re = ss2 + 30;
      const dt = (now - last) / 1000;
      last = now;
      let m = s.minute + dt * PLAY_SPEED;
      if (m < rs) m = rs;
      if (re > rs && m > re) {
        m = rs + ((m - rs) % (re - rs));
      }
      useApp.setState({ minute: m });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const sunrisePct = (sunrise / 1440) * 100;
  const sunsetPct = (sunset / 1440) * 100;
  const trackGradient =
    `linear-gradient(to right, ` +
    `#d9d5cc 0%, #d9d5cc ${sunrisePct}%, ` +
    `#efc98a ${sunrisePct}%, #efc98a ${sunsetPct}%, ` +
    `#d9d5cc ${sunsetPct}%, #d9d5cc 100%)`;

  return (
    <div className="panel timebar">
      <div className="tb-date-row">
        <input
          type="date"
          className="tb-date-input"
          value={dateToIso(date)}
          onChange={(e) => {
            const d = isoToDate(e.target.value);
            if (d) setDate(d);
          }}
          aria-label="日期"
        />
        <fieldset className="tb-terms" aria-label="节气">
          {TERM_PICKS.map((term) => {
            const d = upcomingTerm(term, nowBeijing().date);
            const selected = sameDate(date, d);
            return (
              <button
                type="button"
                key={term}
                className={`tb-term${selected ? ' on' : ''}`}
                aria-pressed={selected}
                onClick={() => setDate(d)}
              >
                {term}
                <small>
                  {d.month}/{d.day}
                </small>
              </button>
            );
          })}
        </fieldset>
      </div>

      <div className="tb-time-row">
        <button
          type="button"
          className="tb-play"
          onClick={() => setPlaying(!playing)}
          aria-label={playing ? '暂停' : '播放'}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>

        <div className="tb-slider-wrap">
          <div className="tb-track" style={{ background: trackGradient }} />
          <input
            type="range"
            className="tb-range"
            min={0}
            max={1439}
            step={1}
            value={Math.round(minute)}
            onChange={(e) => {
              setPlaying(false);
              setMinute(Number(e.target.value));
            }}
            aria-label="时刻"
          />
          <div className="tb-ticks">
            <span>0</span>
            <span>6</span>
            <span>12</span>
            <span>18</span>
            <span>24</span>
          </div>
        </div>

        <div className="tb-readout">
          <div className="tb-clock">
            {/* 位置一直留着，手动改过时间才出现，不撑高面板 */}
            <button
              type="button"
              className="tb-go-live"
              onClick={goLive}
              aria-label="回到现在"
              title="回到现在"
              disabled={live}
            >
              <NowIcon />
            </button>
            <span className="mono tb-clock-time">{formatClock(minute)}</span>
          </div>
          <div className="tb-sun-info">
            日出 {formatClock(sunrise)} · 日落 {formatClock(sunset)}
          </div>
        </div>
      </div>
    </div>
  );
}
