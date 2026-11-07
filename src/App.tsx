import { Component, type ReactNode, Suspense, use, useState } from 'react';
import { SunlightController } from './app/buildingSunlight';
import { sceneData } from './app/data';
import { LivabilityController } from './app/livability';
import { ReachController } from './app/reach';
import { Scene } from './scene/Scene';
import { Inspector } from './ui/Inspector';
import { SearchBox } from './ui/SearchBox';
import { TimeBar } from './ui/TimeBar';

function Attribution({ lines }: { lines: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="attribution-wrap">
      {open && (
        <div className="panel attribution-panel">
          {lines.map((a) => (
            <div key={a}>{a}</div>
          ))}
        </div>
      )}
      <button type="button" className="attribution-btn" onClick={() => setOpen(!open)}>
        数据来源
      </button>
    </div>
  );
}

function Main() {
  const data = use(sceneData);
  return (
    <>
      <SunlightController data={data} />
      <ReachController data={data} />
      <LivabilityController data={data} />
      <Scene data={data} />
      <SearchBox data={data} />
      <TimeBar />
      <Inspector data={data} />
      <Attribution
        lines={[
          ...data.district.attribution,
          '星表：HYG Database v4.1（astronexus，CC BY-SA 4.0）',
          '品牌标志：麦当劳、星巴克、海底捞的商标归各自所有者，仅用于标示门店位置；图形取自 Simple Icons 与维基百科',
          '住宅基准地价：成都市规划和自然资源局《成都市中心城区土地定级与基准地价更新成果（2024 版）》；四川师大站 TOD 成交楼面价取自 2020 年 11 月土地出让结果',
          '宜居评分：按分维度上限、对数与饱和曲线、封顶扣分的确定性规则计算，方法参考 ghfind',
        ]}
      />
    </>
  );
}

function Splash({ text }: { text: string }) {
  return (
    <div className="splash">
      <h1>aptfind</h1>
      <p>{text}</p>
    </div>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) return <Splash text={`载入失败：${this.state.error.message}`} />;
    return this.props.children;
  }
}

export function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<Splash text="载入中" />}>
        <Main />
      </Suspense>
    </ErrorBoundary>
  );
}
