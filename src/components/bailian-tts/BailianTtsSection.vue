<script setup lang="ts">
/**
 * 第三步：配音（两种来源）
 *
 * AI 配音：文案分句 → 百炼逐句合成 → 拼成完整旁白。音色在选择面板里挑
 * （全量 88 个系统音色，可搜索/分组/逐行试听），切换音色后需重新合成。
 * 我的配音：逐句上传自己的录音文件，或直接在软件里录；音频统一转成与
 * TTS 相同的 mp3 参数并测时长，后续混剪/字幕的时间轴逻辑完全共用。
 */
import { ElMessage } from 'element-plus'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAppConfig } from '@/composables/useAppConfig'
import { useBailianTts, type TtsSentenceState } from '@/composables/bailian-tts/useBailianTts'
import { useWorkflowState } from '@/composables/useWorkflowState'
import {
  TTS_VOICE_GROUPS,
  TTS_VOICE_OPTIONS,
  findTtsVoice,
  ttsVoiceLabel,
  type TtsVoiceGroup,
  type TtsVoiceOption,
} from '@/config/tts-voices'

const {
  sentences,
  narration,
  totalDurationMs,
  isSynthesizing,
  voiceSource,
  loadFromCopy,
  synthesizeAll,
  synthesizeSentence,
  resetAiSynthesis,
  importUserAudioFor,
  saveRecordingFor,
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

const currentVoiceId = computed(() => appConfig.config.value.bailianTtsVoice)
const currentVoiceLabel = computed(() => {
  const id = currentVoiceId.value
  if (!id) return '未设置音色'
  return findTtsVoice(id) ? ttsVoiceLabel(id) : `自定义 · ${id}`
})

// ===== 音色选择面板 =====
const pickerOpen = ref(false)
const pickerSearch = ref('')
const pickerGroup = ref<'全部' | TtsVoiceGroup>('全部')

const filteredGroups = computed(() => {
  const query = pickerSearch.value.trim().toLowerCase()
  const matches = (voice: TtsVoiceOption) => {
    if (pickerGroup.value !== '全部' && voice.group !== pickerGroup.value) {
      return false
    }
    if (!query) return true
    const haystack =
      `${voice.name} ${voice.gender} ${voice.traits} ${voice.tags} ${voice.id}`.toLowerCase()
    return haystack.includes(query)
  }
  return TTS_VOICE_GROUPS.map((group) => ({
    group,
    voices: TTS_VOICE_OPTIONS.filter((v) => v.group === group && matches(v)),
  })).filter((section) => section.voices.length > 0)
})

const filteredCount = computed(() =>
  filteredGroups.value.reduce((sum, section) => sum + section.voices.length, 0),
)

/** 当前音色若不在名单内（配置中心手填的复刻音色等），在面板顶部单独成行 */
const customVoice = computed(() => {
  const id = currentVoiceId.value
  return id && !findTtsVoice(id) ? id : ''
})

const PREVIEW_TEXT_ZH = '大家好，这是一段音色试听，选我来为你的视频配音吧。'
const PREVIEW_TEXT_EN = 'Hello, this is a voice preview. Pick me to narrate your video.'
const previewingId = ref('')
const previewAudioUrl = ref('')

/** 用指定音色合成一句示例并播放（面板逐行试听与顶部试听共用） */
async function previewVoice(voice: TtsVoiceOption | string): Promise<void> {
  const voiceId = typeof voice === 'string' ? voice : voice.id
  if (!voiceId || previewingId.value) return
  if (!appConfig.isLoaded.value) await appConfig.refreshConfig()
  if (!appConfig.hasBailianKey.value) {
    ElMessage.warning('请先在配置中心填写百炼 API Key')
    return
  }
  previewingId.value = voiceId
  try {
    const group = typeof voice === 'string' ? undefined : voice.group
    const result = await window.desktopApi.synthesizeBailianTtsOne({
      text: group === '英文' ? PREVIEW_TEXT_EN : PREVIEW_TEXT_ZH,
      voice: voiceId,
    })
    const url = (result as { audioUrl?: unknown })?.audioUrl
    if (typeof url !== 'string' || !url) {
      throw new Error('试听结果异常')
    }
    previewAudioUrl.value = url
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '试听失败')
  } finally {
    previewingId.value = ''
  }
}

async function selectVoice(next: string): Promise<void> {
  const prev = currentVoiceId.value
  if (!next || next === prev) {
    pickerOpen.value = false
    return
  }
  await appConfig.saveConfig({
    ...appConfig.config.value,
    bailianTtsVoice: next,
  })
  pickerOpen.value = false
  if (sentences.value.some((s) => s.status === 'done' && s.source === 'ai')) {
    resetAiSynthesis()
    ElMessage.info('音色已切换，之前的 AI 配音已清空，请重新逐句合成（自己的录音不受影响）')
  } else {
    ElMessage.success('音色已切换')
  }
}

// ===== 我的配音：软件内录音 =====
const recordingIndex = ref(-1)
let mediaRecorder: MediaRecorder | null = null
let mediaStream: MediaStream | null = null
let recordChunks: Blob[] = []

function stopMediaStream(): void {
  mediaStream?.getTracks().forEach((track) => track.stop())
  mediaStream = null
  mediaRecorder = null
}

async function startRecording(index: number): Promise<void> {
  if (recordingIndex.value !== -1) return
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch {
    ElMessage.error(
      '打不开麦克风：请在系统设置里允许本软件使用麦克风，或改用「上传」选已录好的音频',
    )
    return
  }
  recordChunks = []
  mediaRecorder = new MediaRecorder(mediaStream)
  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size) recordChunks.push(event.data)
  }
  mediaRecorder.onstop = () => {
    const blob = new Blob(recordChunks, {
      type: mediaRecorder?.mimeType || 'audio/webm',
    })
    stopMediaStream()
    recordingIndex.value = -1
    if (blob.size) {
      void saveRecordingFor(index, blob)
    }
  }
  recordingIndex.value = index
  mediaRecorder.start()
}

function stopRecording(): void {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop()
  } else {
    stopMediaStream()
    recordingIndex.value = -1
  }
}

onBeforeUnmount(() => {
  if (recordingIndex.value !== -1) stopRecording()
})

const doneCount = computed(
  () => sentences.value.filter((s) => s.status === 'done').length,
)

function formatDuration(ms: number): string {
  if (!ms) return '—'
  return `${(ms / 1000).toFixed(1)} 秒`
}

function statusLabel(status: TtsSentenceState['status']): string {
  switch (status) {
    case 'synthesizing':
      return '处理中…'
    case 'error':
      return '失败'
    case 'done':
      return '已就位'
    default:
      return '待处理'
  }
}
</script>

<template>
  <section class="bailian-tts-section">
    <div class="tts-mode-row" role="tablist" aria-label="配音来源">
      <button
        type="button"
        class="tts-mode-btn"
        :class="{ 'is-active': voiceSource === 'ai' }"
        @click="voiceSource = 'ai'"
      >
        AI 配音
      </button>
      <button
        type="button"
        class="tts-mode-btn"
        :class="{ 'is-active': voiceSource === 'mine' }"
        @click="voiceSource = 'mine'"
      >
        我的配音
      </button>
      <span class="tts-voice-model">
        模型 {{ appConfig.config.value.bailianTtsModel }}
      </span>
    </div>

    <template v-if="voiceSource === 'ai'">
      <div class="tts-voice-row">
        <label class="tts-voice-label">音色</label>
        <button
          type="button"
          class="tts-voice-picker-btn"
          :disabled="isSynthesizing"
          @click="pickerOpen = true"
        >
          <span class="tts-voice-picker-label">{{ currentVoiceLabel }}</span>
          <span class="tts-voice-picker-action">选择音色</span>
        </button>
        <button
          class="ui-ai-btn"
          type="button"
          :disabled="!!previewingId || isSynthesizing"
          @click="previewVoice(currentVoiceId)"
        >
          {{ previewingId === currentVoiceId ? '生成中…' : '试听' }}
        </button>
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
    </template>

    <template v-else>
      <p class="tts-mine-hint">
        逐句用你自己的声音：点「上传」选一段录好的音频，或点「录音」直接在软件里念这一句。时长会自动测出来，后面混剪、字幕照常走。
      </p>
      <div class="tts-actions">
        <button class="secondary-button" type="button" @click="loadFromCopy">
          载入文案分句
        </button>
        <span v-if="sentences.length" class="tts-mine-progress">
          已就位 {{ doneCount }} / {{ sentences.length }} 句
        </span>
      </div>
    </template>

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
          <span v-if="sentence.status === 'done'" class="tts-source-badge">
            {{ sentence.source === 'user' ? '我的录音' : 'AI' }}
          </span>
          <template v-if="voiceSource === 'ai'">
            <button
              v-if="sentence.status === 'done' || sentence.status === 'error'"
              class="tts-retry"
              type="button"
              :disabled="isSynthesizing"
              @click="synthesizeSentence(index)"
            >
              重合成
            </button>
          </template>
          <template v-else>
            <button
              class="tts-retry"
              type="button"
              :disabled="sentence.status === 'synthesizing' || recordingIndex !== -1"
              @click="importUserAudioFor(index)"
            >
              {{ sentence.status === 'done' ? '换录音' : '上传' }}
            </button>
            <button
              v-if="recordingIndex !== index"
              class="tts-retry"
              type="button"
              :disabled="sentence.status === 'synthesizing' || recordingIndex !== -1"
              @click="startRecording(index)"
            >
              录音
            </button>
            <button
              v-else
              class="tts-retry is-recording"
              type="button"
              @click="stopRecording"
            >
              ● 停止录音
            </button>
          </template>
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

    <teleport to="body">
      <div v-if="pickerOpen" class="voice-picker-backdrop" @click.self="pickerOpen = false">
        <section class="voice-picker" role="dialog" aria-modal="true" aria-label="选择音色">
          <header class="voice-picker-header">
            <h3>选择音色</h3>
            <span class="voice-picker-count">共 {{ TTS_VOICE_OPTIONS.length }} 个</span>
            <button type="button" class="voice-picker-close" aria-label="关闭" @click="pickerOpen = false">
              ×
            </button>
          </header>
          <div class="voice-picker-tools">
            <input
              v-model="pickerSearch"
              class="ui-input voice-picker-search"
              type="text"
              placeholder="搜索：温柔 / 大叔 / 东北话 / 新闻播报…"
            />
            <div class="voice-picker-groups">
              <button
                type="button"
                class="voice-group-chip"
                :class="{ 'is-active': pickerGroup === '全部' }"
                @click="pickerGroup = '全部'"
              >
                全部
              </button>
              <button
                v-for="group in TTS_VOICE_GROUPS"
                :key="group"
                type="button"
                class="voice-group-chip"
                :class="{ 'is-active': pickerGroup === group }"
                @click="pickerGroup = group"
              >
                {{ group }}
              </button>
            </div>
          </div>

          <audio
            v-if="previewAudioUrl"
            :src="previewAudioUrl"
            controls
            autoplay
            class="tts-preview-audio"
          ></audio>

          <div class="voice-picker-list">
            <div v-if="customVoice" class="voice-picker-section">
              <p class="voice-picker-section-title">当前自定义音色</p>
              <div class="voice-row is-current">
                <span class="voice-row-main">
                  <span class="voice-row-name">自定义 · {{ customVoice }}</span>
                  <span class="voice-row-tags">配置中心手填的音色 ID</span>
                </span>
                <span class="voice-row-current">当前</span>
              </div>
            </div>
            <p v-if="!filteredCount && !customVoice" class="tts-empty">
              没有匹配的音色，换个关键词试试。
            </p>
            <div
              v-for="section in filteredGroups"
              :key="section.group"
              class="voice-picker-section"
            >
              <p class="voice-picker-section-title">
                {{ section.group }} · {{ section.voices.length }}
              </p>
              <div
                v-for="voice in section.voices"
                :key="voice.id"
                class="voice-row"
                :class="{ 'is-current': voice.id === currentVoiceId }"
                @click="selectVoice(voice.id)"
              >
                <span class="voice-row-main">
                  <span class="voice-row-name">
                    {{ voice.name }} · {{ voice.gender }} · {{ voice.traits }}
                  </span>
                  <span class="voice-row-tags">{{ voice.tags }}</span>
                </span>
                <span v-if="voice.id === currentVoiceId" class="voice-row-current">
                  当前
                </span>
                <button
                  type="button"
                  class="ui-ai-btn voice-row-preview"
                  :disabled="!!previewingId"
                  @click.stop="previewVoice(voice)"
                >
                  {{ previewingId === voice.id ? '生成中…' : '试听' }}
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </teleport>
  </section>
</template>

<style scoped>
.bailian-tts-section {
  display: grid;
  gap: 10px;
}

.tts-mode-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.tts-mode-btn {
  height: 30px;
  padding: 0 16px;
  border: 1px solid #cbd5e1;
  border-radius: 999px;
  background: #ffffff;
  color: #41546b;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.tts-mode-btn.is-active {
  border-color: #2a6f97;
  background: #2a6f97;
  color: #ffffff;
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

.tts-voice-picker-btn {
  flex: 1;
  min-width: 180px;
  height: 30px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border: 1px solid #d5e1ec;
  border-radius: 7px;
  background: #ffffff;
  color: #18212f;
  font-size: 12px;
  cursor: pointer;
}

.tts-voice-picker-btn:hover:not(:disabled) {
  border-color: #2a6f97;
}

.tts-voice-picker-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.tts-voice-picker-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tts-voice-picker-action {
  flex: none;
  color: #2a6f97;
  font-weight: 700;
}

.tts-voice-model {
  color: #8296a8;
  font-size: 12px;
}

.tts-voice-row .ui-ai-btn {
  flex: none;
}

.tts-preview-audio {
  width: 100%;
  height: 30px;
}

.tts-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.tts-mine-hint {
  margin: 0;
  color: #64748b;
  font-size: 12px;
  line-height: 1.7;
}

.tts-mine-progress {
  color: #2a7d4f;
  font-size: 12px;
  font-weight: 700;
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
  max-height: 400px;
  overflow-y: auto;
  padding-right: 2px;
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
  flex-wrap: wrap;
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
  min-width: 120px;
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

.tts-source-badge {
  flex: none;
  height: 22px;
  padding: 0 8px;
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  background: #eef5fb;
  color: #2a6f97;
  font-size: 11px;
  font-weight: 700;
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

.tts-retry.is-recording {
  border-color: #f0c6bd;
  background: #fdf0ec;
  color: #d9694f;
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

/* ===== 音色选择面板 ===== */
.voice-picker-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: grid;
  place-items: center;
  background: rgba(24, 33, 47, 0.45);
}

.voice-picker {
  width: min(560px, calc(100vw - 48px));
  max-height: calc(100vh - 80px);
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border-radius: 14px;
  background: #ffffff;
  box-shadow: 0 18px 50px rgba(24, 33, 47, 0.25);
}

.voice-picker-header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.voice-picker-header h3 {
  margin: 0;
  color: #18212f;
  font-size: 16px;
}

.voice-picker-count {
  color: #8296a8;
  font-size: 12px;
}

.voice-picker-close {
  margin-left: auto;
  width: 28px;
  height: 28px;
  border: 1px solid #d5e1ec;
  border-radius: 50%;
  background: #ffffff;
  color: #41546b;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.voice-picker-tools {
  display: grid;
  gap: 8px;
}

.voice-picker-search {
  width: 100%;
  height: 34px;
}

.voice-picker-groups {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.voice-group-chip {
  height: 26px;
  padding: 0 12px;
  border: 1px solid #dcdfe6;
  border-radius: 999px;
  background: #ffffff;
  color: #41546b;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.voice-group-chip.is-active {
  border-color: #2a6f97;
  background: #2a6f97;
  color: #ffffff;
}

.voice-picker-list {
  overflow-y: auto;
  display: grid;
  gap: 12px;
  padding-right: 2px;
}

.voice-picker-section {
  display: grid;
  gap: 6px;
}

.voice-picker-section-title {
  margin: 0;
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
}

.voice-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid #e2eaf1;
  border-radius: 10px;
  background: #f8fbfd;
  cursor: pointer;
}

.voice-row:hover {
  border-color: #2a6f97;
}

.voice-row.is-current {
  border-color: #2a6f97;
  background: #eef5fb;
}

.voice-row-main {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 2px;
}

.voice-row-name {
  color: #29435f;
  font-size: 13px;
  font-weight: 700;
}

.voice-row-tags {
  color: #8296a8;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.voice-row-current {
  flex: none;
  color: #2a6f97;
  font-size: 12px;
  font-weight: 700;
}

.voice-row-preview {
  flex: none;
}
</style>
