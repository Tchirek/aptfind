/**
 * 价值取向：同一份事实，按不同的人在乎什么重新加权。
 *
 * 没有哪个总分能同时回答"上班方便吗""孩子上学怎样""能不能清静""值不值得投"，
 * 一个总分硬要回答所有问题，就只能什么都答不好。每种取向的权重加起来是 100，
 * 权重为 0 的维度不参与、也不显示。依据和曲线都在 livability.ts，这里只决定谁重要。
 */

import type { Dimension } from './livability';

export type ProfileKey = 'balanced' | 'commute' | 'family' | 'leisure' | 'quiet' | 'invest';

export interface Profile {
  key: ProfileKey;
  /** 按钮上的短名 */
  label: string;
  /** 面板上评分一栏的标题 */
  title: string;
  weights: Partial<Record<Dimension['key'], number>>;
  /** 扣分项的倍率：清静已把噪声算进维度里，投资不看这些 */
  noise: number;
  food: number;
  /** 这个维度算不出来时，这种取向没有分数 */
  requires?: Dimension['key'];
  /**
   * 屋顶色阶的节点。多数取向按片区分位，五档颜色都有楼；
   * 投资看的是绝对回报，跑不赢房贷就该是红的，不能因为"相对好一点"染成绿色。
   */
  absoluteStops?: readonly number[];
}

export const PROFILES: Record<ProfileKey, Profile> = {
  balanced: {
    key: 'balanced',
    label: '综合',
    title: '宜居评分',
    weights: {
      light: 22,
      transit: 16,
      amenity: 14,
      education: 8,
      environment: 14,
      building: 12,
      quality: 14,
    },
    noise: 1,
    food: 1,
  },
  commute: {
    key: 'commute',
    label: '上班租房',
    title: '上班租房',
    weights: { commute: 32, rent: 22, transit: 14, amenity: 16, light: 8, building: 8 },
    noise: 1,
    food: 1,
  },
  family: {
    key: 'family',
    label: '子女上学',
    title: '子女上学',
    weights: {
      education: 32,
      schoolGroup: 14,
      light: 14,
      quality: 12,
      environment: 10,
      building: 10,
      amenity: 8,
    },
    noise: 1,
    food: 1,
  },
  leisure: {
    key: 'leisure',
    label: '躺平',
    title: '躺平',
    weights: {
      amenity: 26,
      price: 24,
      environment: 18,
      light: 14,
      quality: 6,
      building: 6,
      transit: 6,
    },
    noise: 1,
    food: 0.5,
  },
  quiet: {
    key: 'quiet',
    label: '清静',
    title: '清静',
    weights: { quiet: 46, environment: 22, light: 14, quality: 12, building: 6 },
    noise: 0,
    food: 0,
  },
  invest: {
    key: 'invest',
    label: '投资',
    title: '投资回报',
    weights: { returns: 85, transit: 15 },
    noise: 0,
    food: 0,
    requires: 'returns',
    absoluteStops: [35, 50, 62, 72, 85],
  },
};

export const PROFILE_KEYS = Object.keys(PROFILES) as ProfileKey[];
