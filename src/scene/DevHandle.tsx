import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { useApp } from '../app/store';

/** 开发模式下把场景与状态挂到 window，便于在浏览器里调试验收 */
export function DevHandle() {
  const get = useThree((s) => s.get);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__jg = { three: get, app: useApp };
  }, [get]);
  return null;
}
