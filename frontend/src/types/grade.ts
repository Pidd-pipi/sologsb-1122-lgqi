/** 围岩级别 Ⅰ ~ Ⅵ */
export type RockGrade = 'Ⅰ' | 'Ⅱ' | 'Ⅲ' | 'Ⅳ' | 'Ⅴ' | 'Ⅵ';

export const ROCK_GRADES: RockGrade[] = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ'];

/** 出水状态 */
export type Groundwater = '干燥' | '潮湿' | '点滴状出水' | '线状出水' | '涌流状出水';

export const GROUNDWATERS: Groundwater[] = ['干燥', '潮湿', '点滴状出水', '线状出水', '涌流状出水'];

/**
 * 判定状态：
 * - confirmed：有效，可作为现行结论；
 * - stale：编录修订后已失效，重算完成前详情/台账/支护建议不得使用；
 * - pending_review：旧数据升级时无法对应来源掌子面，待人工复核。
 */
export type GradeStatus = 'confirmed' | 'stale' | 'pending_review';

export const GRADE_STATUS_TEXT: Record<GradeStatus, string> = {
  confirmed: '有效',
  stale: '已失效',
  pending_review: '待复核',
};

/** 围岩级别判定记录 */
export interface RockMassGrade {
  id: string;
  faceId: string;
  grade: RockGrade;
  /** 基本质量指标 BQ */
  bqValue: number;
  /** 岩石质量指标 % */
  rqd: number;
  /** 节理体密度 条/m³ */
  jv: number;
  /** 岩体完整性系数 */
  kv: number;
  groundwater: Groundwater;
  /** 洞跨 m */
  spanWidth: number;
  /** 修正系数合计 */
  correction: number;
  /** 修正后的 [BQ] */
  correctedBq: number;
  /** 支护建议 */
  supportSuggestion: string;
  /** 是否人工修正级别 */
  manualAdjusted: boolean;
  judgedAt: number;
  /** 判定状态 */
  status: GradeStatus;
  /** 判定所依据的掌子面修订号 */
  faceRevision: number;
}

export type RockMassGradeDraft = Omit<RockMassGrade, 'id' | 'judgedAt'>;

/** 级别色带（用于 <GradeTag>） */
export const GRADE_COLOR: Record<RockGrade, string> = {
  'Ⅰ': '#1f7a4d',
  'Ⅱ': '#3f9e63',
  'Ⅲ': '#c9a227',
  'Ⅳ': '#e08b2f',
  'Ⅴ': '#d3542f',
  'Ⅵ': '#a02622',
};

/** 等级对应的支护建议 */
export const GRADE_SUPPORT: Record<RockGrade, string> = {
  'Ⅰ': '局部锚杆（φ22，L=2.0 m，间距 1.5 m），喷射混凝土 5 cm',
  'Ⅱ': '系统锚杆（φ22，L=2.5 m，间距 1.2 m）+ 喷射混凝土 8 cm',
  'Ⅲ': '系统锚杆（φ25，L=3.0 m，间距 1.0 m）+ 喷射混凝土 12 cm + 钢筋网',
  'Ⅳ': '钢拱架（I16，间距 1.0 m）+ 系统锚杆（φ25，L=3.5 m）+ 喷射混凝土 20 cm',
  'Ⅴ': '超前小导管（φ42，L=4.5 m，环向间距 0.4 m）+ 钢拱架（I18，间距 0.75 m）+ 喷射混凝土 25 cm',
  'Ⅵ': '超前管棚（φ108，L=20 m）+ 钢拱架（I20b，间距 0.5 m）+ 双层钢筋网 + 喷射混凝土 30 cm，必要时超前预注浆',
};

/** 出水状态 → 地下水修正系数 K1（简化取值） */
export const GROUNDWATER_K1: Record<Groundwater, number> = {
  干燥: 0,
  潮湿: 0.05,
  点滴状出水: 0.1,
  线状出水: 0.18,
  涌流状出水: 0.28,
};

/** 洞跨 → 主要软弱结构面修正系数 K2（简化取值） */
export function spanK2(spanWidth: number): number {
  if (spanWidth < 5) return 0;
  if (spanWidth < 10) return 0.03;
  if (spanWidth < 15) return 0.06;
  if (spanWidth < 20) return 0.1;
  return 0.15;
}

/** 由 [BQ] 映射围岩级别 */
export function gradeFromBq(correctedBq: number): RockGrade {
  if (correctedBq > 550) return 'Ⅰ';
  if (correctedBq > 450) return 'Ⅱ';
  if (correctedBq > 350) return 'Ⅲ';
  if (correctedBq > 250) return 'Ⅳ';
  if (correctedBq > 150) return 'Ⅴ';
  return 'Ⅵ';
}

/** 由涌水量与出水状态给出建议措施 */
export function waterMeasure(flow: number, type: string): string {
  if (flow >= 60 || type === '股状' || type === '涌流状出水') {
    return '立即停止掌子面作业，实施超前预注浆 + 径向注浆封堵，加强排水与监测';
  }
  if (flow >= 20) return '布设环向排水盲管 + 局部注浆堵水，加密涌水量监测频次';
  if (flow >= 5) return '设置纵向排水沟与集水坑，记录变化趋势，待喷锚后复测';
  return '常规排水，保持观察并纳入日常编录';
}
