import { type CSSProperties, useEffect, useRef, useState } from 'react';
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
import { SHEET_QUERY, useMedia } from './useMedia';

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

/** 太阳：白天 */
function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="3" fill="currentColor" />
      <path
        d="M8 1.2v1.8M8 13v1.8M1.2 8H3M13 8h1.8M3.2 3.2l1.3 1.3M11.5 11.5l1.3 1.3M3.2 12.8l1.3-1.3M11.5 4.5l1.3-1.3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 月牙：夜里 */
function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M10.8 2.2A6 6 0 1 0 13.8 11 5 5 0 0 1 10.8 2.2Z" fill="currentColor" />
    </svg>
  );
}

export function TimeBar() {
  const ref = useRef<HTMLDivElement>(null);
  const date = useApp((s) => s.date);
  const minute = useApp((s) => s.minute);
  const live = useApp((s) => s.live);
  const playing = useApp((s) => s.playing);
  const { setDate, setMinute, setPlaying, goLive, syncNow } = useApp.getState();
  // 竖放的手机上整块时间面板默认收起，地图右下角的浮动按钮唤出（学 Google 地图的做法）；
  // 桌面上一直显示，这个状态不起作用
  const compact = useMedia(SHEET_QUERY);
  const [open, setOpen] = useState(false);
  const shown = !compact || open;
  const swipe = useRef<number | null>(null);

  const { sunrise, sunset } = dayTimes(date);

  // 面板高度写进 CSS 变量：手机上的详情面板要恰好落在这条时间栏上方
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const publish = () =>
      document.documentElement.style.setProperty('--timebar-h', `${el.offsetHeight}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
    `#d6dee9 0%, #d6dee9 ${sunrisePct}%, ` +
    `#efc98a ${sunrisePct}%, #efc98a ${sunsetPct}%, ` +
    `#d6dee9 ${sunsetPct}%, #d6dee9 100%)`;

  return (
    <>
      {compact && (
        <button
          type="button"
          className={`tb-fab${shown ? ' away' : ''}`}
          onClick={() => setOpen(true)}
          aria-label="时间与日期"
          aria-expanded={open}
        >
          {minute >= sunrise && minute <= sunset ? <SunIcon /> : <MoonIcon />}
          <span className="mono">{formatClock(minute)}</span>
          {!sameDate(date, nowBeijing().date) && (
            <small>
              {date.month}/{date.day}
            </small>
          )}
        </button>
      )}
      <div className={`panel timebar${shown ? '' : ' away'}`} ref={ref} inert={!shown}>
        {compact && (
          <button
            type="button"
            className="tb-grip"
            aria-label="收起"
            onClick={() => setOpen(false)}
            onPointerDown={(e) => {
              swipe.current = e.clientY;
            }}
            onPointerUp={(e) => {
              // 往下一划也收起
              if (swipe.current !== null && e.clientY - swipe.current > 24) setOpen(false);
              swipe.current = null;
            }}
          >
            <i />
          </button>
        )}
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
            <input
              type="range"
              className="tb-range"
              style={{ '--track': trackGradient } as CSSProperties}
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
    </>
  );
}
