import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import './sheet.css';

type State = 'hidden' | 'peek' | 'full';

/** 收起时标题下面再多露这么多 */
const PEEK_PAD = 10;
const DRAG_SLOP = 6;
const ANIM_MS = 340;

/** 详情的外框：标题与正文挨着排（抽屉里也一样，题图随正文一起滚走） */
export function Frame({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <>
      {head}
      {children}
    </>
  );
}

/**
 * 手机上的详情：从屏幕底边滑出，先收起只露标题，不挡画面主体。
 * - 收起时整个抽屉都能拖，往上拉或点一下展开；往下拉关掉；
 * - 展开时拖把手收起或关掉；正文照常滚动，题图在标题上方，往下看时随正文滚走；
 * - 拖动时直接改 transform，不经 React 重渲染，跟手不卡。
 * 收起时的高度写进 --sheet-h，时间按钮与时间面板据此浮在抽屉上沿。
 */
export function Sheet({
  children,
  onClose,
  openKey,
}: {
  children: ReactNode;
  onClose: () => void;
  /** 换了选中的东西：保持收起或展开，滚动回到合适的位置 */
  openKey: string;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  const grip = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State>('hidden');
  const [dims, setDims] = useState({ h: 0, peek: 0, photo: 0 });
  const drag = useRef<{ y: number; t: number; base: number; moved: boolean } | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  // 量抽屉、把手、标题与题图：收起高度 = 把手 + 标题（不含题图）
  const measure = useCallback(() => {
    const s = sheet.current;
    const g = grip.current;
    const b = body.current;
    if (!s || !g || !b) return;
    const head = b.querySelector<HTMLElement>('.inspector-head');
    const photo = head?.querySelector<HTMLElement>('.head-photo');
    const photoH = photo
      ? photo.offsetHeight + Number.parseFloat(getComputedStyle(photo).marginBottom)
      : 0;
    const headH = head ? head.offsetHeight - photoH : 0;
    const next = { h: s.offsetHeight, peek: g.offsetHeight + headH + PEEK_PAD, photo: photoH };
    setDims((prev) =>
      prev.h === next.h && prev.peek === next.peek && prev.photo === next.photo ? prev : next,
    );
  }, []);

  useLayoutEffect(() => {
    const s = sheet.current;
    const b = body.current;
    if (!s || !b) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(s);
    const watchHead = () => {
      const head = b.querySelector('.inspector-head');
      if (head) ro.observe(head);
      measure();
    };
    watchHead();
    // 换了选中的东西，标题元素会换掉：只看正文的直接子元素，不跟着内容的每次更新重量
    const mo = new MutationObserver(watchHead);
    mo.observe(b, { childList: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [measure]);

  // 挂上后下一帧滑到收起位置，过渡动画才走得起来
  useEffect(() => {
    const id = requestAnimationFrame(() => setState('peek'));
    return () => cancelAnimationFrame(id);
  }, []);

  // 收起时正文停在标题处（题图藏在上方）；展开时滚回顶部，题图在标题上方露出来
  // biome-ignore lint/correctness/useExhaustiveDependencies: openKey 变了也要重新对位
  useEffect(() => {
    const b = body.current;
    if (!b) return;
    if (state === 'full') b.scrollTo({ top: 0, behavior: 'smooth' });
    else b.scrollTo({ top: dims.photo });
  }, [state, dims.photo, openKey]);

  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty('--sheet-h', state === 'hidden' ? '0px' : `${dims.peek}px`);
    return () => root.setProperty('--sheet-h', '0px');
  }, [state, dims.peek]);

  const offsetOf = (s: State) => (s === 'full' ? 0 : s === 'peek' ? dims.h - dims.peek : dims.h);

  const setY = (y: number, animate: boolean) => {
    const el = sheet.current;
    if (!el) return;
    el.classList.toggle('dragging', !animate);
    el.style.transform = `translate3d(0, ${y}px, 0)`;
  };

  const close = () => {
    setState('hidden');
    window.setTimeout(onClose, ANIM_MS);
  };

  const onDown = (e: React.PointerEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('button, a, input, select')) return;
    // 收起时整块都能拖；展开时只有把手区能拖，正文留给滚动
    if (stateRef.current === 'full' && !grip.current?.contains(t)) return;
    drag.current = {
      y: e.clientY,
      t: performance.now(),
      base: offsetOf(stateRef.current),
      moved: false,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dy) < DRAG_SLOP) return;
    d.moved = true;
    const raw = d.base + dy;
    // 往上拉过头时加阻尼
    setY(raw < 0 ? raw * 0.25 : raw, false);
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const s = stateRef.current;
    if (!d.moved) {
      if (s === 'peek') setState('full');
      return;
    }
    const dy = e.clientY - d.y;
    const v = dy / Math.max(1, performance.now() - d.t); // px/ms，正为向下
    let next: State = s;
    if (s === 'full') {
      if (dy > dims.h - dims.peek + 60) next = 'hidden';
      else if (dy > 90 || v > 0.45) next = 'peek';
    } else if (dy < -40 || v < -0.35) next = 'full';
    else if (dy > 40 || v > 0.35) next = 'hidden';
    setY(offsetOf(next), true);
    if (next === 'hidden') close();
    else setState(next);
  };

  // 状态变化时由 React 设定位置（带过渡）
  const y = dims.h ? offsetOf(state) : null;
  return (
    <div
      ref={sheet}
      className={`sheet ${state}`}
      style={{ transform: y === null ? 'translate3d(0, 100%, 0)' : `translate3d(0, ${y}px, 0)` }}
      role="dialog"
      aria-modal="false"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <div ref={grip} className="sheet-grip">
        <div className="sheet-handle" aria-hidden />
        <button type="button" className="close" onClick={close} aria-label="关闭">
          ×
        </button>
      </div>
      <div ref={body} className="sheet-body">
        {children}
      </div>
    </div>
  );
}
