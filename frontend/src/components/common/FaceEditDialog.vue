<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { useFaceStore } from '../../stores/faceStore';
import { useRevisionStore } from '../../stores/revisionStore';
import {
  EXCAVATION_METHODS,
  LITHOLOGIES,
  WEATHERINGS,
  type TunnelFace,
  type TunnelFaceDraft,
} from '../../types/face';
import { formatChainage } from '../../utils/geoMath';

const props = defineProps<{
  modelValue: boolean;
  /** 传入则为修订模式，不传为新建模式 */
  face?: TunnelFace;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'submitted'): void;
}>();

const faceStore = useFaceStore();
const revisionStore = useRevisionStore();

const isEdit = computed(() => !!props.face);
const dialogTitle = computed(() => (isEdit.value ? `修订编录 · ${props.face?.faceNo ?? ''}` : '新建掌子面编录'));

const form = reactive<TunnelFaceDraft>({
  faceNo: '',
  chainage: 12486,
  mileageRange: [12486, 12489],
  excavationMethod: '台阶法',
  faceSize: '12.6×9.8',
  lithology: '石灰岩',
  weathering: '微风化',
  rockStrength: 55,
  attitude: { strike: 45, dipDirection: 135, dipAngle: 30 },
  geologist: '',
});

const error = ref('');

function initForm() {
  if (props.face) {
    const f = props.face;
    form.faceNo = f.faceNo;
    form.chainage = f.chainage;
    form.mileageRange = [...f.mileageRange] as [number, number];
    form.excavationMethod = f.excavationMethod;
    form.faceSize = f.faceSize;
    form.lithology = f.lithology;
    form.weathering = f.weathering;
    form.rockStrength = f.rockStrength;
    form.attitude = { ...f.attitude };
    form.geologist = f.geologist;
  } else {
    form.faceNo = '';
    form.chainage = 12486;
    form.mileageRange = [12486, 12489];
    form.excavationMethod = '台阶法';
    form.faceSize = '12.6×9.8';
    form.lithology = '石灰岩';
    form.weathering = '微风化';
    form.rockStrength = 55;
    form.attitude = { strike: 45, dipDirection: 135, dipAngle: 30 };
    form.geologist = '';
  }
  error.value = '';
}

watch(
  () => props.modelValue,
  (visible) => {
    if (visible) initForm();
  },
);

/** 修订预览：受影响节理/涌水/判定 + 校验 */
const preview = computed(() =>
  isEdit.value && props.face ? revisionStore.preview(props.face.id, { ...form }) : null,
);

/** 新建模式下的区间重叠校验 */
const createOverlap = computed(() => {
  if (isEdit.value) return null;
  const overlap = faceStore.items.find(
    (f) => form.mileageRange[0] < f.mileageRange[1] && f.mileageRange[0] < form.mileageRange[1],
  );
  return overlap ? `编录里程区间与掌子面「${overlap.faceNo}」重叠，请调整区间` : null;
});

const errors = computed(() => {
  const list: string[] = [];
  if (!form.faceNo.trim()) list.push('掌子面编号必填');
  if (!isEdit.value && faceStore.items.some((it) => it.faceNo === form.faceNo.trim())) {
    list.push('掌子面编号已存在，请更换');
  }
  if (form.mileageRange[1] < form.mileageRange[0]) list.push('编录里程区间终点不能小于起点');
  if (form.rockStrength <= 0 || form.rockStrength > 300) list.push('饱和抗压强度需在 0 ~ 300 MPa 之间');
  if (createOverlap.value) list.push(createOverlap.value);
  if (preview.value) list.push(...preview.value.errors);
  return list;
});

const canSubmit = computed(() => errors.value.length === 0);

async function submit() {
  error.value = '';
  if (!canSubmit.value) {
    error.value = errors.value[0];
    return;
  }
  if (isEdit.value && props.face) {
    const rev = await revisionStore.submit(props.face.id, { ...form }, form.geologist);
    if (rev) {
      ElMessage.success(`已提交修订 R${rev.revisionNo}，关联判定立即失效并重算`);
      emit('update:modelValue', false);
      emit('submitted');
    }
    return;
  }
  const created = await faceStore.add({ ...form, faceNo: form.faceNo.trim() });
  ElMessage.success(`已建立掌子面「${created.faceNo}」`);
  emit('update:modelValue', false);
  emit('submitted');
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="dialogTitle"
    width="760px"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <el-alert v-if="error" :title="error" type="error" :closable="false" style="margin-bottom: 10px" />

    <el-form :model="form" label-width="120px">
      <el-form-item label="掌子面编号" required>
        <el-input v-model="form.faceNo" placeholder="如 ZK-104" :disabled="isEdit" />
      </el-form-item>
      <el-form-item label="里程桩号 m">
        <el-input-number v-model="form.chainage" :min="0" :max="999999" :step="1" />
        <span class="hint">{{ formatChainage(form.chainage) }}</span>
      </el-form-item>
      <el-form-item label="编录里程区间 m">
        <el-input-number v-model="form.mileageRange[0]" :min="0" :max="999999" />
        <span style="margin: 0 6px">—</span>
        <el-input-number v-model="form.mileageRange[1]" :min="0" :max="999999" />
      </el-form-item>
      <el-form-item label="开挖方式">
        <el-select v-model="form.excavationMethod">
          <el-option v-for="m in EXCAVATION_METHODS" :key="m" :label="m" :value="m" />
        </el-select>
      </el-form-item>
      <el-form-item label="开挖断面尺寸 m">
        <el-input v-model="form.faceSize" placeholder="宽×高，如 12.6×9.8" />
      </el-form-item>
      <el-form-item label="岩性">
        <el-select v-model="form.lithology">
          <el-option v-for="l in LITHOLOGIES" :key="l" :label="l" :value="l" />
        </el-select>
      </el-form-item>
      <el-form-item label="风化程度">
        <el-select v-model="form.weathering">
          <el-option v-for="w in WEATHERINGS" :key="w" :label="w" :value="w" />
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
      <el-form-item label="地质员">
        <el-input v-model="form.geologist" style="width: 200px" />
      </el-form-item>
    </el-form>

    <!-- 修订模式：保存前列出受影响的节组、涌水与判定 -->
    <div v-if="isEdit && preview" class="affected">
      <el-divider content-position="left">保存前请确认受影响记录</el-divider>
      <el-alert
        v-for="(e, i) in preview.errors"
        :key="i"
        :title="e"
        type="error"
        :closable="false"
        style="margin-bottom: 8px"
      />
      <el-row :gutter="12">
        <el-col :span="8">
          <div class="aff-card">
            <div class="aff-title">受影响节理组（{{ preview.affectedJoints.length }}）</div>
            <el-empty v-if="preview.affectedJoints.length === 0" description="无" :image-size="40" />
            <ul v-else class="aff-list">
              <li v-for="j in preview.affectedJoints" :key="j.id">{{ j.label }}</li>
            </ul>
          </div>
        </el-col>
        <el-col :span="8">
          <div class="aff-card">
            <div class="aff-title">受影响涌水（{{ preview.affectedWaters.length }}）</div>
            <el-empty v-if="preview.affectedWaters.length === 0" description="无" :image-size="40" />
            <ul v-else class="aff-list">
              <li v-for="w in preview.affectedWaters" :key="w.id">
                {{ w.label }}
                <el-tag v-if="w.inRange === false" type="danger" size="small">区间外</el-tag>
              </li>
            </ul>
          </div>
        </el-col>
        <el-col :span="8">
          <div class="aff-card">
            <div class="aff-title">将失效重算的判定（{{ preview.affectedGrades.length }}）</div>
            <el-empty v-if="preview.affectedGrades.length === 0" description="无" :image-size="40" />
            <ul v-else class="aff-list">
              <li v-for="g in preview.affectedGrades" :key="g.id">{{ g.label }}</li>
            </ul>
          </div>
        </el-col>
      </el-row>
      <p class="aff-note">
        提交后关联判定立即失效并重新计算；重算完成前详情、台账与支护建议停用旧值。若重算失败，原编录与关联记录保持原样，可在「修订记录」中重试。
      </p>
    </div>

    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :disabled="!canSubmit" @click="submit">
        {{ isEdit ? '提交修订并重算' : '保存编录' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.hint {
  margin-left: 8px;
  color: #97a0ad;
  font-size: 12px;
}
.affected {
  margin-top: 4px;
}
.aff-card {
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  padding: 8px 10px;
  min-height: 120px;
}
.aff-title {
  font-size: 13px;
  font-weight: 600;
  color: #2f3a46;
  margin-bottom: 6px;
}
.aff-list {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
  color: #5b6470;
  line-height: 1.8;
}
.aff-note {
  margin: 10px 0 0;
  font-size: 12px;
  color: #97a0ad;
  line-height: 1.7;
}
</style>
