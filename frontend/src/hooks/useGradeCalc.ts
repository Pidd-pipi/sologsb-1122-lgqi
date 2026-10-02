import { computed, ref } from 'vue';
import { computeGrade, type GradeEngineInput } from '../utils/gradeEngine';
import { estimateJv } from '../utils/geoMath';
import type { JointSet } from '../types/joint';

export type GradeCalcInput = GradeEngineInput;

export interface GradeCalcResult {
  bq: number;
  correctedBq: number;
  kv: number;
  jv: number;
  grade: import('../types/grade').RockGrade;
  k1: number;
  k2: number;
  support: string;
  explanation: string[];
}

/**
 * 按 BQ/RQD/Jv/Kv 与洞跨修正实时算出围岩级别与支护建议。
 * 被围岩级别判定页（/grade/:faceId）消费。
 */
export function useGradeCalc(jointsOfFace?: () => JointSet[]) {
  const input = ref<GradeCalcInput>({
    rockStrength: 60,
    rqd: 75,
    jv: 0,
    kv: 0.6,
    groundwater: '潮湿',
    spanWidth: 12,
    extraCorrection: 0,
  });

  const autoJv = computed(() => (jointsOfFace ? estimateJv(jointsOfFace()) : 0));

  const result = computed<GradeCalcResult>(() => {
    const { rockStrength, rqd, kv, groundwater, spanWidth, extraCorrection } = input.value;
    const jv = input.value.jv > 0 ? input.value.jv : autoJv.value;
    const engine = computeGrade({ ...input.value, jv });
    const explanation = [
      `BQ = 90 + 3×${rockStrength} MPa + 250×${kv} = ${engine.bq}`,
      `修正系数 K1（${groundwater}）= ${engine.k1}，K2（洞跨 ${spanWidth} m）= ${engine.k2}，其它 = ${extraCorrection}`,
      `[BQ] = ${engine.bq} − 100×${engine.correction} = ${engine.correctedBq}`,
      `由 [BQ] 区间映射：>550 为 Ⅰ 级，451~550 为 Ⅱ 级，351~450 为 Ⅲ 级，251~350 为 Ⅳ 级，151~250 为 Ⅴ 级，≤150 为 Ⅵ 级`,
      `RQD = ${rqd} %，Jv = ${jv || '—'} 条/m³，Kv = ${kv}`,
    ];
    return {
      bq: engine.bq,
      correctedBq: engine.correctedBq,
      kv,
      jv,
      grade: engine.grade,
      k1: engine.k1,
      k2: engine.k2,
      support: engine.support,
      explanation,
    };
  });

  function patch(p: Partial<GradeCalcInput>) {
    input.value = { ...input.value, ...p };
  }

  return { input, result, patch, autoJv };
}
