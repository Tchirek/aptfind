import { useEffect } from 'react';
import { formatClock } from '../app/format';
import { useApp } from '../app/store';
import { dateToIso, isoToDate, TERM_PICKS, upcomingTerm } from '../app/time';

/** 播放时 1 秒走过的分钟数 */
const PLAY_SPEED = 60;

export function TimeBar() {
  const date = useApp((s) => s.date);
  const minute = useApp((s) => s.minute);
  const live = useApp((s) => s.live);
  const playing = useApp((s) => s.playing);
  const { setDate, setMinute, setPlaying, goLive, syncNow } = useApp.getState();

  // 跟随现在：半分钟同步一次
  useEffect(() => {
    const id = setInterval(syncNow, 30_000);
    return () => clearInterval(id);
  }, [syncNow]);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const m = useApp.getState().minute + ((now - last) / 1000) * PLAY_SPEED;
      last = now;
      useApp.setState({ minute: m % 1440 });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const today = useApp.getState().live ? date : undefined;

  return (
    <div className="panel timebar">
      <div className="days">
        <input
          type="date"
          value={dateToIso(date)}
          onChange={(e) => {
            const d = isoToDate(e.target.value);
            if (d) setDate(d);
          }}
          aria-label="日期"
        />
        {TERM_PICKS.map((term) => {
          const d = upcomingTerm(term, today ?? date);
          return (
            <button type="button" key={term} className="chip" onClick={() => setDate(d)}>
              {term}
            </button>
          );
        })}
      </div>
      <div className="clock">
        <button
          type="button"
          className="play"
          onClick={() => setPlaying(!playing)}
          aria-label={playing ? '暂停' : '播放'}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <input
          type="range"
          min={0}
          max={1439}
          step={1}
          value={minute}
          onChange={(e) => {
            setPlaying(false);
            setMinute(Number(e.target.value));
          }}
          aria-label="时刻"
        />
        <div className="readout">
          <span className="mono">{formatClock(minute)}</span>
          {!live && (
            <button type="button" className="chip" onClick={goLive}>
              现在
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
