<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useFaceStore } from '../stores/faceStore';
import { useGradeStore } from '../stores/gradeStore';
import { useJointStore } from '../stores/jointStore';
import { useRevisionStore } from '../stores/revisionStore';
import { useGradeCalc } from '../hooks/useGradeCalc';
import SketchCanvas from '../components/common/SketchCanvas.vue';
import GradeTag from '../components/common/GradeTag.vue';
import FaceEditDialog from '../components/common/FaceEditDialog.vue';
import { attitudeText, formatChainage } from '../utils/geoMath';
import { GRADE_SUPPORT, type GradeStatus } from '../types/grade';
import type { RevisionStatus } from '../types/revision';

const route = useRoute();
const router = useRouter();
const faceStore = useFaceStore();
const jointStore = useJointStore();
const gradeStore = useGradeStore();
const revisionStore = useRevisionStore();

const faceId = computed(() => String(route.params.id ?? ''));
const face = computed(() => faceStore.byId(faceId.value));
const joints = computed(() => jointStore.byFace(faceId.value));
const revisions = computed(() => revisionStore.byFace(faceId.value));
const activeRevision = computed(() => revisionStore.activeByFace(faceId.value));

/** 现行判定（重算完成前不返回旧值） */
const latest = computed(() => gradeStore.latestByFace(faceId.value));
const currentGrades = computed(() =>
  gradeStore.byFace(faceId.value).filter((g) => g.status === 'current'),
);
const previousGrade = computed(() => currentGrades.value[1]);

const { result, patch } = useGradeCalc(() => joints.value);
const segmentCount = ref(0);
const editDialogVisible = ref(false);

/** SketchCanvas 变更回调（用命名函数避免模板内联箭头参数丢类型） */
function onSketchChange(segs: { id: string }[]): void {
  segmentCount.value = segs.length;
}

/** 与上循环级别比对结论 */
const gradeCompare = computed(() => {
  if (activeRevision.value) return '正在重新判定，完成后更新比对结论';
  if (!latest.value) return '本掌子面尚无级别判定记录';
  if (!previousGrade.value) return `本掌子面首次判定为 ${latest.value.grade} 级围岩`;
  const order = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ'];
  const delta = order.indexOf(latest.value.grade) - order.indexOf(previousGrade.value.grade);
  if (delta === 0) return `与上一循环一致（${latest.value.grade} 级）`;
  return delta > 0
    ? `较上一循环变差 ${delta} 级：${previousGrade.value.grade} → ${latest.value.grade}`
    : `较上一循环变好 ${-delta} 级：${previousGrade.value.grade} → ${latest.value.grade}`;
});

const revisionStatusTag: Record<RevisionStatus, { label: string; type: '' | 'success' | 'warning' | 'danger' | 'info' }> = {
  pending: { label: '待重算', type: 'warning' },
  recalculating: { label: '重算中', type: 'warning' },
  succeeded: { label: '已完成', type: 'success' },
  failed: { label: '重算失败', type: 'danger' },
};

const gradeStatusLabel: Record<GradeStatus, string> = {
  current: '现行',
  stale: '已失效',
  superseded: '已取代',
  pending_review: '待复核',
};

onMounted(async () => {
  await faceStore.load();
  await jointStore.load();
  await gradeStore.load();
  await revisionStore.load();
  if (face.value) {
    patch({ rockStrength: face.value.rockStrength, spanWidth: Number(face.value.faceSize.split('×')[0]) || 12 });
  }
});
</script>

<template>
  <div class="page">
    <div class="header">
      <h2>掌子面详情 · {{ face?.faceNo ?? '未找到' }}</h2>
      <el-tag v-if="face" type="info" effect="plain">修订 R{{ face.revisionNo ?? 1 }}</el-tag>
      <GradeTag v-if="latest && !activeRevision" :grade="latest.grade" />
      <el-tag v-else-if="activeRevision" type="warning" effect="dark">重算中</el-tag>
      <el-tag v-else type="info">未判定级别</el-tag>
      <el-tag type="info" effect="plain">节理 {{ joints.length }} 组</el-tag>
      <div class="spacer" />
      <el-button type="primary" @click="editDialogVisible = true">修订编录</el-button>
      <el-button @click="router.push(`/faces/${faceId}/joints`)">节理录入</el-button>
      <el-button @click="router.push(`/faces/${faceId}/water`)">涌水记录</el-button>
      <el-button @click="router.push(`/grade/${faceId}`)">围岩级别判定</el-button>
      <el-button @click="router.push('/faces')">返回台账</el-button>
    </div>

    <el-alert v-if="!face" type="warning" :closable="false" show-icon title="未找到该掌子面（可能已被删除）" />

    <!-- 重算中 / 失败回滚提示 -->
    <el-alert
      v-if="activeRevision"
      type="warning"
      :closable="false"
      show-icon
      title="修订重算中：关联判定已失效，详情、台账与支护建议暂停使用旧值"
      :description="`修订 R${activeRevision.revisionNo} 正在重新计算围岩级别，完成后自动更新。`"
      style="margin-bottom: 4px"
    />
    <el-alert
      v-for="r in revisions.filter((x) => x.status === 'failed')"
      :key="r.id"
      type="error"
      :closable="false"
      show-icon
      :title="`修订 R${r.revisionNo} 重算失败，已回滚到修订前编录`"
      :description="`原因：${r.failReason ?? '未知'}。可在下方修订记录中重试。`"
      style="margin-bottom: 4px"
    />

    <div v-if="face" class="grid">
      <div class="left">
        <el-card shadow="never">
          <template #header><strong>基本信息</strong></template>
          <el-descriptions :column="1" border size="small">
            <el-descriptions-item label="掌子面编号">{{ face.faceNo }}</el-descriptions-item>
            <el-descriptions-item label="里程桩号">{{ formatChainage(face.chainage) }}</el-descriptions-item>
            <el-descriptions-item label="编录里程区间">
              {{ formatChainage(face.mileageRange[0]) }} ~ {{ formatChainage(face.mileageRange[1]) }}
            </el-descriptions-item>
            <el-descriptions-item label="开挖方式">{{ face.excavationMethod }}</el-descriptions-item>
            <el-descriptions-item label="开挖断面尺寸">{{ face.faceSize }} m</el-descriptions-item>
            <el-descriptions-item label="岩性 / 风化">{{ face.lithology }} / {{ face.weathering }}</el-descriptions-item>
            <el-descriptions-item label="饱和抗压强度">{{ face.rockStrength }} MPa</el-descriptions-item>
            <el-descriptions-item label="岩层产状">
              走向 {{ face.attitude.strike }}° · {{ attitudeText(face.attitude.dipDirection, face.attitude.dipAngle) }}
            </el-descriptions-item>
            <el-descriptions-item label="地质员">{{ face.geologist }}</el-descriptions-item>
            <el-descriptions-item label="编录时间">
              {{ new Date(face.recordedAt).toLocaleString('zh-CN') }}
            </el-descriptions-item>
          </el-descriptions>
        </el-card>

        <el-card shadow="never">
          <template #header><strong>级别与支护</strong></template>
          <div v-if="activeRevision" class="grade-box">
            <el-tag type="warning" effect="dark">重算中</el-tag>
            <p class="muted">修订 R{{ activeRevision.revisionNo }} 提交后关联判定立即失效，正在重新计算…</p>
            <el-button size="small" :loading="true" disabled>正在重算</el-button>
          </div>
          <div v-else-if="latest" class="grade-box">
            <GradeTag :grade="latest.grade" />
            <span class="muted">[BQ] = {{ latest.correctedBq }}（BQ {{ latest.bqValue }}，修正 {{ latest.correction }}）</span>
            <p class="support">{{ latest.supportSuggestion || GRADE_SUPPORT[latest.grade] }}</p>
            <p class="muted">{{ gradeCompare }}</p>
          </div>
          <div v-else>
            <p class="muted">尚未判定级别，按当前参数实时试算：</p>
            <GradeTag :grade="result.grade" />
            <p class="support">{{ result.support }}</p>
          </div>
        </el-card>

        <el-card shadow="never">
          <template #header><strong>节理组列表（{{ joints.length }} 组）</strong></template>
          <el-table :data="joints" size="small" border>
            <el-table-column label="组号" width="70">
              <template #default="{ row }">J{{ row.setNo }}</template>
            </el-table-column>
            <el-table-column label="产状" width="140">
              <template #default="{ row }">{{ attitudeText(row.dipDirection, row.dipAngle) }}</template>
            </el-table-column>
            <el-table-column prop="spacing" label="间距 cm" width="90" />
            <el-table-column prop="persistence" label="延伸 m" width="90" />
            <el-table-column prop="aperture" label="张开 mm" width="90" />
            <el-table-column prop="fillMaterial" label="充填" width="90" />
            <el-table-column prop="waterWet" label="渗水" width="90" />
            <el-table-column prop="jointCount" label="条数" width="80" />
          </el-table>
          <el-empty v-if="joints.length === 0" description="暂无节理组记录" :image-size="60" />
        </el-card>

        <el-card shadow="never">
          <template #header>
            <div class="card-head">
              <strong>修订记录</strong>
              <span class="muted">提交前可回看受影响节理、涌水与判定</span>
            </div>
          </template>
          <el-table :data="revisions" size="small" border>
            <el-table-column label="修订号" width="80">
              <template #default="{ row }">R{{ row.revisionNo }}</template>
            </el-table-column>
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag :type="revisionStatusTag[row.status as RevisionStatus].type" size="small">
                  {{ revisionStatusTag[row.status as RevisionStatus].label }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="提交时间" width="170">
              <template #default="{ row }">{{ new Date(row.submittedAt).toLocaleString('zh-CN') }}</template>
            </el-table-column>
            <el-table-column label="提交人" width="100">
              <template #default="{ row }">{{ row.submittedBy }}</template>
            </el-table-column>
            <el-table-column label="受影响" min-width="180">
              <template #default="{ row }">
                节理 {{ row.affectedJointIds.length }} · 涌水 {{ row.affectedWaterIds.length }} · 判定 {{ row.affectedGradeIds.length }}
              </template>
            </el-table-column>
            <el-table-column label="失败原因" min-width="160">
              <template #default="{ row }">
                <span v-if="row.status === 'failed'" class="fail-reason">{{ row.failReason }}</span>
                <span v-else class="muted">—</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="150">
              <template #default="{ row }">
                <el-button
                  v-if="row.status === 'failed'"
                  size="small"
                  type="primary"
                  @click="revisionStore.retry(row.id)"
                >
                  重试
                </el-button>
                <el-button
                  v-if="row.status === 'failed' || row.status === 'succeeded'"
                  size="small"
                  @click="revisionStore.discard(row.id)"
                >
                  清理
                </el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-if="revisions.length === 0" description="暂无修订记录" :image-size="60" />
        </el-card>

        <el-card shadow="never">
          <template #header><strong>判定状态一览</strong></template>
          <el-table :data="gradeStore.byFace(faceId)" size="small" border>
            <el-table-column label="时间" width="170">
              <template #default="{ row }">{{ new Date(row.judgedAt).toLocaleString('zh-CN') }}</template>
            </el-table-column>
            <el-table-column label="级别" width="90">
              <template #default="{ row }"><GradeTag :grade="row.grade" /></template>
            </el-table-column>
            <el-table-column prop="correctedBq" label="[BQ]" width="90" />
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag :type="row.status === 'current' ? 'success' : row.status === 'pending_review' ? 'danger' : 'info'" size="small">
                  {{ gradeStatusLabel[row.status as GradeStatus] }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="来源修订" width="90">
              <template #default="{ row }">
                <span v-if="row.revisionId" class="muted">R{{ revisions.find((r) => r.id === row.revisionId)?.revisionNo ?? '?' }}</span>
                <span v-else class="muted">原始</span>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </div>

      <el-card shadow="never">
        <template #header>
          <div class="card-head">
            <strong>岩性素描图</strong>
            <span class="muted">已布置 {{ segmentCount }} 条结构面线段（自动保存在浏览器本地）</span>
          </div>
        </template>
        <SketchCanvas
          :face-id="face.id"
          :lithology="face.lithology"
          :attitude="face.attitude"
          @change="onSketchChange"
        />
      </el-card>
    </div>

    <FaceEditDialog v-model="editDialogVisible" :face="face" />
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.header {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.header h2 {
  margin: 0;
}
.spacer {
  flex: 1;
}
.grid {
  display: grid;
  grid-template-columns: 620px minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}
.left {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.card-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.muted {
  color: #7b8592;
  font-size: 13px;
}
.support {
  margin: 8px 0;
  color: #2f3a46;
}
.grade-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.fail-reason {
  color: #d3542f;
  font-size: 12px;
}
</style>
