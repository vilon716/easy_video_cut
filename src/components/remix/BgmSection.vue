<script setup lang="ts">
/**
 * 背景音乐（BGM，可选）：跟在第四步素材混剪下面。
 * 本地文件 / Coverr 在线匹配二选一，音量可调；混剪合成时
 * 循环铺在旁白下面、结尾自动淡出。不选则成片只有旁白。
 */
import { ElDivider } from 'element-plus'
import { BGM_STYLE_PRESETS, useBgm } from '@/composables/remix/useBgm'

const bgm = useBgm()

function formatDuration(sec: number): string {
  if (!sec || sec <= 0) return ''
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
</script>

<template>
  <section class="bgm-section">
    <el-divider class="bgm-divider">背景音乐（可选）</el-divider>

    <div class="bgm-modes">
      <button
        type="button"
        class="secondary-button"
        :class="{ 'bgm-mode-active': bgm.mode.value === 'none' }"
        @click="bgm.mode.value = 'none'"
      >
        无 BGM
      </button>
      <button
        type="button"
        class="secondary-button"
        :class="{ 'bgm-mode-active': bgm.mode.value === 'local' }"
        @click="bgm.mode.value = 'local'"
      >
        本地文件
      </button>
      <button
        type="button"
        class="secondary-button"
        :class="{ 'bgm-mode-active': bgm.mode.value === 'online' }"
        @click="bgm.mode.value = 'online'"
      >
        在线匹配
      </button>
    </div>

    <div v-if="bgm.mode.value === 'local'" class="bgm-local">
      <div class="bgm-row">
        <button type="button" class="secondary-button" @click="bgm.pickLocalFile()">
          选择音乐文件
        </button>
        <span class="bgm-name">{{ bgm.localName.value || '还没选（MP3 / WAV / M4A 都行）' }}</span>
      </div>
      <div class="bgm-row">
        <button type="button" class="secondary-button" @click="bgm.pickLocalFolder()">
          选择 BGM 文件夹
        </button>
        <span class="bgm-name">{{ bgm.localFolder.value || '还没选（把常备 BGM 都放一个文件夹里）' }}</span>
        <button
          type="button"
          class="secondary-button"
          :disabled="bgm.isPickingRandomLocal.value"
          @click="bgm.randomLocal()"
        >
          🎲 随机选一首
        </button>
      </div>
    </div>

    <div v-if="bgm.mode.value === 'online'" class="bgm-online">
      <div class="bgm-chips">
        <span class="bgm-chips-label">抖音常用风格，点一下随机选一首：</span>
        <button
          v-for="preset in BGM_STYLE_PRESETS"
          :key="preset.query"
          type="button"
          class="bgm-chip"
          :disabled="bgm.isSearching.value || bgm.isDownloading.value"
          @click="bgm.randomPick(preset.query)"
        >
          {{ preset.label }}
        </button>
        <button
          type="button"
          class="bgm-chip bgm-chip-random"
          :disabled="bgm.isSearching.value || bgm.isDownloading.value"
          @click="bgm.randomPick()"
        >
          🎲 随机一首
        </button>
      </div>
      <div class="bgm-row">
        <input
          v-model="bgm.onlineQuery.value"
          class="bgm-input"
          type="text"
          placeholder="音乐风格，如 piano、upbeat、cinematic"
          @keyup.enter="bgm.searchOnline()"
        />
        <button
          type="button"
          class="secondary-button"
          :disabled="bgm.isSearching.value"
          @click="bgm.searchOnline()"
        >
          {{ bgm.isSearching.value ? '搜索中…' : '匹配音乐' }}
        </button>
      </div>
      <ul v-if="bgm.tracks.value.length" class="bgm-tracks">
        <li v-for="track in bgm.tracks.value" :key="track.id" class="bgm-track">
          <div class="bgm-track-head">
            <span class="bgm-track-title">{{ track.title }}</span>
            <span class="bgm-track-dur">{{ formatDuration(track.durationSec) }}</span>
            <button
              type="button"
              class="secondary-button"
              :disabled="bgm.isDownloading.value"
              @click="bgm.selectTrack(track)"
            >
              {{ bgm.selectedTrackId.value === track.id ? '已选用' : '选用' }}
            </button>
          </div>
          <audio class="bgm-preview" controls preload="none" :src="track.previewUrl" />
        </li>
      </ul>
    </div>

    <div v-if="bgm.mode.value !== 'none'" class="bgm-row bgm-volume">
      <span class="bgm-volume-label">BGM 音量</span>
      <input
        v-model.number="bgm.volumePercent.value"
        class="bgm-slider"
        type="range"
        min="0"
        max="50"
        step="1"
      />
      <span class="bgm-volume-value">{{ bgm.volumePercent.value }}%</span>
    </div>

    <p v-if="bgm.mode.value !== 'none'" class="bgm-hint">
      混剪时自动循环铺在旁白下面，结尾 2 秒淡出。
      {{ bgm.selection.value ? '已就绪，开始混剪就会带上。' : '先选好一首再开始混剪。' }}
    </p>
  </section>
</template>

<style scoped>
.bgm-section {
  display: grid;
  gap: 10px;
}
.bgm-modes,
.bgm-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.bgm-mode-active {
  border-color: #409eff;
  color: #409eff;
}
.bgm-name {
  font-size: 13px;
  color: #606266;
  word-break: break-all;
}
.bgm-online,
.bgm-local {
  display: grid;
  gap: 8px;
}
.bgm-input {
  flex: 1;
  min-width: 160px;
  padding: 6px 10px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  font-size: 13px;
}
.bgm-tracks {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}
.bgm-track {
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 8px;
  display: grid;
  gap: 6px;
}
.bgm-track-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.bgm-track-title {
  flex: 1;
  font-size: 13px;
  word-break: break-all;
}
.bgm-track-dur {
  font-size: 12px;
  color: #909399;
}
.bgm-preview {
  width: 100%;
  height: 32px;
}
.bgm-volume-label {
  font-size: 13px;
  color: #606266;
}
.bgm-slider {
  flex: 1;
  min-width: 120px;
}
.bgm-volume-value {
  font-size: 13px;
  min-width: 38px;
}
.bgm-hint {
  margin: 0;
  font-size: 12px;
  color: #909399;
}
.bgm-chips {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.bgm-chips-label {
  font-size: 12px;
  color: #909399;
}
.bgm-chip {
  border: 1px solid #dcdfe6;
  background: #fff;
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 12px;
  cursor: pointer;
}
.bgm-chip:hover:not(:disabled) {
  border-color: #409eff;
  color: #409eff;
}
.bgm-chip-random {
  border-color: #e6a23c;
  color: #e6a23c;
}
</style>
