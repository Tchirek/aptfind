import { Component, type ReactNode, Suspense, use, useState } from 'react';
import { sceneData } from './app/data';
import { useApp } from './app/store';
import { Scene } from './scene/Scene';
import { Inspector } from './ui/Inspector';
import { Legend } from './ui/Legend';
import { TimeBar } from './ui/TimeBar';

function ModeSwitch() {
  const mode = useApp((s) => s.mode);
  const setMode = useApp((s) => s.setMode);
  return (
    <fieldset className="panel mode-switch" aria-label="显示">
      <button
        type="button"
        aria-pressed={mode === 'hours'}
        className={mode === 'hours' ? 'on' : ''}
        onClick={() => setMode('hours')}
      >
        日照时数
      </button>
      <button
        type="button"
        aria-pressed={mode === 'shadow'}
        className={mode === 'shadow' ? 'on' : ''}
        onClick={() => setMode('shadow')}
      >
        光影
      </button>
    </fieldset>
  );
}

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
  const mode = useApp((s) => s.mode);
  return (
    <>
      <Scene data={data} />
      <ModeSwitch />
      <TimeBar />
      {mode === 'hours' && <Legend />}
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
