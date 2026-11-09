/** 地图四周被界面挡住的像素：取景时把内容摆进剩下的部分 */
export function mapInsets(): { left: number; right: number; top: number; bottom: number } {
  const rect = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
  const top = (rect('.search-box')?.bottom ?? 0) + 12;
  // 手机上详情收在底部抽屉里，只算它收起时的高度
  if (document.querySelector('.sheet')) {
    const peek = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--sheet-h'),
    );
    return { left: 12, right: 12, top, bottom: (Number.isFinite(peek) ? peek : 0) + 12 };
  }
  const panel = rect('.inspector');
  const bar = rect('.timebar');
  return {
    left: 16,
    right: panel ? window.innerWidth - panel.left + 16 : 16,
    top,
    bottom: bar ? window.innerHeight - bar.top + 12 : 16,
  };
}
