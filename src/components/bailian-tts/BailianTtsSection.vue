<script setup lang="ts">
/**
 * 第三步：AI 配音（百炼逐句合成）
 *
 * 文案分句 → 逐句合成 → 拼成完整旁白。每句时长即后续混剪的分镜时长，
 * 单句可单独重合成。音色在本步下拉切换（切换后需重新合成），
 * 列表外的音色 ID 可在配置中心（百炼与素材）里填。
 */
import { ElMessage } from 'element-plus'
import { computed, onMounted, ref, watch } from 'vue'
import { useAppConfig } from '@/composables/useAppConfig'
import { useBailianTts, type TtsSentenceState } from '@/composables/bailian-tts/useBailianTts'
import { useWorkflowState } from '@/composables/useWorkflowState'
import { TTS_VOICE_OPTIONS } from '@/config/tts-voices'

const {
  sentences,
  narration,
  totalDurationMs,
  isSynthesizing,
  loadFromCopy,
  synthesizeAll,
  synthesizeSentence,
  resetSynthesis,
} = useBailianTts()

const appConfig = useAppConfig()
const { createdCopyText } = useWorkflowState()

onMounted(() => {
  void appConfig.refreshConfig()
  if (!sentences.value.length && createdCopyText.value.trim()) {
    loadFromCopy()
  }
})

// 文案更新后，若还没合成过任何一句，自动重新分句
watch(createdCopyText, (next) => {
  if (!next.trim()) return
  if (sentences.value.some((s) => s.status === 'done')) return
  loadFromCopy()
})

/** 音色下拉选项：预设名单 + 当前配置里的自定义音色（若不在名单内） */
const voiceOptions = computed(() => {
  const current = appConfig.config.value.bailianTtsVoice
  const list = [...TTS_VOICE_OPTIONS]
  if (current && !list.some((option) => option.id === current)) {
    list.unshift({ id: current, label: `自定义 · ${current}` })
  }
  return list
})

const PREVIEW_TEXT = '大家好，这是一段音色试听，选我来为你的视频配音吧。'
const isPreviewing = ref(false)
const previewAudioUrl = ref('')

/** 用当前选中的音色合成一句示例并播放（走单句合成，读配置里的音色） */
async function previewVoice(): Promise<void> {
  if (isPreviewing.value) return
  if (!appConfig.isLoaded.value) await appConfig.refreshConfig()
  if (!appConfig.hasBailianKey.value) {
    ElMessage.warning('请先在配置中心填写百炼 API Key')
    return
  }
  isPreviewing.value = true
  try {
    const result = await window.desktopApi.synthesizeBailianTtsOne({
      text: PREVIEW_TEXT,
    })
    const url = (result as { audioUrl?: unknown })?.audioUrl
    if (typeof url !== 'string' || !url) {
      throw new Error('试听结果异常')
    }
    previewAudioUrl.value = url
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '试听失败')
  } finally {
    isPreviewing.value = false
  }
}

async function onVoiceChange(event: Event): Promise<void> {
  const next = (event.target as HTMLSelectElement).value
  const prev = appConfig.config.value.bailianTtsVoice
  if (!next || next === prev) return
  await appConfig.saveConfig({
    ...appConfig.config.value,
    bailianTtsVoice: next,
  })
  if (sentences.value.some((s) => s.status === 'done')) {
    resetSynthesis()
    ElMessage.info('音色已切换，之前的配音已清空，请重新逐句合成')
  } else {
    ElMessage.success('音色已切换')
  }
}

function formatDuration(ms: number): string {
  if (!ms) return '—'
  return `${(ms / 1000).toFixed(1)} 秒`
}

function statusLabel(status: TtsSentenceState['status']): string {
  switch (status) {
    case 'synthesizing':
      return '合成中…'
    case 'error':
      return '失败'
    case 'done':
      return '已合成'
    default:
      return '待合成'
  }
}
</script>

<template>
  <section class="bailian-tts-section">
    <div class="tts-voice-row">
      <label class="tts-voice-label" for="tts-voice-select">音色</label>
      <select
        id="tts-voice-select"
        class="tts-voice-select"
        :value="appConfig.config.value.bailianTtsVoice"
        :disabled="isSynthesizing"
        @change="onVoiceChange"
      >
        <option
          v-for="option in voiceOptions"
          :key="option.id"
          :value="option.id"
        >
          {{ option.label }}
        </option>
      </select>
      <button
        class="ui-ai-btn"
        type="button"
        :disabled="isPreviewing || isSynthesizing"
        @click="previewVoice"
      >
        {{ isPreviewing ? '生成中…' : '试听' }}
      </button>
      <span class="tts-voice-model">
        模型 {{ appConfig.config.value.bailianTtsModel }}
      </span>
    </div>

    <audio
      v-if="previewAudioUrl"
      :src="previewAudioUrl"
      controls
      autoplay
      class="tts-preview-audio"
    ></audio>

    <div class="tts-actions">
      <button class="secondary-button" type="button" @click="loadFromCopy">
        载入文案分句
      </button>
      <button
        class="primary-button"
        type="button"
        :disabled="isSynthesizing"
        @click="synthesizeAll"
      >
        {{ isSynthesizing ? '合成中…' : '逐句合成配音' }}
      </button>
    </div>

    <p v-if="!sentences.length" class="tts-empty">
      先完成第二步文案，再点「载入文案分句」把文案切成一句一句。
    </p>

    <ol v-else class="tts-list">
      <li v-for="(sentence, index) in sentences" :key="index" class="tts-row">
        <div class="tts-row-main">
          <span class="tts-idx">{{ index + 1 }}</span>
          <span class="tts-text">{{ sentence.text }}</span>
          <span
            class="tts-meta"
            :class="{ error: sentence.status === 'error' }"
          >
            {{
              sentence.status === 'done'
                ? formatDuration(sentence.durationMs)
                : statusLabel(sentence.status)
            }}
          </span>
          <button
            v-if="sentence.status === 'done' || sentence.status === 'error'"
            class="tts-retry"
            type="button"
            :disabled="isSynthesizing"
            @click="synthesizeSentence(index)"
          >
            重合成
          </button>
        </div>
        <audio
          v-if="sentence.audioUrl"
          :src="sentence.audioUrl"
          controls
          preload="metadata"
          class="tts-audio"
        ></audio>
      </li>
    </ol>

    <div v-if="narration" class="tts-narration">
      <p class="tts-narration-label">
        完整旁白 · 共 {{ sentences.length }} 句 · 总时长
        {{ formatDuration(totalDurationMs) }}
      </p>
      <audio
        :src="narration.audioUrl"
        controls
        preload="metadata"
        class="tts-narration-audio"
      ></audio>
    </div>
  </section>
</template>

<style scoped>
.bailian-tts-section {
  display: grid;
  gap: 10px;
}

.tts-voice-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.tts-voice-label {
  color: #29435f;
  font-size: 12px;
  font-weight: 700;
}

.tts-voice-select {
  flex: 1;
  min-width: 180px;
  height: 30px;
  padding: 0 8px;
  border: 1px solid #d5e1ec;
  border-radius: 7px;
  background: #ffffff;
  color: #18212f;
  font-size: 12px;
  outline: none;
  cursor: pointer;
}

.tts-voice-select:focus {
  border-color: #2a6f97;
}

.tts-voice-select:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.tts-voice-model {
  color: #8296a8;
  font-size: 12px;
}

/* 试听按钮已改用全局 .ui-ai-btn（见 style.css 统一按钮方案） */
.tts-voice-row .ui-ai-btn {
  flex: none;
}

.tts-preview-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.tts-preview-audio {
  width: 100%;
  height: 30px;
}

.tts-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.tts-empty {
  margin: 0;
  color: #94a3b8;
  font-size: 12px;
  line-height: 1.7;
}

.tts-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.tts-row {
  padding: 8px 10px;
  border: 1px solid #e2eaf1;
  border-radius: 10px;
  background: #f8fbfd;
}

.tts-row-main {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.tts-idx {
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

.tts-text {
  flex: 1;
  min-width: 0;
  color: #29435f;
  font-size: 13px;
  line-height: 1.6;
}

.tts-meta {
  flex: none;
  color: #8296a8;
  font-size: 12px;
  font-weight: 600;
  line-height: 22px;
}

.tts-meta.error {
  color: #d9694f;
}

.tts-retry {
  flex: none;
  height: 22px;
  padding: 0 10px;
  border: 1px solid #d5e6f2;
  border-radius: 999px;
  color: #2a6f97;
  background: #eef5fb;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.tts-retry:hover:not(:disabled) {
  background: #e3eff8;
}

.tts-retry:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.tts-audio {
  width: 100%;
  height: 30px;
  margin-top: 6px;
}

.tts-narration {
  padding: 10px;
  border: 1px solid #cfe3d2;
  border-radius: 10px;
  background: #f2f9f3;
}

.tts-narration-label {
  margin: 0 0 6px;
  color: #2a7d4f;
  font-size: 12px;
  font-weight: 700;
}

.tts-narration-audio {
  width: 100%;
  height: 32px;
}
</style>
