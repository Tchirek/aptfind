/**
 * 小区、校园的题图：pipeline 从高德地点详情里取的第一张照片，地块名 → 图片地址。
 * 文件不存在或某个地块没有图时，界面上就不显示题图。
 */

import { useEffect, useState } from 'react';

export interface Photo {
  name: string;
  url: string;
}

let photos: Promise<Record<string, string>> | null = null;

function load(): Promise<Record<string, string>> {
  photos ??= fetch(`${import.meta.env.BASE_URL}data/photos.json`)
    .then((r) => (r.ok ? (r.json() as Promise<Record<string, string>>) : {}))
    .catch(() => ({}));
  return photos;
}

/** 按顺序找第一个有图的地块名 */
export function usePhoto(names: readonly string[]): Photo | null {
  const key = names.join('\u0000');
  const [photo, setPhoto] = useState<Photo | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: key 就是 names 的内容
  useEffect(() => {
    let alive = true;
    load().then((map) => {
      if (!alive) return;
      const name = names.find((n) => map[n]);
      setPhoto(name ? { name, url: map[name] as string } : null);
    });
    return () => {
      alive = false;
    };
  }, [key]);
  return photo;
}
