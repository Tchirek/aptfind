import { Component, type ReactNode, Suspense, use } from 'react';
import { SunlightController } from './app/buildingSunlight';
import { sceneData } from './app/data';
import { LivabilityController } from './app/livability';
import { ReachController } from './app/reach';
import { Scene } from './scene/Scene';
import { Inspector } from './ui/Inspector';
import { Layers } from './ui/Layers';
import { SearchBox } from './ui/SearchBox';
import { Splash } from './ui/Splash';
import { TimeBar } from './ui/TimeBar';

function Main() {
  const data = use(sceneData);
  return (
    <>
      <SunlightController data={data} />
      <ReachController data={data} />
      <LivabilityController data={data} />
      <Scene data={data} />
      <SearchBox data={data} />
      <Layers />
      <TimeBar />
      <Inspector data={data} />
    </>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) return <Splash error={`载入失败：${this.state.error.message}`} />;
    return this.props.children;
  }
}

export function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={null}>
        <Main />
      </Suspense>
      <Splash />
    </ErrorBoundary>
  );
}
