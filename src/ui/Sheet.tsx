import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import './sheet.css';

type State = 'hidden' | 'peek' | 'full';

/** 抽屉里放标题的位置：详情组件把标题传送过去，正文留在原处 */
const HeadSlot = createContext<HTMLElement | null>(null);

/** 详情的外框：桌面上标题与正文挨着；在抽屉里标题进把手区 */
export function Frame({ head, children }: { head: ReactNode; children: ReactNode }) {
  const slot = useContext(HeadSlot);
  return (
    <>
      {slot ? createPortal(head, slot) : head}
      {children}
    </>
  );
}

/** 抽屉把手 + 标题区的高度之外，收起时再多露这么多 */
const PEEK_PAD = 6;
const DRAG_SLOP = 6;

/**
 * 手机上的详情：从屏幕底边滑出，先收起只露标题，不挡画面主体；
 * 拖动把手或标题区上拉展开，下拉收起，收起时再下拉就关掉。点标题区也能展开。
 * 收起时的高度写进 --sheet-h，时间栏据此浮在抽屉上沿。
 */
export function Sheet({
  children,
  onClose,
  openKey,
}: {
  children: ReactNode;
  onClose: () => void;
  /** 换了选中的东西：已收起的保持收起，已展开的保持展开，滚动回顶部 */
  openKey: string;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  const grip = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State>('hidden');
  const [dims, setDims] = useState({ h: 0, peek: 0 });
  const [drag, setDrag] = useState<number | null>(null);
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const start = useRef<{ y: number; t: number; base: number; moved: boolean } | null>(null);

  // 量抽屉与标题区的高度
  useLayoutEffect(() => {
    const s = sheet.current;
    const g = grip.current;
    if (!s || !g) return;
    // 题图只在展开时出现，收起高度不算它
    const measure = () => {
      const photo = g.querySelector<HTMLElement>('.head-photo');
      const extra = photo
        ? photo.offsetHeight + Number.parseFloat(getComputedStyle(photo).marginBottom)
        : 0;
      setDims({ h: s.offsetHeight, peek: g.offsetHeight - extra + PEEK_PAD });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(s);
    ro.observe(g);
    const mo = new MutationObserver(measure);
    mo.observe(g, { childList: true, subtree: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, []);

  // 挂上后下一帧滑到收起位置，过渡动画才走得起来
  useEffect(() => {
    const id = requestAnimationFrame(() => setState('peek'));
    return () => cancelAnimationFrame(id);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: openKey 变了才回到顶部
  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
  }, [openKey]);

  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty('--sheet-h', state === 'hidden' ? '0px' : `${dims.peek}px`);
    return () => root.setProperty('--sheet-h', '0px');
  }, [state, dims.peek]);

  const offsetOf = (s: State) => (s === 'full' ? 0 : s === 'peek' ? dims.h - dims.peek : dims.h);

  const close = () => {
    setState('hidden');
    window.setTimeout(onClose, 280);
  };

  // 处理函数挂在抽屉根上：标题是传送进把手区的，React 事件沿组件树冒泡到这里，
  // 再按 DOM 判断是不是按在把手区
  const onDown = (e: React.PointerEvent) => {
    const t = e.target as HTMLElement;
    if (!grip.current?.contains(t) || t.closest('button, a, input')) return;
    start.current = { y: e.clientY, t: performance.now(), base: offsetOf(state), moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s) return;
    const dy = e.clientY - s.y;
    if (!s.moved && Math.abs(dy) < DRAG_SLOP) return;
    s.moved = true;
    // 往上拉过头时加阻尼
    const raw = s.base + dy;
    setDrag(raw < 0 ? raw * 0.25 : raw);
  };
  const onUp = (e: React.PointerEvent) => {
    const s = start.current;
    start.current = null;
    setDrag(null);
    if (!s) return;
    if (!s.moved) {
      if (state === 'peek') setState('full');
      return;
    }
    const dy = e.clientY - s.y;
    const v = dy / Math.max(1, performance.now() - s.t); // px/ms，正为向下
    if (state === 'full') {
      if (dy > dims.h - dims.peek + 60) close();
      else if (dy > 90 || v > 0.45) setState('peek');
    } else if (dy < -40 || v < -0.35) {
      setState('full');
    } else if (dy > 40 || v > 0.35) {
      close();
    }
  };

  const y = drag ?? offsetOf(state);
  return (
    <div
      ref={sheet}
      className={`sheet ${state}${drag !== null ? ' dragging' : ''}`}
      style={{ transform: dims.h ? `translateY(${y}px)` : 'translateY(100%)' }}
      role="dialog"
      aria-modal="false"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <div ref={grip} className="sheet-grip">
        <div className="sheet-handle" aria-hidden />
        <div ref={setSlot} />
        <button type="button" className="close" onClick={close} aria-label="关闭">
          ×
        </button>
      </div>
      <div ref={body} className="sheet-body">
        <HeadSlot.Provider value={slot}>{slot && children}</HeadSlot.Provider>
      </div>
    </div>
  );
}
