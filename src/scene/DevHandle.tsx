import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { useApp } from '../app/store';

/**
 * 开发模式下把场景与状态挂到 window，便于在浏览器里调试验收。
 * shot(name)：手动推进几帧、把画布存成 JPEG，经开发服务器的 /__collect 落盘
 * （浏览器窗口被隐藏、无法截屏时用）。
 */
export function DevHandle() {
  const get = useThree((s) => s.get);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const shot = async (name: string, width = 1280, height = 800) => {
      const st = get();
      st.gl.setSize(width, height, false);
      if ('aspect' in st.camera) {
        st.camera.aspect = width / height;
        st.camera.updateProjectionMatrix();
      }
      for (let i = 0; i < 4; i++) st.advance(performance.now());
      const url = st.gl.domElement.toDataURL('image/jpeg', 0.85);
      const res = await fetch(`/__collect?name=${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      return res.status;
    };
    (window as unknown as Record<string, unknown>).__jg = { three: get, app: useApp, shot };
  }, [get]);
  return null;
}
