import { useSyncExternalStore } from 'react';

/** 订阅一条媒体查询 */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** 竖放的手机：详情用底部抽屉 */
export const SHEET_QUERY = '(max-width: 720px) and (min-height: 501px)';
