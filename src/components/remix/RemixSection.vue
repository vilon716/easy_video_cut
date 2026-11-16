<script setup lang="ts">
/**
 * 第四步：素材混剪
 *
 * 按第三步的逐句时长配画面：本地素材库（中文关键词匹配文件名）+
 * Pexels（英文关键词搜竖屏）→ 逐句裁剪拼接 → 合上旁白出成片。
 * 成片写入既有成片槽位，下方即时预览，第五步字幕与导出沿原路继续。
 */
import { ElDivider } from 'element-plus'
import { onMounted, watch } from 'vue'
import { useAppConfig } from '@/composables/useAppConfig'
import { useBailianTts } from '@/composables/bailian-tts/useBailianTts'
import { useRemix } from '@/composables/remix/useRemix'

const remix = useRemix()
const tts = useBailianTts()
const appConfig = useAppConfig()

onMounted(() => {
  void appConfig.refreshConfig()
  remix.ensureRows()
})

watch(
  () => tts.allDone.value,
  (done) => {
    if (done) remix.ensureRows()
  },
)

function formatDuration(ms: number): string {
  if (!ms) return '—'
  return `${(ms / 1000).toFixed(1)} 秒`
}

function statusLabel(status: string): string {
  switch (status) {
    case 'assigning':
      return '配素材中…'
    case 'assigned':
      return '已配'
    case 'error':
      return '没配上'
    default:
      return '待配'
  }
}
</script>

<template>
  <section class="remix-section">
    <el-divider class="remix-divider">第四步：素材混剪</el-divider>

    <p class="remix-status">
      本地素材库：{{
        remix.materialsScanned.value
          ? `${remix.materials.value.length} 个片段`
          : '未扫描'
      }}
      · Pexels：{{ appConfig.hasPexelsKey.value ? '已配置' : '未配置' }}
      · Pixabay：{{ appConfig.hasPixabayKey.value ? '已配置' : '未配置' }}
      · Coverr：{{ appConfig.hasCoverrKey.value ? '已配置' : '未配置' }}
    </p>

    <div class="remix-actions">
      <button
        class="secondary-button"
        type="button"
        :disabled="remix.isScanning.value"
        @click="remix.scanMaterials"
      >
        {{ remix.isScanning.value ? '扫描中…' : '扫描素材库' }}
      </button>
      <button
        class="secondary-button"
        type="button"
        :disabled="remix.isGeneratingKeywords.value"
        @click="remix.generateKeywords"
      >
        {{ remix.isGeneratingKeywords.value ? '生成中…' : '生成关键词' }}
      </button>
      <button
        class="secondary-button"
        type="button"
        :disabled="remix.isAssigning.value"
        @click="remix.assignAll"
      >
        {{ remix.isAssigning.value ? '配素材中…' : '自动配素材' }}
      </button>
      <button
        class="primary-button"
        type="button"
        :disabled="!remix.allAssigned.value || remix.isComposing.value"
        @click="remix.compose"
      >
        {{ remix.isComposing.value ? '混剪合成中…' : '开始混剪' }}
      </button>
    </div>

    <div class="compose-options">
      <label class="compose-option">
        <span>转场</span>
        <select v-model="remix.transitionMode.value" class="ui-select">
          <option value="none">无（硬切）</option>
          <option value="fade">柔和叠化</option>
          <option value="flash">闪白</option>
        </select>
      </label>
      <label class="compose-option">
        <span>素材填充</span>
        <select v-model="remix.fillMode.value" class="ui-select">
          <option value="crop">裁剪铺满</option>
          <option value="blur">虚化背景</option>
        </select>
      </label>
      <label class="compose-option compose-option-wide">
        <span>片头标题</span>
        <input
          v-model="remix.introText.value"
          class="ui-input"
          type="text"
          maxlength="20"
          placeholder="留空无片头，如：显卡怎么选"
        />
      </label>
      <label class="compose-option compose-option-wide">
        <span>片尾文案</span>
        <input
          v-model="remix.outroText.value"
          class="ui-input"
          type="text"
          maxlength="20"
          placeholder="留空无片尾，如：关注我，看更多干货"
        />
      </label>
    </div>

    <p v-if="!remix.rows.value.length" class="remix-empty">
      先完成第三步配音，这里会按每一句的时长逐句配画面。
    </p>

    <ol v-else class="remix-list">
      <li v-for="row in remix.rows.value" :key="row.index" class="remix-row">
        <div class="remix-row-head">
          <span class="remix-idx">{{ row.index + 1 }}</span>
          <span class="remix-text">{{ row.text }}</span>
          <span class="remix-dur">{{ formatDuration(row.durationMs) }}</span>
        </div>
        <div class="remix-row-keywords">
          <input
            v-model="row.keywordZh"
            class="remix-kw"
            type="text"
            placeholder="中文关键词"
          />
          <input
            v-model="row.keywordEn"
            class="remix-kw"
            type="text"
            placeholder="English keyword"
          />
          <span
            class="remix-badge"
            :class="{ pexels: row.source === 'pexels', error: row.status === 'error' }"
          >
            {{
              row.status === 'assigned'
                ? row.source === 'pexels'
                  ? row.provider || 'Pexels'
                  : '本地'
                : statusLabel(row.status)
            }}
          </span>
        </div>
        <div v-if="row.clipPath" class="remix-row-clip">
          <video
            :src="row.previewUrl"
            class="remix-thumb"
            muted
            preload="metadata"
          ></video>
          <span class="remix-clip-name">{{ row.clipName }}</span>
          <button
            class="remix-next"
            type="button"
            :disabled="row.status === 'assigning'"
            @click="remix.nextClip(row.index)"
          >
            换一段
          </button>
        </div>
        <p
          v-if="row.pexelsError && row.source === 'local'"
          class="remix-row-error"
        >
          在线素材没配上（{{ row.pexelsError }}），先用了本地素材
        </p>
      </li>
    </ol>

    <p v-if="remix.result.value" class="remix-done">
      成片已生成（{{ formatDuration(remix.result.value.durationMs) }}），在下方
      预览；接着去第五步加字幕。
    </p>
  </section>
</template>

<style scoped>
.remix-section {
  display: grid;
  gap: 10px;
}

.remix-divider {
  margin-top: 20px;
  margin-bottom: 5px;
  border-color: #b9c9dc;
}

.remix-divider :deep(.el-divider__text) {
  padding: 5px 14px;
  border: 1px solid #c7d5e7;
  border-radius: 999px;
  color: #29435f;
  background: linear-gradient(180deg, #ffffff 0%, #eef5fb 100%);
  font-size: 13px;
  font-weight: 700;
  box-shadow: 0 4px 12px rgba(42, 74, 108, 0.08);
}

.remix-status {
  margin: 0;
  color: #8296a8;
  font-size: 12px;
  line-height: 1.6;
}

.remix-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.compose-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  margin-top: 10px;
}

.compose-option {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #64748b;
}

.compose-option-wide .ui-input {
  width: 190px;
}

.remix-empty {
  margin: 0;
  color: #94a3b8;
  font-size: 12px;
  line-height: 1.7;
}

.remix-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
  /* 句子多时列表自己滚动，别把下面的按钮推到很远 */
  max-height: 460px;
  overflow-y: auto;
  padding-right: 2px;
}

.remix-row {
  padding: 8px 10px;
  border: 1px solid #e2eaf1;
  border-radius: 10px;
  background: #f8fbfd;
  display: grid;
  gap: 6px;
}

.remix-row-head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.remix-idx {
  flex: none;
  width: 20px;
  height: 20px;
  display: inline-grid;
  place-items: center;
  border-radius: 50%;
  color: #ffffff;
  background: #2a6f97;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  margin-top: 1px;
}

.remix-text {
  flex: 1;
  min-width: 0;
  color: #29435f;
  font-size: 13px;
  line-height: 1.6;
}

.remix-dur {
  flex: none;
  color: #8296a8;
  font-size: 12px;
  font-weight: 600;
  line-height: 22px;
}

.remix-row-keywords {
  display: flex;
  gap: 6px;
  align-items: center;
}

.remix-kw {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  border: 1px solid #d5e1ec;
  border-radius: 7px;
  background: #ffffff;
  color: #18212f;
  font-size: 12px;
  outline: none;
}

.remix-kw:focus {
  border-color: #2a6f97;
}

.remix-badge {
  flex: none;
  padding: 2px 8px;
  border-radius: 999px;
  color: #64748b;
  background: #e8eef4;
  font-size: 11px;
  font-weight: 700;
}

.remix-badge.pexels {
  color: #0c6b58;
  background: #e2f4ec;
}

.remix-badge.error {
  color: #d9694f;
  background: #fdece8;
}

.remix-row-clip {
  display: flex;
  align-items: center;
  gap: 8px;
}

.remix-row-error {
  margin: 0;
  color: #c05621;
  font-size: 11px;
  line-height: 1.5;
}

.remix-thumb {
  width: 40px;
  height: 60px;
  object-fit: cover;
  border-radius: 6px;
  background: #0f172a;
  flex: none;
}

.remix-clip-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #64748b;
  font-size: 12px;
}

.remix-next {
  flex: none;
  height: 24px;
  padding: 0 10px;
  border: 1px solid #d5e6f2;
  border-radius: 999px;
  color: #2a6f97;
  background: #eef5fb;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.remix-next:hover:not(:disabled) {
  background: #e3eff8;
}

.remix-next:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.remix-done {
  margin: 0;
  padding: 8px 10px;
  border: 1px solid #cfe3d2;
  border-radius: 10px;
  color: #2a7d4f;
  background: #f2f9f3;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.6;
}
</style>
