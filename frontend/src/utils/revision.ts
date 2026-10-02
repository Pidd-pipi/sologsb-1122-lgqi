import type { TunnelFace } from '../types/face';
import { GRADE_SUPPORT, gradeFromBq, type RockMassGrade } from '../types/grade';
import type { FaceRevision, FaceSnapshot } from '../types/revision';
import type { WaterInflow } from '../types/water';
import { formatChainage } from './geoMath';
import { newId, round } from './id';

/** 提取掌子面关键字段快照（深拷贝产状，避免引用共享） */
export function snapshotFace(face: TunnelFace): FaceSnapshot {
  return {
    chainage: face.chainage,
    mileageRange: [face.mileageRange[0], face.mileageRange[1]],
    lithology: face.lithology,
    rockStrength: face.rockStrength,
    attitude: { ...face.attitude },
  };
}

/** 比对前后快照，返回变更字段的中文标签 */
export function diffSnapshots(before: FaceSnapshot, after: FaceSnapshot): string[] {
  const changed: string[] = [];
  if (before.chainage !== after.chainage) changed.push('里程桩号');
  if (before.mileageRange[0] !== after.mileageRange[0] || before.mileageRange[1] !== after.mileageRange[1]) {
    changed.push('编录区间');
  }
  if (before.lithology !== after.lithology) changed.push('岩性');
  if (before.rockStrength !== after.rockStrength) changed.push('抗压强度');
  const a = before.attitude;
  const b = after.attitude;
  if (a.strike !== b.strike || a.dipDirection !== b.dipDirection || a.dipAngle !== b.dipAngle) {
    changed.push('岩层产状');
  }
  return changed;
}

/**
 * 区间是否重叠。端点相接不算重叠（如前循环 [12480,12483] 与后循环 [12483,12486]），
 * 与逐循环编录的衔接习惯一致。
 */
export function rangesOverlap(a: [number, number], b: [number, number]): boolean {
  return a[0] < b[1] && b[0] < a[1];
}

/** 找出与给定区间重叠的其他掌子面 */
export function findOverlapFaces(faces: TunnelFace[], excludeId: string, range: [number, number]): TunnelFace[] {
  return faces.filter((f) => f.id !== excludeId && rangesOverlap(f.mileageRange, range));
}

/** 里程是否落在编录区间内（含端点） */
export function inRange(chainage: number, range: [number, number]): boolean {
  return chainage >= range[0] && chainage <= range[1];
}

/** 落在区间之外的涌水记录 */
export function watersOutsideRange(waters: WaterInflow[], range: [number, number]): WaterInflow[] {
  return waters.filter((w) => !inRange(w.chainage, range));
}

/**
 * 按修订后的编录重算单条判定：以新强度重算 BQ/[BQ]，
 * 自动判定重映射级别与支护建议；人工修正的级别保留人工结论，仅刷新指标。
 * 返回带新 id 的判定记录（旧记录保留为已失效历史，可回看）。
 */
export function recalcGrade(face: TunnelFace, grade: RockMassGrade, judgedAt: number): RockMassGrade {
  // BQ = 90 + 3σc + 250Kv
  const bq = round(90 + 3 * face.rockStrength + 250 * grade.kv, 1);
  // [BQ] = BQ - 100(K1 + K2 + K3)
  const correctedBq = round(bq - 100 * grade.correction, 1);
  if (!Number.isFinite(bq) || !Number.isFinite(correctedBq)) {
    throw new Error(`判定 ${grade.id} 重算结果无效（BQ=${bq}，[BQ]=${correctedBq}）`);
  }
  const nextGrade = grade.manualAdjusted ? grade.grade : gradeFromBq(correctedBq);
  return {
    ...grade,
    id: newId('grade'),
    grade: nextGrade,
    bqValue: bq,
    correctedBq,
    supportSuggestion: grade.manualAdjusted ? grade.supportSuggestion : GRADE_SUPPORT[nextGrade],
    status: 'confirmed',
    faceRevision: face.revision,
    judgedAt,
  };
}

export interface RevisionFieldView {
  label: string;
  before: string;
  after: string;
}

function attitudeView(s: FaceSnapshot): string {
  return `走向 ${s.attitude.strike}° · ${s.attitude.dipDirection}° ∠ ${s.attitude.dipAngle}°`;
}

/** 修订回看的字段级前后对照（仅列出发生变更的字段） */
export function revisionFieldViews(rev: FaceRevision): RevisionFieldView[] {
  const views: RevisionFieldView[] = [];
  const { before, after } = rev;
  if (rev.changedFields.includes('里程桩号')) {
    views.push({ label: '里程桩号', before: formatChainage(before.chainage), after: formatChainage(after.chainage) });
  }
  if (rev.changedFields.includes('编录区间')) {
    views.push({
      label: '编录区间',
      before: `${formatChainage(before.mileageRange[0])} ~ ${formatChainage(before.mileageRange[1])}`,
      after: `${formatChainage(after.mileageRange[0])} ~ ${formatChainage(after.mileageRange[1])}`,
    });
  }
  if (rev.changedFields.includes('岩性')) {
    views.push({ label: '岩性', before: before.lithology, after: after.lithology });
  }
  if (rev.changedFields.includes('抗压强度')) {
    views.push({ label: '抗压强度', before: `${before.rockStrength} MPa`, after: `${after.rockStrength} MPa` });
  }
  if (rev.changedFields.includes('岩层产状')) {
    views.push({ label: '岩层产状', before: attitudeView(before), after: attitudeView(after) });
  }
  return views;
}
