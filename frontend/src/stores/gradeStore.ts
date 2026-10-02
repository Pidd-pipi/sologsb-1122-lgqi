import { defineStore } from 'pinia';
import { db, toPlain } from '../utils/db';
import { newId } from '../utils/id';
import type { RockMassGrade, RockMassGradeDraft } from '../types/grade';
import type { WaterInflow, WaterInflowDraft } from '../types/water';

interface GradeState {
  items: RockMassGrade[];
  waters: WaterInflow[];
  loaded: boolean;
}

export const useGradeStore = defineStore('grade', {
  state: (): GradeState => ({ items: [], waters: [], loaded: false }),
  getters: {
    byFace: (state) => (faceId: string) =>
      state.items.filter((it) => it.faceId === faceId).sort((a, b) => b.judgedAt - a.judgedAt),
    /** 现行有效的最新判定（重算完成前不返回旧值） */
    latestByFace: (state) => (faceId: string) =>
      state.items
        .filter((it) => it.faceId === faceId && it.status === 'current')
        .sort((a, b) => b.judgedAt - a.judgedAt)[0],
    watersByFace: (state) => (faceId: string) =>
      state.waters.filter((it) => it.faceId === faceId).sort((a, b) => a.chainage - b.chainage),
  },
  actions: {
    async load() {
      const grades = await db.grades.toArray();
      this.items = grades.sort((a, b) => b.judgedAt - a.judgedAt);
      const waters = await db.waters.toArray();
      this.waters = waters.sort((a, b) => a.chainage - b.chainage);
      this.loaded = true;
    },
    async addGrade(draft: RockMassGradeDraft) {
      const record: RockMassGrade = {
        ...toPlain(draft),
        id: newId('grade'),
        judgedAt: Date.now(),
        status: draft.status ?? 'current',
      };
      await db.grades.put(toPlain(record));
      this.items = [record, ...this.items];
      return record;
    },
    /** 修订提交后：该面现行判定立即失效（stale），等待重算 */
    async invalidateGrades(faceId: string, revisionId: string) {
      const targets = this.items.filter((g) => g.faceId === faceId && g.status === 'current');
      for (const g of targets) {
        await db.grades.update(g.id, { status: 'stale', revisionId });
      }
      this.items = this.items.map((g) =>
        targets.some((t) => t.id === g.id) ? { ...g, status: 'stale' as const, revisionId } : g,
      );
    },
    /** 重算失败回滚：把失效判定恢复为现行 */
    async restoreGrades(faceId: string, revisionId: string) {
      const targets = this.items.filter(
        (g) => g.faceId === faceId && g.status === 'stale' && g.revisionId === revisionId,
      );
      for (const g of targets) {
        await db.grades.update(g.id, { status: 'current', revisionId: undefined });
      }
      this.items = this.items.map((g) =>
        targets.some((t) => t.id === g.id)
          ? { ...g, status: 'current' as const, revisionId: undefined }
          : g,
      );
    },
    /** 重算成功后：失效判定转为已取代（历史） */
    async supersedeGrades(faceId: string, revisionId: string) {
      const targets = this.items.filter(
        (g) => g.faceId === faceId && g.status === 'stale' && g.revisionId === revisionId,
      );
      for (const g of targets) {
        await db.grades.update(g.id, { status: 'superseded' });
      }
      this.items = this.items.map((g) =>
        targets.some((t) => t.id === g.id) ? { ...g, status: 'superseded' as const } : g,
      );
    },
    async addWater(draft: WaterInflowDraft) {
      const record: WaterInflow = { ...toPlain(draft), id: newId('water'), measuredAt: Date.now() };
      await db.waters.put(toPlain(record));
      this.waters = [...this.waters, record].sort((a, b) => a.chainage - b.chainage);
      return record;
    },
    async removeWater(id: string) {
      await db.waters.delete(id);
      this.waters = this.waters.filter((it) => it.id !== id);
    },
  },
});
