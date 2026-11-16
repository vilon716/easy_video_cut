<script setup lang="ts">
/**
 * 成片预览：展示成片槽位里的最新成片（当前由第四步混剪生成）。
 */
import { computed } from 'vue'
import { VideoCamera } from '@element-plus/icons-vue'
import { useFinalVideo } from '@/composables/useFinalVideo'

const finalVideo = useFinalVideo()

const hasResult = computed(() => finalVideo.hasResult.value)
const resultVideoUrl = computed(() => finalVideo.resultVideoUrl.value)
</script>

<template>
  <section class="final-video-section">
    <video v-if="hasResult" class="result-video" :src="resultVideoUrl" controls autoplay></video>
    <div v-else class="empty-result">
      <VideoCamera class="empty-result-icon" aria-hidden="true" />
      <span>成片预览</span>
    </div>

  </section>
</template>

<style scoped>
.final-video-section {
  height: 280px;
  flex: 0 0 280px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  color: #5f6e80;
  font-size: 13px;
  line-height: 1.6;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.result-video {
  width: 100%;
  height: 100%;
  min-height: 0;
  flex: 1 1 auto;
  object-fit: contain;
  border-radius: 6px;
  background: #0f172a;
}

.empty-result {
  height: 100%;
  min-height: 0;
  flex: 1 1 auto;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 10px;
  border: 1px dashed #cbd5e1;
  border-radius: 6px;
  color: #718096;
  background: #f8fafc;
  font-size: 12px;
}

.empty-result-icon {
  width: 34px;
  height: 34px;
  color: #9aa4b2;
}
</style>
