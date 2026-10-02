import { defineStore } from 'pinia';
import { ElMessage } from 'element-plus';
import { db, toPlain } from '../utils/db';
import { newId } from '../utils/id';
import type { FaceRevision } from '../types/revision';
import type { TunnelFace } from '../types/face';
import { computeGrade, inputFromFace } from '../utils/gradeEngine';
import { attitudeText, formatChainage } from '../utils/geoMath';
import { useFaceStore } from './faceStore';
import { useGradeStore } from './gradeStore';
import { useJointStore } from './jointStore';

interface RevisionState {
  items: FaceRevision[];
  loaded: boolean;
}

/** 区间是否重叠（端点相接不算重叠） */
export function rangeOverlap(a: [number, number], b: [number, number]): boolean {
  return a[0] < b[1] && b[0] < a[1];
}

export interface AffectedItem {
  id: string;
  label: string;
  inRange?: boolean;
}

export interface AffectedPreview {
  affectedJoints: AffectedItem[];
  affectedWaters: AffectedItem[];
  affectedGrades: AffectedItem[];
  errors: string[];
}

export const useRevisionStore = defineStore('revision', {
  state: (): RevisionState => ({ items: [], loaded: false }),
  getters: {
    byFace: (state) => (faceId: string) =>
      state.items.filter((r) => r.faceId === faceId).sort((a, b) => b.revisionNo - a.revisionNo),
    /** 该面正在重算（待处理/重算中）的修订；重算完成前旧值停用 */
    activeByFace: (state) => (faceId: string) =>
      state.items.find(
        (r) => r.faceId === faceId && (r.status === 'pending' || r.status === 'recalculating'),
      ),
  },
  actions: {
    async load() {
      const rows = await db.revisions.toArray();
      rows.sort((a, b) => b.submittedAt - a.submittedAt);
      this.items = rows;
      this.loaded = true;
    },
    /** 预览修订影响：列出受影响节理/涌水/判定，并做区间重叠与涌水落位校验 */
    preview(faceId: string, patch: Partial<TunnelFace>): AffectedPreview {
      const faceStore = useFaceStore();
      const jointStore = useJointStore();
      const gradeStore = useGradeStore();
      const errors: string[] = [];
      const face = faceStore.byId(faceId);
      if (!face) {
        return { affectedJoints: [], affectedWaters: [], affectedGrades: [], errors: ['未找到该掌子面'] };
      }
      const merged: TunnelFace = { ...face, ...toPlain(patch) };
      // 1. 区间不与其他掌子面重叠
      const overlap = faceStore.items
        .filter((f) => f.id !== faceId)
        .find((f) => rangeOverlap(merged.mileageRange, f.mileageRange));
      if (overlap) {
        errors.push(`编录里程区间与掌子面「${overlap.faceNo}」重叠，请调整区间`);
      }
      // 2. 每条涌水仍落在新区间内
      const waters = gradeStore.watersByFace(faceId);
      const affectedWaters: AffectedItem[] = waters.map((w) => {
        const inRange = w.chainage >= merged.mileageRange[0] && w.chainage <= merged.mileageRange[1];
        if (!inRange) {
          errors.push(`涌水记录「${w.position}」（${formatChainage(w.chainage)}）落在新区间之外`);
        }
        return { id: w.id, label: `${w.position} · ${w.type} ${w.estimatedFlow} L/min`, inRange };
      });
      // 受影响节理（仍挂在原面，随面修订一并回看）
      const affectedJoints: AffectedItem[] = jointStore
        .byFace(faceId)
        .map((j) => ({ id: j.id, label: `J${j.setNo} · ${attitudeText(j.dipDirection, j.dipAngle)}` }));
      // 受影响判定（现行判定将立即失效重算）
      const affectedGrades: AffectedItem[] = gradeStore
        .byFace(faceId)
        .filter((g) => g.status === 'current')
        .map((g) => ({ id: g.id, label: `${g.grade} 级 · [BQ] ${g.correctedBq}` }));
      return { affectedJoints, affectedWaters, affectedGrades, errors };
    },
    /** 提交修订：生成待处理版本 → 应用修改 → 判定失效 → 异步重算 */
    async submit(
      faceId: string,
      patch: Partial<TunnelFace>,
      submittedBy: string,
    ): Promise<FaceRevision | undefined> {
      const faceStore = useFaceStore();
      const gradeStore = useGradeStore();
      const face = faceStore.byId(faceId);
      if (!face) return undefined;
      if (this.activeByFace(faceId)) {
        ElMessage.warning('该掌子面已有修订正在重算中，请等待完成或重试');
        return undefined;
      }
      const preview = this.preview(faceId, patch);
      if (preview.errors.length > 0) {
        ElMessage.error(preview.errors[0]);
        return undefined;
      }
      const before = toPlain(face);
      const after = toPlain({ ...face, ...toPlain(patch) });
      const revisionNo = (face.revisionNo ?? 1) + 1;
      const revision: FaceRevision = {
        id: newId('rev'),
        faceId,
        revisionNo,
        submittedAt: Date.now(),
        submittedBy: submittedBy || face.geologist,
        status: 'pending',
        before,
        after,
        affectedJointIds: preview.affectedJoints.map((j) => j.id),
        affectedWaterIds: preview.affectedWaters.map((w) => w.id),
        affectedGradeIds: preview.affectedGrades.map((g) => g.id),
      };
      await db.revisions.put(toPlain(revision));
      this.items = [revision, ...this.items];
      // 应用编录修改
      await faceStore.update(faceId, { ...toPlain(patch), revisionNo });
      // 关联判定立即失效
      await gradeStore.invalidateGrades(faceId, revision.id);
      // 触发异步重算
      void this.recalculate(revision.id);
      return revision;
    },
    /** 重算（异步；失败则回滚原编录并保留可重试的待处理版本） */
    async recalculate(revisionId: string): Promise<void> {
      const revision = this.items.find((r) => r.id === revisionId);
      if (!revision) return;
      revision.status = 'recalculating';
      revision.failReason = undefined;
      await db.revisions.update(revisionId, { status: 'recalculating', failReason: undefined });
      try {
        await simulateRecalc();
        const faceStore = useFaceStore();
        const jointStore = useJointStore();
        const gradeStore = useGradeStore();
        const face = faceStore.byId(revision.faceId);
        if (!face) throw new Error('掌子面不存在');
        const joints = jointStore.byFace(revision.faceId);
        const prev = gradeStore
          .byFace(revision.faceId)
          .find((g) => g.status === 'stale' && g.revisionId === revision.id);
        const input = inputFromFace(face, joints, prev);
        const result = computeGrade(input);
        await gradeStore.addGrade({
          faceId: face.id,
          grade: result.grade,
          bqValue: result.bq,
          rqd: input.rqd,
          jv: result.jv,
          kv: input.kv,
          groundwater: input.groundwater,
          spanWidth: input.spanWidth,
          correction: result.correction,
          correctedBq: result.correctedBq,
          supportSuggestion: result.support,
          manualAdjusted: false,
          status: 'current',
          revisionId: revision.id,
        });
        await gradeStore.supersedeGrades(revision.faceId, revision.id);
        revision.status = 'succeeded';
        revision.resolvedAt = Date.now();
        await db.revisions.update(revisionId, {
          status: 'succeeded',
          resolvedAt: revision.resolvedAt,
        });
        ElMessage.success(`修订 R${revision.revisionNo} 重算完成，已更新为 ${result.grade} 级围岩`);
      } catch (e) {
        // 重算失败：原编录、关联记录、已确认判定一起保持原样
        const faceStore = useFaceStore();
        const gradeStore = useGradeStore();
        await faceStore.update(revision.faceId, { ...revision.before });
        await gradeStore.restoreGrades(revision.faceId, revision.id);
        revision.status = 'failed';
        revision.failReason = e instanceof Error ? e.message : '重算失败';
        revision.resolvedAt = Date.now();
        await db.revisions.update(revisionId, {
          status: 'failed',
          failReason: revision.failReason,
          resolvedAt: revision.resolvedAt,
        });
        ElMessage.error(`修订 R${revision.revisionNo} 重算失败，已回滚原编录，可重试`);
      }
    },
    /** 重试失败的修订 */
    async retry(revisionId: string) {
      const revision = this.items.find((r) => r.id === revisionId);
      if (!revision) return;
      const faceStore = useFaceStore();
      const gradeStore = useGradeStore();
      const face = faceStore.byId(revision.faceId);
      // 若已回滚，重新应用待处理版本
      if (face && face.revisionNo !== revision.revisionNo) {
        await faceStore.update(revision.faceId, { ...revision.after, revisionNo: revision.revisionNo });
        await gradeStore.invalidateGrades(revision.faceId, revision.id);
      }
      await this.recalculate(revisionId);
    },
    /** 放弃待处理版本（仅在已回滚后可清理） */
    async discard(revisionId: string) {
      const revision = this.items.find((r) => r.id === revisionId);
      if (!revision) return;
      await db.revisions.delete(revisionId);
      this.items = this.items.filter((r) => r.id !== revisionId);
    },
  },
});

/** 模拟异步重算服务（演示环境有概率失败，以验证回滚与重试） */
function simulateRecalc(): Promise<void> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (Math.random() < 0.2) reject(new Error('重算服务暂不可用（演示环境模拟失败）'));
      else resolve();
    }, 1200);
  });
}
