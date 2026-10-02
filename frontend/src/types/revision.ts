import type { TunnelFace } from './face';

/**
 * 修订状态：
 * - pending 已提交、待重算（提交后即进入，重算完成前旧值停用）
 * - recalculating 重算进行中
 * - succeeded 重算成功
 * - failed 重算失败（已回滚，可重试的待处理版本）
 */
export type RevisionStatus = 'pending' | 'recalculating' | 'succeeded' | 'failed';

/** 掌子面编录修订（可回看） */
export interface FaceRevision {
  id: string;
  faceId: string;
  /** 修订号（同一掌子面内从 2 递增，首次编录为 1） */
  revisionNo: number;
  submittedAt: number;
  submittedBy: string;
  status: RevisionStatus;
  /** 修订前的掌子面编录快照 */
  before: TunnelFace;
  /** 修订后的掌子面编录快照（待重算版本） */
  after: TunnelFace;
  /** 受影响的节理组 id */
  affectedJointIds: string[];
  /** 受影响的涌水记录 id */
  affectedWaterIds: string[];
  /** 受影响的判定 id */
  affectedGradeIds: string[];
  /** 重算失败原因 */
  failReason?: string;
  /** 重算完成（成功或失败）时间 */
  resolvedAt?: number;
}
