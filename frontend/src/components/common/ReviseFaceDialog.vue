<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { useFaceStore } from '../../stores/faceStore';
import { useGradeStore } from '../../stores/gradeStore';
import { useJointStore } from '../../stores/jointStore';
import { useRevisionStore } from '../../stores/revisionStore';
import { LITHOLOGIES, type TunnelFace } from '../../types/face';
import type { FaceSnapshot } from '../../types/revision';
import {
  diffSnapshots,
  findOverlapFaces,
  inRange,
  snapshotFace,
  watersOutsideRange,
} from '../../utils/revision';
import { attitudeText, formatChainage } from '../../utils/geoMath';
import GradeTag from './GradeTag.vue';

const props = defineProps<{
  modelValue: boolean;
  face: TunnelFace;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
}>();

const faceStore = useFaceStore();
const gradeStore = useGradeStore();
const jointStore = useJointStore();
const revisionStore = useRevisionStore();

const submitting = ref(false);

const form = reactive<FaceSnapshot>({
  chainage: 0,
  mileageRange: [0, 0],
  lithology: '',
  rockStrength: 1,
  attitude: { strike: 0, dipDirection: 0, dipAngle: 0 },
});

watch(
  () => props.modelValue,
  (open) => {
    if (open) Object.assign(form, snapshotFace(props.face));
  },
);

/** 受影响范围：节理组与涌水仍挂在原面，判定将失效重算，保存前一目了然 */
const changedFields = computed(() => diffSnapshots(snapshotFace(props.face), form));
const joints = computed(() => jointStore.byFace(props.face.id));
const waters = computed(() => gradeStore.watersByFace(props.face.id));
const grades = computed(() => gradeStore.confirmedByFace(props.face.id));
const overlaps = computed(() => findOverlapFaces(faceStore.items, props.face.id, form.mileageRange));
const outsideWaters = computed(() => watersOutsideRange(waters.value, form.mileageRange));

const errors = computed(() => {
  const list: string[] = [];
  if (form.mileageRange[1] < form.mileageRange[0]) list.push('编录里程区间终点不能小于起点');
  if (!(form.rockStrength > 0) || form.rockStrength > 300) list.push('饱和抗压强度需在 0 ~ 300 MPa 之间');
  if (overlaps.value.length > 0) {
    list.push(`编录区间与 ${overlaps.value.map((f) => f.faceNo).join('、')} 重叠`);
  }
  if (outsideWaters.value.length > 0) {
    list.push(
      `${outsideWaters.value.length} 条涌水落在新区间之外：${outsideWaters.value
        .map((w) => `${w.position}（${formatChainage(w.chainage)}）`)
        .join('、')}`,
    );
  }
  return list;
});

const canSubmit = computed(
  () => changedFields.value.length > 0 && errors.value.length === 0 && !submitting.value,
);

function close(): void {
  emit('update:modelValue', false);
}

async function submit(): Promise<void> {
  const nextRevision = props.face.revision + 1;
  const snapshot: FaceSnapshot = {
    chainage: form.chainage,
    mileageRange: [form.mileageRange[0], form.mileageRange[1]],
    lithology: form.lithology,
    rockStrength: form.rockStrength,
    attitude: { ...form.attitude },
  };
  submitting.value = true;
  const res = await revisionStore.submit(props.face.id, snapshot);
  submitting.value = false;
  if (!res.ok) {
    ElMessage.error(res.error ?? '修订提交失败');
    return;
  }
  ElMessage.success(`修订 R${nextRevision} 已提交：关联判定已失效，正在重算`);
  close();
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="`修正编录 · ${face.faceNo}（R${face.revision} → R${face.revision + 1}）`"
    width="920px"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="body">
      <el-form label-width="110px" class="form">
        <el-form-item label="里程桩号 m">
          <el-input-number v-model="form.chainage" :min="0" :max="999999" :step="1" />
          <span class="hint">{{ formatChainage(form.chainage) }}</span>
        </el-form-item>
        <el-form-item label="编录区间 m">
          <el-input-number v-model="form.mileageRange[0]" :min="0" :max="999999" />
          <span style="margin: 0 6px">—</span>
          <el-input-number v-model="form.mileageRange[1]" :min="0" :max="999999" />
        </el-form-item>
        <el-form-item label="岩性">
          <el-select v-model="form.lithology">
            <el-option v-for="l in LITHOLOGIES" :key="l" :label="l" :value="l" />
          </el-select>
        </el-form-item>
        <el-form-item label="饱和抗压强度">
          <el-input-number v-model="form.rockStrength" :min="1" :max="300" :step="1" />
          <span class="hint">MPa</span>
        </el-form-item>
        <el-form-item label="岩层产状">
          <span class="hint">走向</span>
          <el-input-number v-model="form.attitude.strike" :min="0" :max="360" />
          <span class="hint">倾向</span>
          <el-input-number v-model="form.attitude.dipDirection" :min="0" :max="360" />
          <span class="hint">倾角</span>
          <el-input-number v-model="form.attitude.dipAngle" :min="0" :max="90" />
        </el-form-item>
        <el-alert
          title="仅里程区间、岩性、强度、产状纳入修订；提交后关联判定立即失效重算，重算完成前台账与支护建议停用旧值。"
          type="info"
          :closable="false"
          show-icon
        />
      </el-form>

      <div class="preview">
        <div class="block">
          <strong>变更字段</strong>
          <div class="tags">
            <el-tag v-for="f in changedFields" :key="f" type="warning" size="small">{{ f }}</el-tag>
            <span v-if="changedFields.length === 0" class="muted">尚未修改关键字段</span>
          </div>
        </div>

        <div class="block">
          <strong>受影响节理组（{{ joints.length }} 组，修订后继续归属本掌子面）</strong>
          <div class="tags">
            <el-tag v-for="j in joints" :key="j.id" size="small" effect="plain">
              J{{ j.setNo }} {{ attitudeText(j.dipDirection, j.dipAngle) }}
            </el-tag>
            <span v-if="joints.length === 0" class="muted">无</span>
          </div>
        </div>

        <div class="block">
          <strong>受影响涌水（{{ waters.length }} 条，须全部落在新区间内）</strong>
          <el-table v-if="waters.length" :data="waters" size="small" border max-height="180">
            <el-table-column label="里程" width="110">
              <template #default="{ row }">{{ formatChainage(row.chainage) }}</template>
            </el-table-column>
            <el-table-column prop="position" label="部位" min-width="120" />
            <el-table-column prop="type" label="类型" width="80" />
            <el-table-column label="区间内" width="90">
              <template #default="{ row }">
                <el-tag :type="inRange(row.chainage, form.mileageRange) ? 'success' : 'danger'" size="small">
                  {{ inRange(row.chainage, form.mileageRange) ? '区间内' : '超出' }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
          <span v-else class="muted">无</span>
        </div>

        <div class="block">
          <strong>将失效重算的判定（{{ grades.length }} 条）</strong>
          <el-table v-if="grades.length" :data="grades" size="small" border max-height="180">
            <el-table-column label="时间" width="160">
              <template #default="{ row }">{{ new Date(row.judgedAt).toLocaleString('zh-CN') }}</template>
            </el-table-column>
            <el-table-column label="级别" width="90">
              <template #default="{ row }"><GradeTag :grade="row.grade" /></template>
            </el-table-column>
            <el-table-column prop="correctedBq" label="[BQ]" width="80" />
            <el-table-column label="修订后" min-width="110">
              <template #default>立即失效，按新编录重算</template>
            </el-table-column>
          </el-table>
          <span v-else class="muted">无有效判定，仅记录修订</span>
        </div>

        <el-alert
          v-for="(e, i) in errors"
          :key="i"
          :title="e"
          type="error"
          :closable="false"
          show-icon
          class="error-item"
        />
      </div>
    </div>

    <template #footer>
      <el-button @click="close">取消</el-button>
      <el-button type="primary" :disabled="!canSubmit" :loading="submitting" @click="submit">
        提交修订
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.body {
  display: grid;
  grid-template-columns: 380px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
.preview {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.hint {
  margin-left: 8px;
  color: #97a0ad;
  font-size: 12px;
}
.muted {
  color: #7b8592;
  font-size: 13px;
}
.error-item {
  margin-top: 2px;
}
</style>
