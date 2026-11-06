import { useEffect } from 'react';
import { formatClock } from '../app/format';
import { type DayPreset, presetDate, useApp } from '../app/store';
import { trueSolarTimeToUtc, utcToBeijingMinutes } from '../engine/solar';

const DAYS: DayPreset[] = ['大寒', '冬至', '春分', '夏至'];
const LON = 104.12;
/** 光影模式的时间轴范围：真太阳时 6:30–17:30，覆盖冬季日出到日落 */
const MIN_TST = 6.5 * 60;
const MAX_TST = 17.5 * 60;
/** 播放时 1 秒走过的真太阳时分钟数 */
const PLAY_SPEED = 90;

export function TimeBar() {
  const mode = useApp((s) => s.mode);
  const day = useApp((s) => s.day);
  const tst = useApp((s) => s.tst);
  const playing = useApp((s) => s.playing);
  const { setDay, setTst, setPlaying } = useApp.getState();

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = useApp.getState().tst + ((now - last) / 1000) * PLAY_SPEED;
      last = now;
      setTst(t > MAX_TST ? MIN_TST : t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, setTst]);

  const date = presetDate(day);
  const bj = utcToBeijingMinutes(trueSolarTimeToUtc(date, tst, LON));

  return (
    <div className="panel timebar">
      <fieldset className="days" aria-label="日期">
        {DAYS.map((d) => {
          const dd = presetDate(d);
          return (
            <button
              type="button"
              key={d}
              aria-pressed={d === day}
              className={d === day ? 'chip on' : 'chip'}
              onClick={() => setDay(d)}
            >
              {d}
              <small>
                {dd.month}/{dd.day}
              </small>
            </button>
          );
        })}
      </fieldset>
      {mode === 'shadow' ? (
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
            min={MIN_TST}
            max={MAX_TST}
            step={1}
            value={tst}
            onChange={(e) => {
              setPlaying(false);
              setTst(Number(e.target.value));
            }}
            aria-label="时刻"
          />
          <div className="readout">
            <span className="mono">{formatClock(bj)}</span>
            <small>北京时间 · 真太阳时 {formatClock(tst)}</small>
          </div>
        </div>
      ) : (
        <p className="timebar-note">
          外墙格子按<strong>大寒日</strong>真太阳时 8–16
          时的累计日照着色。切换日期会改变点选窗位的时段条。
        </p>
      )}
    </div>
  );
}
