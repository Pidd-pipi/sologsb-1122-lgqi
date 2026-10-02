import type { TunnelFace } from '../types/face';
import type { JointSet } from '../types/joint';
import { GRADE_SUPPORT, type Groundwater, type RockGrade } from '../types/grade';
import { estimateJv } from './geoMath';
import { round } from './id';

export interface GradeEngineInput {
  /** 饱和抗压强度 MPa */
  rockStrength: number;
  /** 岩石质量指标 % */
  rqd: number;
  /** 节理体密度 条/m³ */
  jv: number;
  /** 岩体完整性系数 */
  kv: number;
  groundwater: Groundwater;
  /** 洞跨 m */
  spanWidth: number;
  /** 其它修正系数 */
  extraCorrection: number;
}

export interface GradeEngineResult {
  bq: number;
  correctedBq: number;
  jv: number;
  grade: RockGrade;
  k1: number;
  k2: number;
  correction: number;
  support: string;
}

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

/**
 * 按 BQ/RQD/Jv/Kv 与洞跨修正算出围岩级别与支护建议。
 * 纯函数，供实时试算与修订重算共用。
 */
export function computeGrade(input: GradeEngineInput): GradeEngineResult {
  const { rockStrength, rqd, jv, kv, groundwater, spanWidth, extraCorrection } = input;
  // 基本质量指标：BQ = 90 + 3σc + 250Kv
  const bq = round(90 + 3 * rockStrength + 250 * kv, 1);
  const k1 = GROUNDWATER_K1[groundwater] ?? 0;
  const k2 = spanK2(spanWidth);
  const correction = round(k1 + k2 + extraCorrection, 3);
  // [BQ] = BQ − 100(K1 + K2 + K3)
  const correctedBq = round(bq - 100 * correction, 1);
  const grade = gradeFromBq(correctedBq);
  return {
    bq,
    correctedBq,
    jv,
    grade,
    k1,
    k2,
    correction,
    support: GRADE_SUPPORT[grade],
  };
}

/** 由掌子面、节理组与上一条判定推算重算输入（修订重算用） */
export function inputFromFace(
  face: TunnelFace,
  joints: JointSet[],
  prev?: { rqd: number; kv: number; groundwater: Groundwater },
): GradeEngineInput {
  return {
    rockStrength: face.rockStrength,
    rqd: prev?.rqd ?? 75,
    jv: estimateJv(joints),
    kv: prev?.kv ?? 0.6,
    groundwater: prev?.groundwater ?? '潮湿',
    spanWidth: Number(face.faceSize.split('×')[0]) || 12,
    extraCorrection: 0,
  };
}
