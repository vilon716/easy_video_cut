/**
 * 百炼配音（逐句合成）共享状态
 *
 * 输入：第二步的成稿文案（workflow 的 createdCopyText）。
 * 流程：文案分句 → 逐句调百炼 TTS → 每句落盘并测时长 → 全部完成后拼成
 * 一条完整旁白。timings（每句起始时刻+时长）供混剪步按句对齐素材、
 * 字幕步按句生成时间轴直接消费。
 */
import { ElMessage } from "element-plus";
import { computed, ref } from "vue";
import { useAppConfig } from "@/composables/useAppConfig";
import { useMoarkAccount } from "@/composables/useMoarkAccount";
import { useWorkflowState } from "@/composables/useWorkflowState";
import type {
  BailianNarrationResult,
  BailianTtsSentenceResult,
} from "@/types/bailian-tts";

export interface TtsSentenceState {
  text: string;
  status: "idle" | "synthesizing" | "done" | "error";
  fileName: string;
  audioUrl: string;
  durationMs: number;
  /** 这一句的声音来源：AI 合成 / 用户自己的录音（导入或软件内录制） */
  source: "ai" | "user";
}

export interface SentenceTiming {
  index: number;
  text: string;
  startMs: number;
  durationMs: number;
  audioUrl: string;
}

/** 单句最长字数，超了按逗号类标点再切（TTS 与分镜都更稳） */
const MAX_SENTENCE_CHARS = 70;

/** 文案分句：按句末标点/换行切，保留标点；过长再按逗号类标点切 */
export function splitSentences(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n");
  const rawParts = normalized.match(/[^。！？；…\n]+[。！？；…]?/g) ?? [];
  const sentences: string[] = [];
  for (const part of rawParts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.length <= MAX_SENTENCE_CHARS) {
      sentences.push(trimmed);
      continue;
    }
    const subParts = trimmed.match(/[^，、：,]+[，、：,]?/g) ?? [trimmed];
    let buffer = "";
    for (const sub of subParts) {
      if (buffer && (buffer + sub).length > MAX_SENTENCE_CHARS) {
        sentences.push(buffer.trim());
        buffer = sub;
      } else {
        buffer += sub;
      }
    }
    if (buffer.trim()) sentences.push(buffer.trim());
  }
  return sentences;
}

function isSentenceResult(value: unknown): value is BailianTtsSentenceResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "fileName" in value &&
    "audioUrl" in value &&
    "durationMs" in value
  );
}

function isNarrationResult(value: unknown): value is BailianNarrationResult {
  return isSentenceResult(value);
}

let sharedState: ReturnType<typeof useImpl> | null = null;

function useImpl() {
  const { createdCopyText } = useWorkflowState();
  const appConfig = useAppConfig();
  const { openConfigCenter } = useMoarkAccount();

  const sentences = ref<TtsSentenceState[]>([]);
  const narration = ref<BailianNarrationResult | null>(null);
  const isSynthesizing = ref(false);
  /** 配音来源模式：ai = 百炼逐句合成；mine = 用户逐句上传/录制自己的声音 */
  const voiceSource = ref<"ai" | "mine">("ai");

  const narrationAudioUrl = computed(() => narration.value?.audioUrl ?? "");
  const totalDurationMs = computed(() =>
    sentences.value.reduce((sum, s) => sum + (s.durationMs || 0), 0),
  );
  const allDone = computed(
    () =>
      sentences.value.length > 0 &&
      sentences.value.every((s) => s.status === "done"),
  );

  /** 每句的起始时刻（逐句时长累加），混剪与字幕的时间轴都从这里取 */
  const timings = computed<SentenceTiming[]>(() => {
    const list: SentenceTiming[] = [];
    let cursor = 0;
    sentences.value.forEach((s, index) => {
      list.push({
        index,
        text: s.text,
        startMs: cursor,
        durationMs: s.durationMs,
        audioUrl: s.audioUrl,
      });
      cursor += s.durationMs;
    });
    return list;
  });

  function loadFromCopy(): boolean {
    const text = createdCopyText.value.trim();
    if (!text) {
      ElMessage.warning("请先完成第二步文案创作");
      return false;
    }
    const parts = splitSentences(text);
    if (!parts.length) {
      ElMessage.warning("文案内容为空，无法分句");
      return false;
    }
    sentences.value = parts.map((part) => ({
      text: part,
      status: "idle",
      fileName: "",
      audioUrl: "",
      durationMs: 0,
      source: "ai",
    }));
    narration.value = null;
    return true;
  }

  /** 只清空 AI 合成的句子（切换音色后调用；用户自己的录音不受影响） */
  function resetAiSynthesis(): void {
    let cleared = false;
    sentences.value.forEach((s) => {
      if (s.source !== "ai") return;
      s.status = "idle";
      s.fileName = "";
      s.audioUrl = "";
      s.durationMs = 0;
      cleared = true;
    });
    if (cleared) narration.value = null;
  }

  /** 清空已合成结果（切换音色后调用，旧音色的音频不能再用） */
  function resetSynthesis(): void {
    sentences.value.forEach((s) => {
      s.status = "idle";
      s.fileName = "";
      s.audioUrl = "";
      s.durationMs = 0;
      s.source = "ai";
    });
    narration.value = null;
  }

  async function ensureBailianReady(): Promise<boolean> {
    if (!appConfig.isLoaded.value) {
      await appConfig.refreshConfig();
    }
    if (!appConfig.hasBailianKey.value) {
      ElMessage.warning("请先在配置中心填写百炼 API Key");
      openConfigCenter();
      return false;
    }
    return true;
  }

  async function concatNarration(): Promise<void> {
    const fileNames = sentences.value.map((s) => s.fileName);
    const result = await window.desktopApi.concatBailianNarration({
      fileNames,
    });
    if (!isNarrationResult(result)) {
      throw new Error("旁白拼接结果异常");
    }
    narration.value = result;
  }

  async function synthesizeAll(): Promise<void> {
    if (isSynthesizing.value) return;
    if (!sentences.value.length && !loadFromCopy()) return;
    if (!(await ensureBailianReady())) return;

    isSynthesizing.value = true;
    narration.value = null;
    sentences.value.forEach((s) => {
      s.status = "synthesizing";
    });
    try {
      const results = await window.desktopApi.synthesizeBailianTtsAll({
        sentences: sentences.value.map((s) => s.text),
      });
      if (!Array.isArray(results)) {
        throw new Error("合成结果异常");
      }
      for (const result of results as unknown[]) {
        if (!isSentenceResult(result)) continue;
        const row = sentences.value[result.index];
        if (!row) continue;
        row.status = "done";
        row.fileName = result.fileName;
        row.audioUrl = result.audioUrl;
        row.durationMs = result.durationMs;
        row.source = "ai";
      }
      if (!allDone.value) {
        throw new Error("部分句子未合成成功");
      }
      await concatNarration();
      ElMessage.success("配音合成完成");
    } catch (error) {
      sentences.value.forEach((s) => {
        if (s.status === "synthesizing") s.status = "error";
      });
      ElMessage.error(error instanceof Error ? error.message : "配音合成失败");
    } finally {
      isSynthesizing.value = false;
    }
  }

  async function synthesizeSentence(index: number): Promise<void> {
    const row = sentences.value[index];
    if (!row || row.status === "synthesizing") return;
    if (!(await ensureBailianReady())) return;

    row.status = "synthesizing";
    try {
      const result = await window.desktopApi.synthesizeBailianTtsOne({
        text: row.text,
      });
      if (!isSentenceResult(result)) {
        throw new Error("合成结果异常");
      }
      row.status = "done";
      row.fileName = result.fileName;
      row.audioUrl = result.audioUrl;
      row.durationMs = result.durationMs;
      row.source = "ai";
      if (allDone.value) {
        await concatNarration();
      } else {
        narration.value = null;
      }
    } catch (error) {
      row.status = "error";
      ElMessage.error(
        error instanceof Error ? error.message : `第 ${index + 1} 句合成失败`,
      );
    }
  }

  /** 把一段用户自己的录音（导入/录制的结果）挂到某一句上 */
  async function attachUserAudio(
    index: number,
    result: unknown,
  ): Promise<void> {
    const row = sentences.value[index];
    if (!row) return;
    if (!isSentenceResult(result)) {
      throw new Error("录音处理结果异常");
    }
    row.status = "done";
    row.fileName = result.fileName;
    row.audioUrl = result.audioUrl;
    row.durationMs = result.durationMs;
    row.source = "user";
    if (allDone.value) {
      await concatNarration();
      ElMessage.success("配音已全部就位，旁白拼接完成");
    } else {
      narration.value = null;
    }
  }

  /** 「我的配音」：给某一句选一个本地录音文件导入 */
  async function importUserAudioFor(index: number): Promise<void> {
    const row = sentences.value[index];
    if (!row || row.status === "synthesizing") return;
    const sourcePath = await window.desktopApi.selectAudioFile();
    if (!sourcePath) return;
    row.status = "synthesizing";
    try {
      const result = await window.desktopApi.importBailianUserAudio({
        sourcePath,
      });
      await attachUserAudio(index, result);
    } catch (error) {
      row.status = "error";
      ElMessage.error(
        error instanceof Error
          ? error.message
          : `第 ${index + 1} 句录音导入失败`,
      );
    }
  }

  /** 「我的配音」：把软件内录好的音频（Blob）保存到某一句 */
  async function saveRecordingFor(index: number, blob: Blob): Promise<void> {
    const row = sentences.value[index];
    if (!row || row.status === "synthesizing") return;
    row.status = "synthesizing";
    try {
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
      }
      const result = await window.desktopApi.saveBailianRecording({
        dataBase64: btoa(binary),
      });
      await attachUserAudio(index, result);
    } catch (error) {
      row.status = "error";
      ElMessage.error(
        error instanceof Error
          ? error.message
          : `第 ${index + 1} 句录音保存失败`,
      );
    }
  }

  return {
    sentences,
    narration,
    narrationAudioUrl,
    totalDurationMs,
    allDone,
    timings,
    isSynthesizing,
    voiceSource,
    loadFromCopy,
    synthesizeAll,
    synthesizeSentence,
    resetSynthesis,
    resetAiSynthesis,
    importUserAudioFor,
    saveRecordingFor,
  };
}

export function useBailianTts() {
  if (!sharedState) {
    sharedState = useImpl();
  }
  return sharedState;
}
