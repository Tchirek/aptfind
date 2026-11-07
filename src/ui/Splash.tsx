import '@fontsource/cormorant-garamond/latin-300.css';
import { useEffect, useState } from 'react';
import { sceneData } from '../app/data';
import './splash.css';

/** 片区数据之外的来源；片区数据自带的几条（建筑、地形、OSM、高德）排在前面 */
const EXTRA_CREDITS = [
  '星表：HYG Database v4.1（astronexus，CC BY-SA 4.0）',
  '住宅基准地价：成都市规划和自然资源局《成都市中心城区土地定级与基准地价更新成果（2024 版）》；四川师大站 TOD 成交楼面价取自 2020 年 11 月土地出让结果',
  '宜居评分：分维度上限、对数与饱和曲线、封顶扣分的确定性规则，方法参考 ghfind',
  '车流人流：按成都交管通报的拥堵指数、成都地铁分时客流、国务院节假日安排与成都中小学和川师校历的时间规律，结合 OSM 道路等级与车道、高德设施分布推算',
  '品牌标志：麦当劳、肯德基、星巴克、盒马的商标归各自所有者，仅用于标示门店位置；麦当劳、肯德基、星巴克图形取自 Simple Icons',
];

/** 数据到齐后至少停留这么久，来源读得完 */
const HOLD_MS = 2600;
const FADE_MS = 700;

/**
 * 启屏：黑底白字的 aptfind，数据到齐后列出完整的数据来源，停留片刻淡出；
 * 数据到齐之后点一下或按任意键可以提前进入。
 */
export function Splash({ error }: { error?: string }) {
  const [credits, setCredits] = useState<string[] | null>(null);
  const [phase, setPhase] = useState<'show' | 'fade' | 'gone'>('show');

  useEffect(() => {
    let alive = true;
    sceneData
      .then((d) => {
        if (alive) setCredits([...d.district.attribution, ...EXTRA_CREDITS]);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!credits || error) return;
    const t = window.setTimeout(() => setPhase('fade'), HOLD_MS);
    const skip = () => setPhase('fade');
    window.addEventListener('pointerdown', skip);
    window.addEventListener('keydown', skip);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('pointerdown', skip);
      window.removeEventListener('keydown', skip);
    };
  }, [credits, error]);

  useEffect(() => {
    if (phase !== 'fade') return;
    const t = window.setTimeout(() => setPhase('gone'), FADE_MS);
    return () => window.clearTimeout(t);
  }, [phase]);

  if (phase === 'gone' && !error) return null;
  return (
    <div className={`splash${phase === 'fade' && !error ? ' out' : ''}`} aria-live="polite">
      <div className="splash-main">
        <h1>aptfind</h1>
        {error ? (
          <p className="splash-error">{error}</p>
        ) : (
          <div className={`splash-load${credits ? ' done' : ''}`} aria-hidden />
        )}
      </div>
      <ul className={`splash-credits${credits ? ' in' : ''}`}>
        {credits?.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
    </div>
  );
}
