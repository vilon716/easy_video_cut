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
      subtitleList.value = tts.timings.value.map((timing, index) => ({
        id: `segment-${index + 1}`,
        start: timing.startMs / 1000 + offsetSec,
        end: (timing.startMs + timing.durationMs) / 1000 + offsetSec,
        text: timing.text,
      }));
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
