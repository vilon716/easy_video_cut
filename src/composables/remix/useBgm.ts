import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import { useAppConfig } from "@/composables/useAppConfig";
import type { BgmDownloadResult, BgmTrack } from "@/types/remix";

/**
 * 背景音乐（BGM）：
 * - 本地文件：用户选一首自己的音乐（MP3/WAV 等）；
 * - 在线匹配：用 Coverr 音乐库按风格词搜索、试听、选用（与视频素材共用 Key）；
 * - 音量：0–50%，混剪合成时铺在旁白下面（循环 + 结尾淡出）。
 * selection 是给 useRemix.compose 消费的最终输入。
 */

export type BgmMode = "none" | "local" | "online";

/**
 * 抖音常用 BGM 风格预设（中文名 + Coverr 搜索词）。
 * 真热门歌曲有版权、无开放接口可抓，这里用同风格的免版税曲子代替，
 * 点一下就在该风格里随机选一首并下载就绪。
 */
export const BGM_STYLE_PRESETS = [
  { label: "钢琴轻缓", query: "calm piano" },
  { label: "励志燃向", query: "epic inspiring" },
  { label: "卡点电音", query: "electronic beat" },
  { label: "Lo-fi 放松", query: "lofi chill" },
  { label: "国风", query: "chinese traditional instrumental" },
  { label: "轻快日常", query: "happy acoustic" },
  { label: "悬疑紧张", query: "dark suspense" },
  { label: "Phonk", query: "phonk" },
] as const;

export interface BgmComposeSelection {
  filePath: string;
  volume: number;
}

/** 去掉 IPC 报错的固定前缀，只留真正的失败原因给用户看 */
function cleanError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return error.message.replace(
    /^Error invoking remote method '[^']+': Error: /,
    "",
  );
}

function isTrackList(value: unknown): value is BgmTrack[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as BgmTrack).id === "string" &&
        typeof (item as BgmTrack).downloadUrl === "string",
    )
  );
}

function isDownloadResult(value: unknown): value is BgmDownloadResult {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as BgmDownloadResult).filePath === "string"
  );
}

function createBgm() {
  const appConfig = useAppConfig();

  const mode = ref<BgmMode>("none");
  /** BGM 音量（百分比，0–50） */
  const volumePercent = ref(15);

  // 本地文件
  const localPath = ref("");
  const localName = ref("");

  // 在线匹配
  const onlineQuery = ref("");
  const tracks = ref<BgmTrack[]>([]);
  const isSearching = ref(false);
  const selectedTrackId = ref("");
  const downloadedPath = ref("");
  const isDownloading = ref(false);

  async function pickLocalFile(): Promise<void> {
    const picked = await window.desktopApi.selectAudioFile();
    if (picked) {
      localPath.value = picked;
      localName.value = picked.split(/[\\/]/).pop() ?? picked;
    }
  }

  /** 已保存的 BGM 文件夹（存在配置里，重启不丢） */
  const localFolder = computed(() => appConfig.config.value.bgmDir);
  const isPickingRandomLocal = ref(false);

  async function pickLocalFolder(): Promise<void> {
    const picked = await window.desktopApi.selectFolder();
    if (picked) {
      await appConfig.saveConfig({
        ...appConfig.config.value,
        bgmDir: picked,
      });
      ElMessage.success("BGM 文件夹已保存，点「随机选一首」抽一首");
    }
  }

  /** 从 BGM 文件夹里随机抽一首，填到与手动选文件同一个已选位置 */
  async function randomLocal(): Promise<void> {
    if (!appConfig.config.value.bgmDir) {
      ElMessage.warning("请先选择 BGM 文件夹");
      return;
    }
    isPickingRandomLocal.value = true;
    try {
      const result = await window.desktopApi.pickRandomLocalBgm();
      if (!isDownloadResult(result)) {
        throw new Error("随机选取结果异常");
      }
      localPath.value = result.filePath;
      localName.value = result.fileName;
      ElMessage.success(`随机选中《${result.fileName}》`);
    } catch (error) {
      ElMessage.error(cleanError(error, "随机选取失败"));
    } finally {
      isPickingRandomLocal.value = false;
    }
  }

  async function searchOnline(): Promise<void> {
    if (!appConfig.hasCoverrKey.value) {
      ElMessage.warning("请先在配置中心填写 Coverr API Key");
      return;
    }
    const query = onlineQuery.value.trim();
    if (!query) {
      ElMessage.warning("先输入想找的音乐风格，如 piano、upbeat、cinematic");
      return;
    }
    isSearching.value = true;
    try {
      const result = await window.desktopApi.searchBgmTracks({ query });
      if (!isTrackList(result)) {
        throw new Error("音乐搜索结果异常");
      }
      tracks.value = result;
      ElMessage.success(`找到 ${result.length} 首，试听后点「选用」`);
    } catch (error) {
      ElMessage.error(cleanError(error, "音乐搜索失败"));
    } finally {
      isSearching.value = false;
    }
  }

  async function selectTrack(track: BgmTrack): Promise<void> {
    if (isDownloading.value) return;
    isDownloading.value = true;
    try {
      const result = await window.desktopApi.downloadBgmTrack({
        id: track.id,
        downloadUrl: track.downloadUrl,
      });
      if (!isDownloadResult(result)) {
        throw new Error("BGM 下载结果异常");
      }
      downloadedPath.value = result.filePath;
      selectedTrackId.value = track.id;
      ElMessage.success(`已选用《${track.title}》`);
    } catch (error) {
      ElMessage.error(cleanError(error, "BGM 下载失败"));
    } finally {
      isDownloading.value = false;
    }
  }

  /**
   * 随机选一首：不给风格就随机挑一个预设风格，再在搜索结果里
   * 随机挑一首、自动下载并设为已选用。
   */
  async function randomPick(styleQuery?: string): Promise<void> {
    if (!appConfig.hasCoverrKey.value) {
      ElMessage.warning("请先在配置中心填写 Coverr API Key");
      return;
    }
    if (isSearching.value || isDownloading.value) return;
    const preset =
      BGM_STYLE_PRESETS[
        Math.floor(Math.random() * BGM_STYLE_PRESETS.length)
      ];
    const query = styleQuery ?? preset.query;
    isSearching.value = true;
    try {
      const result = await window.desktopApi.searchBgmTracks({ query });
      if (!isTrackList(result) || !result.length) {
        throw new Error("没找到可用的音乐，换个风格再试");
      }
      tracks.value = result;
      onlineQuery.value = query;
      const pick = result[Math.floor(Math.random() * result.length)];
      await selectTrack(pick);
    } catch (error) {
      ElMessage.error(cleanError(error, "随机选歌失败"));
    } finally {
      isSearching.value = false;
    }
  }

  /** 给混剪合成用的最终选择；没选好就是 null（不加 BGM） */
  const selection = computed<BgmComposeSelection | null>(() => {
    const volume = Math.min(50, Math.max(0, volumePercent.value)) / 100;
    if (mode.value === "local" && localPath.value) {
      return { filePath: localPath.value, volume };
    }
    if (mode.value === "online" && downloadedPath.value) {
      return { filePath: downloadedPath.value, volume };
    }
    return null;
  });

  const selectedTrack = computed(
    () => tracks.value.find((track) => track.id === selectedTrackId.value) ?? null,
  );

  return {
    mode,
    volumePercent,
    localPath,
    localName,
    onlineQuery,
    tracks,
    isSearching,
    selectedTrackId,
    selectedTrack,
    downloadedPath,
    isDownloading,
    pickLocalFile,
    localFolder,
    pickLocalFolder,
    randomLocal,
    isPickingRandomLocal,
    searchOnline,
    selectTrack,
    randomPick,
    selection,
  };
}

type BgmStore = ReturnType<typeof createBgm>;
let store: BgmStore | null = null;

export function useBgm(): BgmStore {
  if (!store) {
    store = createBgm();
  }
  return store;
}
