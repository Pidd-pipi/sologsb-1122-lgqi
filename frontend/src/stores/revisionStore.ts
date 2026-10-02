import { defineStore } from 'pinia';
import { db, toPlain } from '../utils/db';
import { newId } from '../utils/id';
import type { FaceRevision, FaceSnapshot } from '../types/revision';
import type { RockMassGrade } from '../types/grade';
import {
  diffSnapshots,
  findOverlapFaces,
  recalcGrade,
  snapshotFace,
  watersOutsideRange,
} from '../utils/revision';
import { formatChainage } from '../utils/geoMath';
import { useFaceStore } from './faceStore';
import { useGradeStore } from './gradeStore';
import { useJointStore } from './jointStore';

interface RevisionState {
  items: FaceRevision[];
  loaded: boolean;
}

/** 重算前的让出时长，保证界面先呈现「重算中」、旧值已停用 */
const RECALC_DELAY = 400;

export const useRevisionStore = defineStore('revision', {
  state: (): RevisionState => ({ items: [], loaded: false }),
  getters: {
    byFace: (state) => (faceId: string) =>
      state.items.filter((r) => r.faceId === faceId).sort((a, b) => b.createdAt - a.createdAt),
    /** 进行中的修订（重算完成前，详情/台账/支护建议停用旧值） */
    activeByFace: (state) => (faceId: string) =>
      state.items.find((r) => r.faceId === faceId && r.status === 'recalculating'),
    failedCount: (state) => state.items.filter((r) => r.status === 'failed').length,
  },
  actions: {
    async load() {
      const rows = await db.revisions.toArray();
      rows.sort((a, b) => b.createdAt - a.createdAt);
      this.items = rows;
      this.loaded = true;
    },

    /**
     * 提交前校验：关键字段有变化、区间合法、不与其他掌子面重叠、
     * 每条涌水仍落在区间内。返回错误文案，空串表示通过。
     */
    validate(faceId: string, next: FaceSnapshot): string {
      const faceStore = useFaceStore();
      const gradeStore = useGradeStore();
      const face = faceStore.byId(faceId);
      if (!face) return '未找到该掌子面';
      if (this.activeByFace(faceId)) return '上一修订正在重算，完成后才能再次提交';
      if (diffSnapshots(snapshotFace(face), next).length === 0) {
        return '里程区间、岩性、强度、产状均未变化，无需修订';
      }
      if (next.mileageRange[1] < next.mileageRange[0]) return '编录里程区间终点不能小于起点';
      if (!(next.rockStrength > 0) || next.rockStrength > 300) return '饱和抗压强度需在 0 ~ 300 MPa 之间';
      const overlaps = findOverlapFaces(faceStore.items, faceId, next.mileageRange);
      if (overlaps.length > 0) {
        const text = overlaps
          .map((f) => `${f.faceNo}（${formatChainage(f.mileageRange[0])} ~ ${formatChainage(f.mileageRange[1])}）`)
          .join('、');
        return `编录区间与 ${text} 重叠`;
      }
      const outside = watersOutsideRange(gradeStore.watersByFace(faceId), next.mileageRange);
      if (outside.length > 0) {
        const text = outside.map((w) => `${w.position}（${formatChainage(w.chainage)}）`).join('、');
        return `${outside.length} 条涌水记录落在新区间之外：${text}，请调整区间或先处理这些记录`;
      }
      return '';
    },

    /**
     * 提交修订：
     * 1. 事务内应用新编录（修订号 +1）、关联有效判定立即置为失效、写入修订记录；
     * 2. 异步重算关联判定——完成前详情、台账与支护建议不再使用旧值。
     * 重算失败由 recalculate 回滚并保留可重试的失败版本。
     */
    async submit(faceId: string, next: FaceSnapshot): Promise<{ ok: boolean; error?: string }> {
      const error = this.validate(faceId, next);
      if (error) return { ok: false, error };
      const faceStore = useFaceStore();
      const gradeStore = useGradeStore();
      const jointStore = useJointStore();
      const face = faceStore.byId(faceId);
      if (!face) return { ok: false, error: '未找到该掌子面' };
      const now = Date.now();
      const revision: FaceRevision = {
        id: newId('rev'),
        faceId,
        revisionNo: face.revision + 1,
        changedFields: diffSnapshots(snapshotFace(face), next),
        before: snapshotFace(face),
        after: toPlain(next),
        affectedJointIds: jointStore.byFace(faceId).map((j) => j.id),
        affectedWaterIds: gradeStore.watersByFace(faceId).map((w) => w.id),
        affectedGradeIds: gradeStore.confirmedByFace(faceId).map((g) => g.id),
        status: 'recalculating',
        createdAt: now,
      };
      await db.transaction('rw', [db.faces, db.grades, db.revisions], async () => {
        await db.faces.update(faceId, { ...toPlain(next), revision: revision.revisionNo, revisedAt: now });
        await db.grades.where('id').anyOf(revision.affectedGradeIds).modify({ status: 'stale' });
        await db.revisions.put(toPlain(revision));
      });
      await Promise.all([faceStore.load(), gradeStore.load(), this.load()]);
      void this.recalculate(revision.id);
      return { ok: true };
    },

    /**
     * 重算关联判定：成功则按修订后编录生成新判定并完结修订；
     * 失败则整体回滚——原编录字段与修订号、关联判定状态恢复原样，
     * 修订记录标记为失败，保留为可重试的待处理版本。
     */
    async recalculate(revisionId: string): Promise<void> {
      await new Promise((resolve) => setTimeout(resolve, RECALC_DELAY));
      const rev = this.items.find((r) => r.id === revisionId);
      if (!rev) return;
      const faceStore = useFaceStore();
      const gradeStore = useGradeStore();
      const now = Date.now();
      try {
        await db.transaction('rw', [db.faces, db.grades, db.waters, db.revisions], async () => {
          const face = await db.faces.get(rev.faceId);
          if (!face) throw new Error('掌子面已不存在，无法重算');
          // 重算前复核一致性：区间仍不重叠、涌水仍全部落在区间内
          const overlaps = findOverlapFaces(await db.faces.toArray(), rev.faceId, face.mileageRange);
          if (overlaps.length > 0) {
            throw new Error(`编录区间与 ${overlaps.map((f) => f.faceNo).join('、')} 重叠`);
          }
          const waters = await db.waters.where('faceId').equals(rev.faceId).toArray();
          const outside = watersOutsideRange(waters, face.mileageRange);
          if (outside.length > 0) {
            throw new Error(`${outside.length} 条涌水记录落在编录区间之外`);
          }
          const stale = await db.grades.where('id').anyOf(rev.affectedGradeIds).toArray();
          const created: RockMassGrade[] = stale.map((g) => recalcGrade(face, g, now));
          await db.grades.bulkPut(toPlain(created));
          await db.revisions.update(rev.id, { status: 'done', finishedAt: now });
        });
        await Promise.all([gradeStore.load(), this.load()]);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await db.transaction('rw', [db.faces, db.grades, db.revisions], async () => {
          await db.faces.update(rev.faceId, { ...toPlain(rev.before), revision: rev.revisionNo - 1 });
          await db.grades.where('id').anyOf(rev.affectedGradeIds).modify({ status: 'confirmed' });
          await db.revisions.update(rev.id, { status: 'failed', error: message, finishedAt: now });
        });
        await Promise.all([faceStore.load(), gradeStore.load(), this.load()]);
      }
    },

    /** 重试失败的修订：按留存的后置快照重新提交并重算 */
    async retry(revisionId: string): Promise<{ ok: boolean; error?: string }> {
      const rev = this.items.find((r) => r.id === revisionId);
      if (!rev || rev.status !== 'failed') return { ok: false, error: '该修订不存在或不在可重试状态' };
      const error = this.validate(rev.faceId, rev.after);
      if (error) return { ok: false, error };
      const faceStore = useFaceStore();
      const gradeStore = useGradeStore();
      const now = Date.now();
      await db.transaction('rw', [db.faces, db.grades, db.revisions], async () => {
        await db.faces.update(rev.faceId, { ...toPlain(rev.after), revision: rev.revisionNo, revisedAt: now });
        await db.grades.where('id').anyOf(rev.affectedGradeIds).modify({ status: 'stale' });
        await db.revisions
          .where('id')
          .equals(rev.id)
          .modify((r) => {
            r.status = 'recalculating';
            delete r.error;
            delete r.finishedAt;
          });
      });
      await Promise.all([faceStore.load(), gradeStore.load(), this.load()]);
      void this.recalculate(revisionId);
      return { ok: true };
    },
  },
});
