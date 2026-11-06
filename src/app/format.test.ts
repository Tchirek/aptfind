import { describe, expect, it } from 'vitest';
import { formatClock, formatDuration, formatOrientation } from './format';

describe('format', () => {
  it('时长', () => {
    expect(formatDuration(0)).toBe('0 分钟');
    expect(formatDuration(45)).toBe('45 分钟');
    expect(formatDuration(120)).toBe('2 小时');
    expect(formatDuration(102.4)).toBe('1 小时 42 分');
  });

  it('时刻', () => {
    expect(formatClock(554)).toBe('09:14');
    expect(formatClock(960)).toBe('16:00');
  });

  it('朝向', () => {
    expect(formatOrientation(180)).toBe('朝南');
    expect(formatOrientation(136)).toBe('朝东南');
    expect(formatOrientation(168)).toBe('南偏东 12°');
    expect(formatOrientation(200)).toBe('南偏西 20°');
    expect(formatOrientation(10)).toBe('北偏东 10°');
    expect(formatOrientation(350)).toBe('北偏西 10°');
  });
});
