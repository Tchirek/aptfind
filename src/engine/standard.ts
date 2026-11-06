/**
 * 住宅日照标准。
 *
 * GB 50180-2018《城市居住区规划设计标准》第 4.0.9 条：成都属Ⅲ类建筑气候区、
 * 城区常住人口 ≥ 50 万，住宅建筑日照标准为大寒日日照时数 ≥ 2 h，
 * 有效日照时间带为当地真太阳时 8 时至 16 时，计算起点为底层窗台面。
 * 同条还规定老年人居住建筑不应低于冬至日日照时数 2 h。
 *
 * 注意：标准约束的是"每套住宅至少一个居住空间"（GB 50096），不是每扇窗。
 * 这里逐窗给出时数，是为了让人看清自己要租、要买的那一间，而不是替代规划审批的日照分析。
 */

import type { SolarTermName } from './solar';

export interface SunlightRule {
  id: string;
  label: string;
  term: SolarTermName;
  /** 有效日照时间带，真太阳时，当日第几分钟 */
  startTst: number;
  endTst: number;
  requiredMinutes: number;
  source: string;
}

export const RULE_DAHAN: SunlightRule = {
  id: 'dahan-2h',
  label: '大寒日 ≥ 2 小时',
  term: '大寒',
  startTst: 8 * 60,
  endTst: 16 * 60,
  requiredMinutes: 120,
  source: 'GB 50180-2018 第 4.0.9 条（Ⅲ类气候区，城区常住人口 ≥ 50 万）',
};

export const RULE_DONGZHI_ELDERLY: SunlightRule = {
  id: 'dongzhi-2h-elderly',
  label: '冬至日 ≥ 2 小时（老年人居住建筑）',
  term: '冬至',
  startTst: 9 * 60,
  endTst: 15 * 60,
  requiredMinutes: 120,
  source: 'GB 50180-2018 第 4.0.9 条',
};

export const RULES = [RULE_DAHAN, RULE_DONGZHI_ELDERLY] as const;

export const meetsRule = (minutes: number, rule: SunlightRule) => minutes >= rule.requiredMinutes;
