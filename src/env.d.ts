declare global {
  interface Window {
    desktopApi: {
      getAppVersion: () => Promise<string>;

      // 模力方舟中央账户（配置中心）
      moarkGetStatus: () => Promise<unknown>;
      moarkGetQuota: () => Promise<unknown>;
      moarkAuthorize: () => Promise<unknown>;
      moarkLogout: () => Promise<boolean>;

      // 抖音文案提取
      extractDouyinCopy: (douyinUrl: string) => Promise<unknown>;
      cancelDouyinExtraction: () => Promise<boolean>;


      // 文案创作
      createRewriteCopy: (payload: unknown) => Promise<unknown>;
      cancelCopyCreation: () => Promise<boolean>;

      // 百炼 TTS 逐句合成
      synthesizeBailianTtsAll: (payload: {
        sentences: string[];
      }) => Promise<unknown>;
      synthesizeBailianTtsOne: (payload: { text: string }) => Promise<unknown>;
      concatBailianNarration: (payload: {
        fileNames: string[];
      }) => Promise<unknown>;

      // 双语字幕翻译
      translateSubtitles: (payload: {
        sentences: string[];
      }) => Promise<unknown>;

      // 重点花字 / 封面标题
      pickEmphasis: (payload: {
        sentences: string[];
      }) => Promise<unknown>;
      suggestCoverTitles: (payload: {
        copyText: string;
        avoid?: string[];
      }) => Promise<unknown>;

      // 素材混剪
      generateRemixKeywords: (payload: {
        sentences: string[];
      }) => Promise<unknown>;
      scanRemixMaterials: () => Promise<unknown>;
      fetchRemixPexelsClip: (payload: {
        query: string;
        excludeIds: number[];
      }) => Promise<unknown>;
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
      }) => Promise<unknown>;
      // BGM
      searchBgmTracks: (payload: { query: string }) => Promise<unknown>;
      downloadBgmTrack: (payload: {
        id: string;
        downloadUrl: string;
      }) => Promise<unknown>;
      selectAudioFile: () => Promise<string | null>;
      pickRandomLocalBgm: () => Promise<unknown>;

      // 应用配置（百炼 + 素材）
      loadAppConfig: () => Promise<unknown>;
      saveAppConfig: (config: unknown) => Promise<void>;
      selectFolder: () => Promise<string | null>;

      // 画中画（本地上传素材 + 历史）
      listPipHistory: () => Promise<unknown>;
      savePipHistory: (payload: unknown) => Promise<unknown>;
      deletePipHistory: (id: string) => Promise<unknown>;

      // 封面图片保存
      saveImageFile: (dataUrl: string, defaultName: string) => Promise<unknown>;

      // 视频渲染 + 导出
      exportAll: (options: unknown) => Promise<unknown>;
      selectVideoRenderOutput: () => Promise<string | null>;
      renderVideo: (payload: unknown) => Promise<unknown>;
      captureVideoFilmstrip: (
        videoUrl: string,
        count: number,
      ) => Promise<unknown>;
      captureVideoFrame: (
        videoUrl: string,
        timePercent: number,
      ) => Promise<unknown>;
      onVideoRenderProgress: (
        callback: (progress: number) => void,
      ) => () => void;
      showVideoInFolder: (filePath: string) => Promise<void>;
    };
  }
}

export {};
