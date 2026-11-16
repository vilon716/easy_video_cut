/**
 * 第五步字幕（按文案生成时间轴）
 *
 * 混剪流程里文案与逐句时长都是已知的，不再走语音识别：
 * 直接用第三步配音的逐句时间轴（起始时刻+时长）拼出字幕段，
 * 文案原文即字幕文本——零错字、零成本、即时完成。
 * 对外形状与原识别版保持一致（subtitleList / subtitleSrt / 状态等），
 * 字幕列与导出渲染无需改动；字幕文本仍可在界面上逐条编辑。
 */
import { ElMessage } from "element-plus";
import { computed, ref } from "vue";
import { useBailianTts } from "@/composables/bailian-tts/useBailianTts";
import { useFinalVideo } from "@/composables/useFinalVideo";
import type { SubtitleSegment } from "@/types/subtitle-recognition";

let sharedSubtitleRecognitionState: ReturnType<
  typeof useSubtitleRecognitionImpl
> | null = null;

function formatSrtTime(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  const pad = (value: number, length = 2) => String(value).padStart(length, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

const SUBTITLE_STYLE_STORAGE_KEY = "free-super-agent.subtitle-style";

/** 当前选中的字幕模板 id（与字幕样式弹窗共用同一份 localStorage） */
function currentSubtitleTemplateId(): string {
  try {
    const raw = window.localStorage.getItem(SUBTITLE_STYLE_STORAGE_KEY);
    const parsed = raw
      ? (JSON.parse(raw) as { templateId?: unknown })
      : null;
    return typeof parsed?.templateId === "string" ? parsed.templateId : "custom";
  } catch {
    return "custom";
  }
}

/**
 * 长句字幕切分：一整句糊成一大块很难看，按标点切成 ≤12 字的短段，
 * 每段时长按字数比例从整句时长里分。配音/混剪仍按整句走，不受影响。
 */
function splitLongSegment(
  text: string,
  start: number,
  end: number,
): { start: number; end: number; text: string }[] {
  const MAX_CHARS = 12;
  const trimmed = text.trim();
  if (trimmed.length <= MAX_CHARS) {
    return [{ start, end, text: trimmed }];
  }
  // 先按逗号等标点切成短语（标点留在前一段末尾）
  const phrases = trimmed.split(/(?<=[，、；：。！？…])\s*/).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  const pushCurrent = () => {
    if (current) {
      chunks.push(current);
      current = "";
    }
  };
  for (const phrase of phrases) {
    if (phrase.length > MAX_CHARS) {
      pushCurrent();
      for (let i = 0; i < phrase.length; i += MAX_CHARS) {
        chunks.push(phrase.slice(i, i + MAX_CHARS));
      }
    } else if ((current + phrase).length <= MAX_CHARS) {
      current += phrase;
    } else {
      pushCurrent();
      current = phrase;
    }
  }
  pushCurrent();
  // 纯标点的碎片并回上一段，避免单独一段只有一个顿号
  for (let i = chunks.length - 1; i > 0; i--) {
    if (/^[，、；：。！？…]+$/.test(chunks[i])) {
      chunks[i - 1] += chunks[i];
      chunks.splice(i, 1);
    }
  }
  if (!chunks.length) {
    return [{ start, end, text: trimmed }];
  }
  const totalChars = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const duration = end - start;
  let cursor = start;
  return chunks.map((chunk, index) => {
    const segEnd =
      index === chunks.length - 1
        ? end
        : cursor + duration * (chunk.length / totalChars);
    const segment = { start: cursor, end: segEnd, text: chunk };
    cursor = segEnd;
    return segment;
  });
}

function buildSrt(subtitles: SubtitleSegment[]): string {
  return subtitles
    .map(
      (item, index) =>
        `${index + 1}\n${formatSrtTime(item.start)} --> ${formatSrtTime(item.end)}\n${item.text.trim()}\n`,
    )
    .join("\n");
}

function useSubtitleRecognitionImpl() {
  const tts = useBailianTts();
  const finalVideo = useFinalVideo();

  const isRecognizing = ref(false);
  const subtitleTaskStatus = ref("未开始");
  const subtitleElapsedMs = ref(0);
  const subtitleList = ref<SubtitleSegment[]>([]);
  const subtitleMergedText = ref("");
  const subtitleRequestId = ref("");
  const subtitleSrt = ref("");

  const subtitleElapsedText = computed(
    () => `${(subtitleElapsedMs.value / 1000).toFixed(2)}秒`,
  );

  // 兼容旧导出：字幕生成不再需要音频源，恒为空
  const audioSourceUrl = computed(() => "");
  const effectiveAudioSourceUrl = computed(() => "");

  /** 字幕与画中画预览用的视频：成片槽位里的最新成片 */
  const videoSourceUrl = computed(() => finalVideo.resultVideoUrl.value);
  const effectiveVideoSourceUrl = computed(() => {
    const url = videoSourceUrl.value;
    if (
      url &&
      !url.startsWith("http") &&
      !url.startsWith("blob:") &&
      !url.startsWith("local-")
    ) {
      return `local-video://local-file/${encodeURIComponent(url)}`;
    }
    return url;
  });

  function formatSubtitlesText(subtitles: SubtitleSegment[]): string {
    return subtitles
      .map((item) => item.text.trim())
      .filter(Boolean)
      .join("");
  }

  function updateSubtitleText(id: string, text: string): void {
    const targetItem = subtitleList.value.find((item) => item.id === id);
    if (!targetItem) {
      return;
    }
    targetItem.text = text;
    subtitleMergedText.value = formatSubtitlesText(subtitleList.value);
    subtitleSrt.value = buildSrt(subtitleList.value);
  }

  /** 按文案+逐句时长生成字幕（替代原语音识别，名字沿用旧入口） */
  async function startSubtitleRecognition(): Promise<void> {
    if (isRecognizing.value) {
      return;
    }
    if (!tts.allDone.value || !tts.timings.value.length) {
      ElMessage.warning("请先完成第三步配音（字幕按配音的逐句时长生成）");
      return;
    }

    isRecognizing.value = true;
    const startedAt = Date.now();
    subtitleTaskStatus.value = "生成中";
    try {
      // 成片带片头时，旁白被整体后移，字幕时间轴同步偏移
      const offsetSec = finalVideo.introOffsetMs.value / 1000;
      // 长句切成短段轮着显示（一句一段会糊满屏）；双语模板要整句翻译，不切
      const shouldSplit = currentSubtitleTemplateId() !== "bilingual";
      const segments: SubtitleSegment[] = [];
      for (const timing of tts.timings.value) {
        const start = timing.startMs / 1000 + offsetSec;
        const end = (timing.startMs + timing.durationMs) / 1000 + offsetSec;
        const parts = shouldSplit
          ? splitLongSegment(timing.text, start, end)
          : [{ start, end, text: timing.text.trim() }];
        for (const part of parts) {
          segments.push({ id: `segment-${segments.length + 1}`, ...part });
        }
      }
      subtitleList.value = segments;
      subtitleMergedText.value = formatSubtitlesText(subtitleList.value);
      subtitleRequestId.value = "";
      subtitleSrt.value = buildSrt(subtitleList.value);
      // 双语模板：顺带把英文字幕翻译好（失败要露出原因，不静默）
      if (currentSubtitleTemplateId() === "bilingual") {
        subtitleTaskStatus.value = "翻译英文字幕中";
        try {
          await ensureBilingualTranslations();
        } catch (error) {
          ElMessage.error(
            `英文字幕翻译失败：${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      subtitleTaskStatus.value = "已生成";
      ElMessage.success("字幕已按文案生成");
    } finally {
      subtitleElapsedMs.value = Date.now() - startedAt;
      isRecognizing.value = false;
    }
  }

  /** 双语模板：给现有字幕逐句补英文字幕（已全部有译文时直接返回） */
  async function ensureBilingualTranslations(): Promise<void> {
    const list = subtitleList.value;
    if (!list.length) return;
    if (list.every((item) => item.subText?.trim())) return;
    const result = await window.desktopApi.translateSubtitles({
      sentences: list.map((item) => item.text),
    });
    if (!Array.isArray(result)) {
      throw new Error("翻译结果异常");
    }
    subtitleList.value = list.map((item, index) => ({
      ...item,
      subText: typeof result[index] === "string" ? result[index] : "",
    }));
  }

  async function stopSubtitleRecognition(): Promise<void> {
    if (!isRecognizing.value) {
      return;
    }
    isRecognizing.value = false;
    subtitleTaskStatus.value = "已中断";
    ElMessage.info("已停止字幕生成");
  }

  return {
    audioSourceUrl,
    effectiveAudioSourceUrl,
    effectiveVideoSourceUrl,
    ensureBilingualTranslations,
    isRecognizing,
    startSubtitleRecognition,
    stopSubtitleRecognition,
    subtitleElapsedText,
    subtitleList,
    subtitleMergedText,
    subtitleRequestId,
    subtitleSrt,
    subtitleTaskStatus,
    updateSubtitleText,
    videoSourceUrl,
  };
}

export function useSubtitleRecognition() {
  if (!sharedSubtitleRecognitionState) {
    sharedSubtitleRecognitionState = useSubtitleRecognitionImpl();
  }

  return sharedSubtitleRecognitionState;
}
