import type { Attitude } from './face';

/**
 * 参与修订比对、提交与回滚的掌子面关键字段快照。
 * 即需求中的「里程区间、岩性、强度、产状」（里程桩号随区间一并记录）。
 */
export interface FaceSnapshot {
  /** 里程桩号（米） */
  chainage: number;
  /** 编录里程区间（米） */
  mileageRange: [number, number];
  lithology: string;
  /** 饱和抗压强度 MPa */
  rockStrength: number;
  attitude: Attitude;
}

/**
 * 修订状态：
 * - recalculating：已提交，关联判定已失效，正在重算；
 * - done：重算完成，新判定已生效；
 * - failed：重算失败，编录与判定已回滚原样，可重试。
 */
export type RevisionStatus = 'recalculating' | 'done' | 'failed';

export const REVISION_STATUS_TEXT: Record<RevisionStatus, string> = {
  recalculating: '重算中',
  done: '已完成',
  failed: '重算失败',
};

/** 编录修订记录（可回看；失败版本保留待处理、可重试） */
export interface FaceRevision {
  id: string;
  faceId: string;
  /** 修订后的掌子面修订号 */
  revisionNo: number;
  /** 变更字段中文标签，如 编录区间 / 岩性 / 抗压强度 / 岩层产状 */
  changedFields: string[];
  /** 修订前快照（回滚依据） */
  before: FaceSnapshot;
  /** 修订后快照（重试依据） */
  after: FaceSnapshot;
  /** 提交时受影响的节理组 id */
  affectedJointIds: string[];
  /** 提交时受影响的涌水记录 id */
  affectedWaterIds: string[];
  /** 提交时被置为失效的判定 id */
  affectedGradeIds: string[];
  status: RevisionStatus;
  /** 重算失败原因 */
  error?: string;
  createdAt: number;
  finishedAt?: number;
}
