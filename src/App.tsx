import { Component, type ReactNode, Suspense, use } from 'react';
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

function Main() {
  const data = use(sceneData);
  const mode = useApp((s) => s.mode);
  return (
    <>
      <Scene data={data} />
      <header className="brand">
        <h1>见光</h1>
        <p>成都 · 狮子山片区 · 逐窗日照</p>
      </header>
      <ModeSwitch />
      <TimeBar />
      {mode === 'hours' && <Legend />}
      <Inspector data={data} />
      <footer className="attribution">
        {data.district.attribution.map((a) => (
          <span key={a}>{a}</span>
        ))}
      </footer>
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
      <Suspense fallback={<Splash text="正在载入狮子山片区 4212 栋楼……" />}>
        <Main />
      </Suspense>
    </ErrorBoundary>
  );
}
