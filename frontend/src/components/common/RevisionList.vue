<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useGradeStore } from '../../stores/gradeStore';
import { useJointStore } from '../../stores/jointStore';
import { useRevisionStore } from '../../stores/revisionStore';
import { GRADE_STATUS_TEXT, type GradeStatus } from '../../types/grade';
import { REVISION_STATUS_TEXT, type FaceRevision, type RevisionStatus } from '../../types/revision';
import { revisionFieldViews } from '../../utils/revision';
import { attitudeText, formatChainage } from '../../utils/geoMath';
import GradeTag from './GradeTag.vue';

const props = defineProps<{
  faceId: string;
}>();

const revisionStore = useRevisionStore();
const jointStore = useJointStore();
const gradeStore = useGradeStore();

const rows = computed(() => revisionStore.byFace(props.faceId));
const detail = ref<FaceRevision | null>(null);
const retrying = ref('');

const STATUS_TAG: Record<RevisionStatus, 'success' | 'warning' | 'danger'> = {
  done: 'success',
  recalculating: 'warning',
  failed: 'danger',
};

const GRADE_STATUS_TAG: Record<GradeStatus, 'success' | 'info' | 'warning'> = {
  confirmed: 'success',
  stale: 'info',
  pending_review: 'warning',
};

/** 受影响记录按 id 现状解析（可能已被删除，能解析多少列多少） */
function affectedJoints(rev: FaceRevision) {
  return jointStore.items.filter((j) => rev.affectedJointIds.includes(j.id));
}
function affectedWaters(rev: FaceRevision) {
  return gradeStore.waters.filter((w) => rev.affectedWaterIds.includes(w.id));
}
function affectedGrades(rev: FaceRevision) {
  return gradeStore.items.filter((g) => rev.affectedGradeIds.includes(g.id));
}

async function retry(rev: FaceRevision): Promise<void> {
  retrying.value = rev.id;
  const res = await revisionStore.retry(rev.id);
  retrying.value = '';
  if (res.ok) {
    ElMessage.success(`修订 R${rev.revisionNo} 已重新提交，关联判定失效并重算`);
  } else {
    ElMessage.error(res.error ?? '重试失败');
  }
}
</script>

<template>
  <el-table :data="rows" size="small" border>
    <el-table-column label="修订" width="70">
      <template #default="{ row }">R{{ row.revisionNo }}</template>
    </el-table-column>
    <el-table-column label="提交时间" width="160">
      <template #default="{ row }">{{ new Date(row.createdAt).toLocaleString('zh-CN') }}</template>
    </el-table-column>
    <el-table-column label="变更字段" min-width="150">
      <template #default="{ row }">
        <el-tag v-for="f in row.changedFields" :key="f" size="small" effect="plain" class="field-tag">{{ f }}</el-tag>
      </template>
    </el-table-column>
    <el-table-column label="影响范围" width="190">
      <template #default="{ row }">
        节理 {{ row.affectedJointIds.length }} · 涌水 {{ row.affectedWaterIds.length }} · 判定
        {{ row.affectedGradeIds.length }}
      </template>
    </el-table-column>
    <el-table-column label="状态" width="100">
      <template #default="{ row }">
        <el-tag :type="STATUS_TAG[row.status as RevisionStatus]" size="small">
          {{ REVISION_STATUS_TEXT[row.status as RevisionStatus] }}
        </el-tag>
      </template>
    </el-table-column>
    <el-table-column label="操作" width="150">
      <template #default="{ row }">
        <el-button size="small" @click="detail = row">回看</el-button>
        <el-button
          v-if="row.status === 'failed'"
          size="small"
          type="warning"
          :loading="retrying === row.id"
          @click="retry(row)"
        >
          重试
        </el-button>
      </template>
    </el-table-column>
    <template #empty><el-empty description="暂无修订记录" :image-size="60" /></template>
  </el-table>

  <el-dialog :model-value="!!detail" title="修订回看" width="720px" @update:model-value="detail = null">
    <template v-if="detail">
      <el-descriptions :column="2" border size="small">
        <el-descriptions-item label="修订号">R{{ detail.revisionNo }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="STATUS_TAG[detail.status]" size="small">{{ REVISION_STATUS_TEXT[detail.status] }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="提交时间">
          {{ new Date(detail.createdAt).toLocaleString('zh-CN') }}
        </el-descriptions-item>
        <el-descriptions-item label="完成时间">
          {{ detail.finishedAt ? new Date(detail.finishedAt).toLocaleString('zh-CN') : '—' }}
        </el-descriptions-item>
        <el-descriptions-item v-if="detail.error" label="失败原因" :span="2">
          <span class="error-text">{{ detail.error }}</span>
        </el-descriptions-item>
      </el-descriptions>

      <h4 class="section">字段前后对照</h4>
      <el-table :data="revisionFieldViews(detail)" size="small" border>
        <el-table-column prop="label" label="字段" width="110" />
        <el-table-column prop="before" label="修订前" min-width="170" />
        <el-table-column prop="after" label="修订后" min-width="170" />
      </el-table>

      <h4 class="section">受影响节理组（{{ detail.affectedJointIds.length }} 组）</h4>
      <div class="tags">
        <el-tag v-for="j in affectedJoints(detail)" :key="j.id" size="small" effect="plain">
          J{{ j.setNo }} {{ attitudeText(j.dipDirection, j.dipAngle) }}
        </el-tag>
        <span v-if="affectedJoints(detail).length === 0" class="muted">无（或记录已删除）</span>
      </div>

      <h4 class="section">受影响涌水（{{ detail.affectedWaterIds.length }} 条）</h4>
      <div class="tags">
        <el-tag v-for="w in affectedWaters(detail)" :key="w.id" size="small" effect="plain">
          {{ formatChainage(w.chainage) }} {{ w.position }} {{ w.estimatedFlow }} L/min
        </el-tag>
        <span v-if="affectedWaters(detail).length === 0" class="muted">无（或记录已删除）</span>
      </div>

      <h4 class="section">受影响判定（{{ detail.affectedGradeIds.length }} 条）</h4>
      <div class="tags">
        <span v-for="g in affectedGrades(detail)" :key="g.id" class="grade-item">
          <GradeTag :grade="g.grade" />
          <el-tag :type="GRADE_STATUS_TAG[g.status]" size="small">{{ GRADE_STATUS_TEXT[g.status] }}</el-tag>
        </span>
        <span v-if="affectedGrades(detail).length === 0" class="muted">无（或记录已删除）</span>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.field-tag {
  margin-right: 4px;
}
.section {
  margin: 14px 0 6px;
  font-size: 13px;
  color: #2f3a46;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.grade-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.muted {
  color: #7b8592;
  font-size: 13px;
}
.error-text {
  color: #d93025;
}
</style>
