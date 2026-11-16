/**
 * 素材混剪（第四步）共享状态
 *
 * 输入：第三步配音的逐句时间轴（句子+时长）与完整旁白。
 * 流程：为每句生成中/英关键词 → 配素材优先级：本地文件名命中中文关键词
 * → Pexels 按英文关键词在线找画面对口的素材（失败原因记在行上）→ 本地
 * 轮换兜底 → 逐句裁成配音时长、统一竖屏后拼接并合上旁白 → 成片写入
 * 既有成片槽位，下方预览、第五步字幕、导出都沿原路消费。
 */
import { ElMessage } from "element-plus";
import { computed, ref } from "vue";
import { useAppConfig } from "@/composables/useAppConfig";
import { useMoarkAccount } from "@/composables/useMoarkAccount";
import { useBailianTts } from "@/composables/bailian-tts/useBailianTts";
import { useFinalVideo } from "@/composables/useFinalVideo";
import { useBgm } from "@/composables/remix/useBgm";
import type {
  MaterialClip,
  PexelsClipResult,
  RemixComposeResult,
  SentenceKeywords,
} from "@/types/remix";

export interface RemixRow {
  index: number;
  text: string;
  durationMs: number;
  keywordZh: string;
  keywordEn: string;
  source: "local" | "pexels" | null;
  clipName: string;
  clipPath: string;
  clipDurationMs: number;
  previewUrl: string;
  pexelsId: number | null;
  /** 在线来源名（Pexels / Pixabay），本地素材为空 */
  provider: string;
  /** 在线素材尝试过但失败的原因（成功或没试过为空），行上展示 */
  pexelsError: string;
  status: "idle" | "assigning" | "assigned" | "error";
}

function toLocalFileUrl(filePath: string): string {
  return `local-video://local-file/${encodeURIComponent(filePath)}`;
}

/** IPC 错误自带一长串前缀（Error invoking remote method ...），行上展示前剥掉 */
function cleanIpcError(error: unknown): string {
  const raw = error instanceof Error ? error.message : "请求失败";
  return raw.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, "");
}

function isComposeResult(value: unknown): value is RemixComposeResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "videoUrl" in value &&
    typeof (value as RemixComposeResult).videoUrl === "string"
  );
}

function isPexelsResult(value: unknown): value is PexelsClipResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "filePath" in value &&
    "pexelsId" in value
  );
}

let sharedState: ReturnType<typeof useImpl> | null = null;

function useImpl() {
  const tts = useBailianTts();
  const appConfig = useAppConfig();
  const { openConfigCenter } = useMoarkAccount();
  const finalVideo = useFinalVideo();
  const bgm = useBgm();

  const rows = ref<RemixRow[]>([]);
  const materials = ref<MaterialClip[]>([]);
  const materialsScanned = ref(false);
  const isScanning = ref(false);
  const isGeneratingKeywords = ref(false);
  const isAssigning = ref(false);
  const isComposing = ref(false);
  const result = ref<RemixComposeResult | null>(null);
  // 合成选项：转场 / 素材填充 / 片头 / 片尾
  const transitionMode = ref("fade");
  const fillMode = ref("crop");
  const introText = ref("");
  const outroText = ref("");
  let rowsSignature = "";

  const allAssigned = computed(
    () =>
      rows.value.length > 0 &&
      rows.value.every((row) => row.status === "assigned"),
  );

  /** 句子变了就重建行（关键词与配素材结果作废） */
  function ensureRows(): boolean {
    if (!tts.allDone.value) return false;
    const signature = tts.timings.value
      .map((t) => `${t.text}|${t.durationMs}`)
      .join("¦");
    if (signature === rowsSignature && rows.value.length) return true;
    rowsSignature = signature;
    rows.value = tts.timings.value.map((timing) => ({
      index: timing.index,
      text: timing.text,
      durationMs: timing.durationMs,
      keywordZh: "",
      keywordEn: "",
      source: null,
      clipName: "",
      clipPath: "",
      clipDurationMs: 0,
      previewUrl: "",
      pexelsId: null,
      provider: "",
      pexelsError: "",
      status: "idle",
    }));
    result.value = null;
    return true;
  }

  async function scanMaterials(): Promise<boolean> {
    if (!appConfig.isLoaded.value) await appConfig.refreshConfig();
    if (!appConfig.hasMaterialsDir.value) {
      ElMessage.warning("请先在配置中心选择本地素材库文件夹");
      openConfigCenter();
      return false;
    }
    isScanning.value = true;
    try {
      const clips = await window.desktopApi.scanRemixMaterials();
      materials.value = Array.isArray(clips) ? (clips as MaterialClip[]) : [];
      materialsScanned.value = true;
      if (!materials.value.length) {
        ElMessage.warning("素材库里没有找到视频片段");
      } else {
        ElMessage.success(`素材库扫描完成：${materials.value.length} 个片段`);
      }
      return true;
    } catch (error) {
      ElMessage.error(
        error instanceof Error ? error.message : "素材库扫描失败",
      );
      return false;
    } finally {
      isScanning.value = false;
    }
  }

  /**
   * 「扫描素材库」按钮：扫完之后如果句子都还没配素材，顺手把本地素材
   * 配上（用户说的"自动导入"指的是导入自己的素材）。只配本地、不生成
   * 关键词、不走在线——在线匹配是「自动配素材」按钮的事，别串错。
   */
  async function scanAndAssign(): Promise<void> {
    const ok = await scanMaterials();
    if (!ok) return;
    if (
      rows.value.length &&
      rows.value.every((row) => row.status !== "assigned")
    ) {
      await assignAllLocal();
    }
  }

  /** 调百炼为每句生成关键词并填回行里；成功返回 true */
  async function fetchAndFillKeywords(): Promise<boolean> {
    isGeneratingKeywords.value = true;
    try {
      const keywords = (await window.desktopApi.generateRemixKeywords({
        sentences: rows.value.map((row) => row.text),
      })) as SentenceKeywords[];
      rows.value.forEach((row, i) => {
        row.keywordZh = keywords[i]?.zh ?? "";
        row.keywordEn = keywords[i]?.en ?? "";
      });
      return true;
    } catch (error) {
      ElMessage.error(cleanIpcError(error));
      return false;
    } finally {
      isGeneratingKeywords.value = false;
    }
  }

  async function generateKeywords(): Promise<void> {
    if (!ensureRows()) {
      ElMessage.warning("请先完成第三步配音");
      return;
    }
    if (await fetchAndFillKeywords()) {
      ElMessage.success("关键词已生成，可手动修改");
    }
  }

  function usedLocalPaths(exceptIndex: number): Set<string> {
    return new Set(
      rows.value
        .filter((row) => row.index !== exceptIndex && row.source === "local")
        .map((row) => row.clipPath),
    );
  }

  /** hitOnly=true 时只返回文件名命中中文关键词的片段，没命中返回 null */
  function pickLocalClip(row: RemixRow, hitOnly = false): MaterialClip | null {
    const used = usedLocalPaths(row.index);
    const unused = materials.value.filter((clip) => !used.has(clip.filePath));
    if (row.keywordZh) {
      const matched = unused.find((clip) =>
        clip.fileName.replace(/\.[^.]+$/, "").includes(row.keywordZh),
      );
      if (matched) return matched;
    }
    return hitOnly ? null : (unused[0] ?? null);
  }

  function assignLocal(row: RemixRow, clip: MaterialClip): void {
    row.source = "local";
    row.clipName = clip.fileName;
    row.clipPath = clip.filePath;
    row.clipDurationMs = clip.durationMs;
    row.previewUrl = toLocalFileUrl(clip.filePath);
    row.pexelsId = null;
    row.provider = "";
    row.status = "assigned";
  }

  async function assignPexels(row: RemixRow, excludeIds: number[]): Promise<boolean> {
    if (!row.keywordEn.trim()) return false;
    const fetched = await window.desktopApi.fetchRemixPexelsClip({
      query: row.keywordEn.trim(),
      excludeIds,
    });
    if (!isPexelsResult(fetched)) {
      throw new Error("Pexels 返回异常");
    }
    row.source = "pexels";
    row.clipName = fetched.fileName;
    row.clipPath = fetched.filePath;
    row.clipDurationMs = fetched.durationMs;
    row.previewUrl = fetched.previewUrl;
    row.pexelsId = fetched.pexelsId;
    row.provider = fetched.provider || "Pexels";
    row.pexelsError = "";
    row.status = "assigned";
    return true;
  }

  async function assignRow(row: RemixRow): Promise<void> {
    row.status = "assigning";
    row.pexelsError = "";
    // 1) 本地文件名命中中文关键词——自己整理过的素材库最准
    const localHit = pickLocalClip(row, true);
    if (localHit) {
      assignLocal(row, localHit);
      return;
    }
    // 2) 在线按英文关键词找画面对口的素材（Pexels 主、Pixabay 备，
    //    服务层自动切换）；失败把原因记在行上
    if (appConfig.hasOnlineKey.value && row.keywordEn.trim()) {
      const usedIds = rows.value
        .filter((r) => r.index !== row.index && r.pexelsId !== null)
        .map((r) => r.pexelsId as number);
      try {
        if (await assignPexels(row, usedIds)) return;
      } catch (error) {
        row.pexelsError = cleanIpcError(error);
      }
    }
    // 3) 本地轮换兜底
    const local = pickLocalClip(row);
    if (local) {
      assignLocal(row, local);
      return;
    }
    row.status = "error";
  }

  /** 只用本地素材配一句：文件名命中中文关键词优先，没命中按顺序轮换 */
  function assignRowLocal(row: RemixRow): void {
    row.pexelsError = "";
    const clip = pickLocalClip(row, true) ?? pickLocalClip(row);
    if (clip) {
      assignLocal(row, clip);
    } else {
      row.status = "error";
    }
  }

  /** 「只用本地素材」：全部句子只配本地素材库的片段，完全不走在线 */
  async function assignAllLocal(): Promise<void> {
    if (!ensureRows()) {
      ElMessage.warning("请先完成第三步配音");
      return;
    }
    if (isAssigning.value) return;
    if (!materialsScanned.value) {
      const ok = await scanMaterials();
      if (!ok) return;
    }
    if (!materials.value.length) {
      ElMessage.warning("素材库里没有片段，先往素材库文件夹里放视频");
      return;
    }
    isAssigning.value = true;
    try {
      for (const row of rows.value) {
        assignRowLocal(row);
      }
      const failed = rows.value.filter((row) => row.status !== "assigned");
      if (failed.length) {
        ElMessage.warning(
          `${failed.length} 句没配上：素材库片段不够用（共 ${materials.value.length} 个）`,
        );
      } else {
        ElMessage.success(
          `全部句子已配好本地素材（素材库 ${materials.value.length} 个片段轮换）`,
        );
      }
    } finally {
      isAssigning.value = false;
    }
  }

  async function assignAll(): Promise<void> {
    if (!ensureRows()) {
      ElMessage.warning("请先完成第三步配音");
      return;
    }
    if (isAssigning.value) return;
    if (!materialsScanned.value) {
      await scanMaterials();
    }
    // 没有英文关键词就没法在线搜素材：缺了先自动生成一遍，免得漏点
    // 「生成关键词」就直接配素材、只能配到本地（还不报错，最坑人）。
    if (rows.value.some((row) => !row.keywordEn.trim())) {
      if (!(await fetchAndFillKeywords())) return;
    }
    isAssigning.value = true;
    try {
      for (const row of rows.value) {
        await assignRow(row);
      }
      const failed = rows.value.filter((row) => row.status !== "assigned");
      if (failed.length) {
        ElMessage.warning(
          `${failed.length} 句没配上素材：检查素材库是否有片段，或在配置中心填在线素材 Key（Pexels / Pixabay）`,
        );
      } else {
        const pexelsCount = rows.value.filter(
          (row) => row.source === "pexels",
        ).length;
        const localCount = rows.value.length - pexelsCount;
        ElMessage.success(
          `全部句子已配好素材（在线 ${pexelsCount} 句 · 本地 ${localCount} 句）`,
        );
        const pexelsFailed = rows.value.filter((row) => row.pexelsError);
        if (pexelsFailed.length) {
          ElMessage.warning(
            `${pexelsFailed.length} 句在线素材没配上、已用本地代替，原因写在句子下方`,
          );
        }
      }
    } finally {
      isAssigning.value = false;
    }
  }

  /** 换一段：本地按素材库顺序往后轮，Pexels 排除当前这条重新搜 */
  async function nextClip(index: number): Promise<void> {
    const row = rows.value[index];
    if (!row || row.status === "assigning") return;
    row.status = "assigning";
    try {
      // 换一段先试在线：排除已用过的在线结果重新搜一段对口的
      if (appConfig.hasOnlineKey.value && row.keywordEn.trim()) {
        const usedIds = rows.value
          .filter((r) => r.pexelsId !== null)
          .map((r) => r.pexelsId as number);
        try {
          if (await assignPexels(row, usedIds)) return;
        } catch (error) {
          row.pexelsError = cleanIpcError(error);
        }
      }
      if (materials.value.length) {
        const used = usedLocalPaths(row.index);
        const currentPos = materials.value.findIndex(
          (clip) => clip.filePath === row.clipPath,
        );
        const ordered = [
          ...materials.value.slice(currentPos + 1),
          ...materials.value.slice(0, currentPos + 1),
        ];
        const next =
          ordered.find((clip) => !used.has(clip.filePath)) ?? ordered[0];
        if (next) {
          assignLocal(row, next);
          return;
        }
      }
      row.status = row.clipPath ? "assigned" : "error";
    } catch (error) {
      row.status = row.clipPath ? "assigned" : "error";
      ElMessage.error(error instanceof Error ? error.message : "换素材失败");
    }
  }

  async function compose(): Promise<void> {
    if (!allAssigned.value) {
      ElMessage.warning("还有句子没配上素材");
      return;
    }
    if (!tts.narration.value) {
      ElMessage.warning("请先完成第三步配音（需要完整旁白）");
      return;
    }
    isComposing.value = true;
    try {
      const composed = await window.desktopApi.composeRemix({
        segments: rows.value.map((row) => ({
          filePath: row.clipPath,
          durationMs: row.durationMs,
          sourceDurationMs: row.clipDurationMs,
        })),
        narrationFileName: tts.narration.value.fileName,
        bgm: bgm.selection.value,
        options: {
          transition: transitionMode.value,
          fillMode: fillMode.value,
          introText: introText.value,
          outroText: outroText.value,
        },
      });
      if (!isComposeResult(composed)) {
        throw new Error("混剪结果异常");
      }
      result.value = composed;
      // 写入成片槽位：下方预览、第五步字幕、导出沿原路消费
      finalVideo.setResult(composed.videoUrl);
      // 片头会把旁白整体后移，字幕生成时按这个偏移对齐
      finalVideo.setIntroOffset(composed.introDurationMs ?? 0);
      ElMessage.success("混剪成片已生成");
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : "混剪合成失败");
    } finally {
      isComposing.value = false;
    }
  }

  return {
    rows,
    materials,
    materialsScanned,
    isScanning,
    isGeneratingKeywords,
    isAssigning,
    isComposing,
    result,
    transitionMode,
    fillMode,
    introText,
    outroText,
    allAssigned,
    ensureRows,
    scanAndAssign,
    scanMaterials,
    generateKeywords,
    assignAll,
    assignAllLocal,
    nextClip,
    compose,
  };
}

export function useRemix() {
  if (!sharedState) {
    sharedState = useImpl();
  }
  return sharedState;
}
