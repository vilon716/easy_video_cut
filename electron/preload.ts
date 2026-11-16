import { contextBridge, ipcRenderer } from "electron";

const desktopApi = {
  getAppVersion: (): Promise<string> => ipcRenderer.invoke("app:get-version"),
  // ===== 模力方舟中央账户（配置中心） =====
  moarkGetStatus: (): Promise<unknown> =>
    ipcRenderer.invoke("moark:get-status"),
  moarkGetQuota: (): Promise<unknown> => ipcRenderer.invoke("moark:get-quota"),
  moarkAuthorize: (): Promise<unknown> => ipcRenderer.invoke("moark:authorize"),
  moarkLogout: (): Promise<boolean> => ipcRenderer.invoke("moark:logout"),
  extractDouyinCopy: (douyinUrl: string): Promise<unknown> =>
    ipcRenderer.invoke("douyin:extract-copy", douyinUrl),
  cancelDouyinExtraction: (): Promise<boolean> =>
    ipcRenderer.invoke("douyin:cancel-extraction"),
  createRewriteCopy: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke("copy:create", payload),
  cancelCopyCreation: (): Promise<boolean> => ipcRenderer.invoke("copy:cancel"),
  // ===== 百炼 TTS 逐句合成 =====
  synthesizeBailianTtsAll: (payload: {
    sentences: string[];
  }): Promise<unknown> =>
    ipcRenderer.invoke("bailian-tts:synthesize-all", payload),
  synthesizeBailianTtsOne: (payload: {
    text: string;
    voice?: string;
  }): Promise<unknown> =>
    ipcRenderer.invoke("bailian-tts:synthesize-one", payload),
  importBailianUserAudio: (payload: {
    sourcePath: string;
  }): Promise<unknown> =>
    ipcRenderer.invoke("bailian-tts:import-file", payload),
  saveBailianRecording: (payload: {
    dataBase64: string;
  }): Promise<unknown> =>
    ipcRenderer.invoke("bailian-tts:save-recording", payload),
  concatBailianNarration: (payload: {
    fileNames: string[];
  }): Promise<unknown> => ipcRenderer.invoke("bailian-tts:concat", payload),
  // ===== 双语字幕翻译 =====
  translateSubtitles: (payload: {
    sentences: string[];
  }): Promise<unknown> => ipcRenderer.invoke("subtitle:translate", payload),
  // ===== 重点花字 / 封面标题（百炼文本模型） =====
  pickEmphasis: (payload: {
    sentences: string[];
  }): Promise<unknown> => ipcRenderer.invoke("subtitle:pick-emphasis", payload),
  suggestCoverTitles: (payload: {
    copyText: string;
    avoid?: string[];
  }): Promise<unknown> => ipcRenderer.invoke("cover:suggest-titles", payload),
  // ===== 素材混剪 =====
  generateRemixKeywords: (payload: {
    sentences: string[];
  }): Promise<unknown> =>
    ipcRenderer.invoke("remix:generate-keywords", payload),
  scanRemixMaterials: (): Promise<unknown> =>
    ipcRenderer.invoke("remix:scan-materials"),
  fetchRemixPexelsClip: (payload: {
    query: string;
    excludeIds: number[];
  }): Promise<unknown> => ipcRenderer.invoke("remix:pexels-fetch", payload),
  composeRemix: (payload: {
    segments: unknown[];
    narrationFileName: string;
    bgm?: { filePath: string; volume: number } | null;
    options?: {
      transition?: string;
      fillMode?: string;
      introText?: string;
      outroText?: string;
    };
  }): Promise<unknown> => ipcRenderer.invoke("remix:compose", payload),
  // ===== BGM =====
  searchBgmTracks: (payload: { query: string }): Promise<unknown> =>
    ipcRenderer.invoke("bgm:search", payload),
  downloadBgmTrack: (payload: {
    id: string;
    downloadUrl: string;
  }): Promise<unknown> => ipcRenderer.invoke("bgm:download", payload),
  selectAudioFile: (): Promise<string | null> =>
    ipcRenderer.invoke("dialog:select-audio-file"),
  pickRandomLocalBgm: (): Promise<unknown> =>
    ipcRenderer.invoke("bgm:random-local"),
  // ===== 应用配置（百炼 + 素材） =====
  loadAppConfig: (): Promise<unknown> => ipcRenderer.invoke("app-config:load"),
  saveAppConfig: (config: unknown): Promise<void> =>
    ipcRenderer.invoke("app-config:save", config),
  selectFolder: (): Promise<string | null> =>
    ipcRenderer.invoke("dialog:select-folder"),
  // ===== 画中画历史素材 =====
  listPipHistory: (): Promise<unknown> =>
    ipcRenderer.invoke("pip-history:list"),
  savePipHistory: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke("pip-history:save", payload),
  deletePipHistory: (id: string): Promise<unknown> =>
    ipcRenderer.invoke("pip-history:delete", id),
  // ===== 封面图片保存 =====
  saveImageFile: (dataUrl: string, defaultName: string): Promise<unknown> =>
    ipcRenderer.invoke("dialog:save-image", dataUrl, defaultName),
  // ===== 渲染导出（视频 + 封面统一输出到子目录） =====
  exportAll: (options: unknown): Promise<unknown> =>
    ipcRenderer.invoke("video-render:export-all", options),
  selectVideoRenderOutput: (): Promise<string | null> =>
    ipcRenderer.invoke("video-render:select-output"),
  renderVideo: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke("video-render:render", payload),
  captureVideoFrame: (
    videoUrl: string,
    timePercent: number,
  ): Promise<unknown> =>
    ipcRenderer.invoke("video-render:capture-frame", videoUrl, timePercent),
  captureVideoFilmstrip: (videoUrl: string, count: number): Promise<unknown> =>
    ipcRenderer.invoke("video-render:capture-filmstrip", videoUrl, count),
  onVideoRenderProgress: (
    callback: (progress: number) => void,
  ): (() => void) => {
    const handler = (_event: unknown, progress: number) => callback(progress);
    ipcRenderer.on("video-render:progress", handler);
    return () => {
      ipcRenderer.removeListener("video-render:progress", handler);
    };
  },
  showVideoInFolder: (filePath: string): Promise<void> =>
    ipcRenderer.invoke("video-render:show-in-folder", filePath),
};

contextBridge.exposeInMainWorld("desktopApi", desktopApi);

export type DesktopApi = typeof desktopApi;
