<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useFaceStore } from '../stores/faceStore';
import { useGradeStore } from '../stores/gradeStore';
import { useJointStore } from '../stores/jointStore';
import { useRevisionStore } from '../stores/revisionStore';
import { useFaceFilter } from '../hooks/useFaceFilter';
import FaceCard from '../components/common/FaceCard.vue';
import FaceEditDialog from '../components/common/FaceEditDialog.vue';
import GradeTag from '../components/common/GradeTag.vue';
import {
  EXCAVATION_METHODS,
  LITHOLOGIES,
  WEATHERINGS,
} from '../types/face';
import { ROCK_GRADES } from '../types/grade';

const router = useRouter();
const faceStore = useFaceStore();
const gradeStore = useGradeStore();
const jointStore = useJointStore();
const revisionStore = useRevisionStore();
const { filters, result, options, gradeDistribution, reset } = useFaceFilter();

const dialogVisible = ref(false);

const maxGradeCount = computed(() => Math.max(1, ...gradeDistribution.value.map((g) => g.count)));

function openDialog() {
  dialogVisible.value = true;
}

onMounted(async () => {
  await faceStore.load();
  await gradeStore.load();
  await jointStore.load();
  await revisionStore.load();
});
</script>

<template>
  <div class="page">
    <div class="header">
      <h2>掌子面台账</h2>
      <el-tag>共 {{ faceStore.items.length }} 个掌子面</el-tag>
      <el-tag type="info" effect="plain">筛选命中 {{ result.length }} 个</el-tag>
      <div class="spacer" />
      <el-button type="primary" @click="openDialog">新建编录</el-button>
    </div>

    <el-card shadow="never">
      <el-form :inline="true" @submit.prevent>
        <el-form-item label="里程区间">
          <el-input-number v-model="filters.chainageFrom" :min="0" :max="999999" :step="10" controls-position="right" style="width: 130px" />
          <span style="margin: 0 6px">—</span>
          <el-input-number v-model="filters.chainageTo" :min="0" :max="999999" :step="10" controls-position="right" style="width: 130px" />
        </el-form-item>
        <el-form-item label="岩性">
          <el-select v-model="filters.lithology" style="width: 140px">
            <el-option label="全部" value="all" />
            <el-option v-for="l in options.lithologies" :key="l" :label="l" :value="l" />
          </el-select>
        </el-form-item>
        <el-form-item label="围岩级别">
          <el-select v-model="filters.grade" style="width: 120px">
            <el-option label="全部" value="all" />
            <el-option v-for="g in ROCK_GRADES" :key="g" :label="`${g} 级`" :value="g" />
          </el-select>
        </el-form-item>
        <el-form-item label="开挖方式">
          <el-select v-model="filters.method" style="width: 130px">
            <el-option label="全部" value="all" />
            <el-option v-for="m in EXCAVATION_METHODS" :key="m" :label="m" :value="m" />
          </el-select>
        </el-form-item>
        <el-form-item label="关键词">
          <el-input v-model="filters.keyword" placeholder="编号 / 地质员 / 岩性" clearable style="width: 180px" />
        </el-form-item>
        <el-form-item>
          <el-button @click="reset">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never">
      <template #header><strong>围岩级别分布</strong></template>
      <div class="dist">
        <div v-for="item in gradeDistribution" :key="item.grade" class="dist-row">
          <GradeTag :grade="item.grade" />
          <div class="bar-wrap">
            <div class="bar" :style="{ width: `${(item.count / maxGradeCount) * 100}%` }" />
          </div>
          <span class="count">{{ item.count }} 个</span>
        </div>
      </div>
    </el-card>

    <div v-if="result.length === 0" class="empty">
      <el-empty description="没有符合条件的掌子面" />
    </div>
    <div v-else class="grid">
      <FaceCard
        v-for="row in result"
        :key="row.face.id"
        :face="row.face"
        :grade="row.grade"
        :recalculating="!!revisionStore.activeByFace(row.face.id)"
        :joint-count="jointStore.byFace(row.face.id).length"
        :water-count="gradeStore.watersByFace(row.face.id).length"
        :footer="`编录时间 ${new Date(row.lastRecordedAt).toLocaleString('zh-CN')}`"
        @open="(id) => router.push(`/faces/${id}`)"
      />
    </div>

    <FaceEditDialog v-model="dialogVisible" />
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
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.empty {
  padding: 30px 0;
}
.dist {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dist-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.bar-wrap {
  flex: 1;
  height: 14px;
  background: #f0f3f6;
  border-radius: 7px;
  overflow: hidden;
}
.bar {
  height: 100%;
  background: linear-gradient(90deg, #7fbf9a, #2f8f5b);
}
.count {
  width: 70px;
  text-align: right;
  color: #5b6470;
  font-size: 13px;
}
</style>
