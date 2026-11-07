import { Component, type ReactNode, Suspense, use, useState } from 'react';
import { sceneData } from './app/data';
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
      <Scene data={data} />
      <SearchBox data={data} />
      <TimeBar />
      <Inspector data={data} />
      <Attribution lines={data.district.attribution} />
    </>
  );
}

function Splash({ text }: { text: string }) {
  return (
    <div className="splash">
      <h1>见光</h1>
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
