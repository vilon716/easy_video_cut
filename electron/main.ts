import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  session,
  shell,
  systemPreferences,
} from "electron";
import { basename, extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveFfmpegPath } from "./services/_shared/ffmpeg-path";
import { extractDouyinVideo } from "./services/douyin";
import {
  deletePipHistoryEntry,
  listPipHistory,
  resolvePipHistoryFilePath,
  savePipHistoryEntry,
  type SavePipHistoryPayload as MainSavePipHistoryPayload,
} from "./services/picture-in-picture-history";
import {
  captureVideoFilmstrip,
  captureVideoFrame,
  renderVideo,
  resolveVideoLocalPath,
  type VideoRenderPayload,
} from "./services/video-render";
import {
  readMoarkAccount,
  writeMoarkAccount,
  getDefaultMoarkAccount,
  toRuntimeConfig as moarkToRuntimeConfig,
  openMoarkLoginWindow,
  fetchMoarkUserInfo,
  fetchMoarkAccessToken,
  isMaskedMoarkToken,
  clearMoarkLoginSession,
  fetchMoarkCallQuota,
  type MoarkAccountStore,
} from "./services/moark-account";

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const moarkAccountConfigFileName = "moark-account-config.json";
const copyCreationControllers = new Map<number, AbortController>();
const douyinExtractionControllers = new Map<number, AbortController>();

protocol.registerSchemesAsPrivileged([
  {
    scheme: "local-video",
    privileges: {
      bypassCSP: true,
      secure: true,
      standard: true,
      stream: true,
      supportFetchAPI: true,
    },
  },
  {
    scheme: "local-audio",
    privileges: {
      bypassCSP: true,
      secure: true,
      standard: true,
      stream: true,
      supportFetchAPI: true,
    },
  },
  {
    scheme: "local-pip",
    privileges: {
      bypassCSP: true,
      secure: true,
      standard: true,
      stream: true,
      supportFetchAPI: true,
    },
  },
]);

function getDouyinVideoTempDir(): string {
  return join(app.getPath("temp"), "free-super-agent", "douyin-videos");
}

function getMoarkAccountPath(): string {
  return join(app.getPath("userData"), moarkAccountConfigFileName);
}

async function loadMoarkAccount(): Promise<MoarkAccountStore> {
  return readMoarkAccount(getMoarkAccountPath());
}

async function saveMoarkAccount(store: MoarkAccountStore): Promise<void> {
  await writeMoarkAccount(getMoarkAccountPath(), store);
}

// ===== 独享算力对口型配置 =====
import {
  createCopyBailian,
  pickEmphasisSentences,
  suggestCoverTitles,
  translateSentences,
  type BailianCopyCreationPayload as CopyCreationPayload,
} from "./services/copy-creation-bailian";
import {
  concatNarrationAudio,
  createClonedVoice,
  importFullNarration,
  importUserAudioFile,
  saveRecordedAudio,
  synthesizeAllSentences,
  synthesizeOneSentence,
} from "./services/bailian-tts";
import {
  composeRemix,
  downloadBgmTrack,
  fetchPexelsClip,
  generateKeywords,
  pickRandomLocalBgm,
  scanMaterials,
  searchBgmTracks,
  type ComposeBgm,
  type ComposeOptions,
  type RemixComposeSegment,
  type RemixDirs,
} from "./services/remix";

/** 混剪缓存（Pexels 下载）与成片目录 */
function getRemixDirs(): RemixDirs {
  const root = join(app.getPath("temp"), "free-super-agent");
  return {
    cacheDir: join(root, "remix-cache"),
    resultDir: join(root, "remix-result"),
    bgmCacheDir: join(root, "bgm-cache"),
  };
}

/** 合成音频目录：与 local-audio://synthesized/<file> 协议对应 */
function getSynthesizedAudioDir(): string {
  return join(app.getPath("temp"), "free-super-agent", "synthesized-audio");
}
import {
  readConfig as readAppConfigFile,
  writeConfig as writeAppConfigFile,
  type AppConfig,
} from "./services/app-config";

// ===== 应用配置（百炼 + 素材） =====
function getAppConfigPath(): string {
  return join(app.getPath("userData"), "app-config.json");
}

async function loadAppConfig(): Promise<AppConfig> {
  return readAppConfigFile(getAppConfigPath());
}

async function saveAppConfig(config: AppConfig): Promise<void> {
  await writeAppConfigFile(getAppConfigPath(), config);
}

/**
 * 读取中央账户并确保已授权（有 apiKey）。四步共用。
 */
async function requireMoarkAccount(): Promise<MoarkAccountStore> {
  const account = await loadMoarkAccount();
  if (!account.apiKey.trim()) {
    throw new Error("请先在右上角【配置中心】完成模力方舟授权登录");
  }
  // 旧版本保存的是列表接口返回的打码令牌（含 *），调用模型会 401。
  // 这里用 cookie 自动换成完整令牌并写回，用户无需重新登录。
  if (isMaskedMoarkToken(account.apiKey)) {
    const namespacePath =
      account.account?.namespacePath ||
      (await fetchMoarkUserInfo(account.cookies))?.namespacePath ||
      "";
    if (!namespacePath) {
      throw new Error("模力方舟登录已失效，请在右上角【配置中心】重新授权登录");
    }
    const apiKey = await fetchMoarkAccessToken(account.cookies, namespacePath);
    const refreshed = { ...account, apiKey };
    await saveMoarkAccount(refreshed);
    return refreshed;
  }
  return account;
}

async function extractDouyinCopy(
  webContentsId: number,
  douyinUrl: string,
): Promise<unknown> {
  const existingController = douyinExtractionControllers.get(webContentsId);

  if (existingController) {
    existingController.abort();
  }

  const controller = new AbortController();
  douyinExtractionControllers.set(webContentsId, controller);

  try {
    const account = await requireMoarkAccount();

    // 抖音文案提取仅支持模力方舟
    return await extractDouyinVideo(
      douyinUrl,
      getDouyinVideoTempDir(),
      controller.signal,
      { apiKey: account.apiKey },
    );
  } finally {
    if (douyinExtractionControllers.get(webContentsId) === controller) {
      douyinExtractionControllers.delete(webContentsId);
    }
  }
}

async function createRewriteCopy(
  webContentsId: number,
  payload: CopyCreationPayload,
): Promise<unknown> {
  const existingController = copyCreationControllers.get(webContentsId);

  if (existingController) {
    existingController.abort();
  }

  const controller = new AbortController();
  copyCreationControllers.set(webContentsId, controller);

  try {
    const appConfig = await loadAppConfig();

    // 文案创作走百炼（配置中心的百炼 API Key），不再依赖模力方舟账户
    return await createCopyBailian(appConfig, payload, controller.signal);
  } finally {
    if (copyCreationControllers.get(webContentsId) === controller) {
      copyCreationControllers.delete(webContentsId);
    }
  }
}

function registerLocalVideoProtocol(): void {
  protocol.handle("local-video", (request) => {
    const requestUrl = new URL(request.url);

    if (requestUrl.hostname === "douyin-videos") {
      const fileName = basename(
        decodeURIComponent(requestUrl.pathname.replace(/^\/+/, "")),
      );

      if (!fileName.endsWith(".mp4")) {
        return new Response("Not found", { status: 404 });
      }

      return net.fetch(
        pathToFileURL(join(getDouyinVideoTempDir(), fileName)).href,
        { headers: request.headers },
      );
    }

    // 通用本地文件访问：local-video://local-file/<编码后的绝对路径>
    // 用于手动选择的本地视频在渲染端预览
    if (requestUrl.hostname === "local-file") {
      const filePath = decodeURIComponent(
        requestUrl.pathname.replace(/^\/+/, ""),
      );
      if (!filePath) {
        return new Response("Not found", { status: 404 });
      }
      return net.fetch(pathToFileURL(filePath).href, {
        headers: request.headers,
      });
    }


    return new Response("Not found", { status: 404 });
  });
}

function registerLocalAudioProtocol(): void {
  protocol.handle("local-audio", async (request) => {
    const requestUrl = new URL(request.url);

    const fileName = basename(
      decodeURIComponent(requestUrl.pathname.replace(/^\/+/, "")),
    );

    if (!fileName) {
      return new Response("Not found", { status: 404 });
    }

    let filePath = "";


    // 合成音频缓存：local-audio://synthesized/<fileName>
    if (requestUrl.hostname === "synthesized") {
      filePath = join(
        app.getPath("temp"),
        "free-super-agent",
        "synthesized-audio",
        fileName,
      );
    }

    if (!filePath) {
      return new Response("Not found", { status: 404 });
    }

    // 确定 Content-Type
    const ext = fileName.split(".").pop()?.toLowerCase() || "mp3";
    const mimeMap: Record<string, string> = {
      mp3: "audio/mpeg",
      wav: "audio/wav",
      m4a: "audio/mp4",
      ogg: "audio/ogg",
      flac: "audio/flac",
      aac: "audio/aac",
    };
    const contentType = mimeMap[ext] || "audio/mpeg";

    try {
      const { stat, open } = await import("node:fs/promises");
      const fileStat = await stat(filePath);
      const fileSize = fileStat.size;
      const rangeHeader = request.headers.get("range");

      if (rangeHeader) {
        // 支持 Range 请求（快进/seek）
        const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        const start = match ? parseInt(match[1], 10) : 0;
        const end = match && match[2] ? parseInt(match[2], 10) : fileSize - 1;
        const chunkSize = end - start + 1;

        const fileHandle = await open(filePath, "r");
        const buffer = Buffer.alloc(chunkSize);
        await fileHandle.read(buffer, 0, chunkSize, start);
        await fileHandle.close();

        return new Response(buffer, {
          status: 206,
          headers: {
            "Content-Type": contentType,
            "Content-Length": String(chunkSize),
            "Content-Range": `bytes ${start}-${end}/${fileSize}`,
            "Accept-Ranges": "bytes",
          },
        });
      }

      // 普通请求：返回完整文件
      const { readFile } = await import("node:fs/promises");
      const fileBuffer = await readFile(filePath);
      return new Response(fileBuffer, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(fileSize),
          "Accept-Ranges": "bytes",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

/**
 * 注册画中画历史素材的 local-pip:// 协议
 *
 * URL 形态：local-pip://images/<fileName> 或 local-pip://videos/<fileName>
 * 实际指向 userData/pip-history/(images|videos)/<fileName>
 */
function registerLocalPipProtocol(): void {
  protocol.handle("local-pip", (request) => {
    const requestUrl = new URL(request.url);
    const filePath = resolvePipHistoryFilePath(
      app.getPath("userData"),
      requestUrl.hostname,
      requestUrl.pathname,
    );

    if (!filePath) {
      return new Response("Not found", { status: 404 });
    }

    return net.fetch(pathToFileURL(filePath).href);
  });
}



function cancelDouyinExtraction(webContentsId: number): boolean {
  const controller = douyinExtractionControllers.get(webContentsId);

  if (!controller) {
    return false;
  }

  controller.abort();
  douyinExtractionControllers.delete(webContentsId);
  return true;
}

function cancelCopyCreation(webContentsId: number): boolean {
  const controller = copyCreationControllers.get(webContentsId);

  if (!controller) {
    return false;
  }

  controller.abort();
  copyCreationControllers.delete(webContentsId);
  return true;
}


function createMainWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "Free Super Agent",
    backgroundColor: "#f6f7fb",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(currentDir, "../preload/index.cjs"),
      sandbox: false,
    },
  });

  // 隐藏菜单栏（File、Edit、View、Window 等）
  Menu.setApplicationMenu(null);

  // 页面加载完成后最大化再显示，避免出现先小窗再放大的闪烁
  mainWindow.once("ready-to-show", () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
    return;
  }

  void mainWindow.loadFile(join(currentDir, "../renderer/index.html"));
}

app.whenReady().then(() => {
  app.setAppUserModelId("com.free-super-agent.desktop");
  // 第三步「我的配音」软件内录音要走 getUserMedia：放行本应用页面的 media
  // 权限请求（其余权限一律拒绝）。macOS 还需要在 Info.plist 里有麦克风
  // 用途说明（package.json 的 mac.extendInfo 已配），系统才会弹授权框。
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      callback(permission === "media");
    },
  );
  registerLocalVideoProtocol();
  registerLocalAudioProtocol();
  registerLocalPipProtocol();

  ipcMain.handle("app:get-version", () => app.getVersion());
  // ===== 模力方舟中央账户（配置中心） =====
  ipcMain.handle("moark:get-status", async () => {
    const account = await loadMoarkAccount();
    // 用 userinfo 校验 cookie，同时把最新账户信息写回本地：
    // 旧版本配置文件里没有 namespacePath，这里顺带补齐，避免额度接口取不到命名空间。
    const info = await fetchMoarkUserInfo(account.cookies);
    if (info && JSON.stringify(info) !== JSON.stringify(account.account)) {
      await saveMoarkAccount({ ...account, account: info });
    }
    return {
      loggedIn: info !== null,
      hasApiKey: Boolean(account.apiKey.trim()),
      account: info ?? account.account,
    };
  });
  ipcMain.handle("moark:authorize", async () => {
    const result = await openMoarkLoginWindow();
    if (!result.success) {
      return {
        success: false,
        loggedIn: false,
        hasApiKey: false,
        account: null,
      };
    }
    const info = await fetchMoarkUserInfo(result.cookies);
    if (!info) {
      // cookie 拿到了但校验不通过，没有命名空间也就无法取令牌
      await saveMoarkAccount({
        apiKey: "",
        cookies: result.cookies,
        account: null,
      });
      throw new Error("登录状态校验失败，请重新授权登录");
    }
    let apiKey = "";
    try {
      apiKey = await fetchMoarkAccessToken(result.cookies, info.namespacePath);
    } catch (error) {
      // 登录成功但取访问令牌失败：先保存 cookie 与账户，令牌置空，向前端透传错误
      await saveMoarkAccount({
        apiKey: "",
        cookies: result.cookies,
        account: info,
      });
      throw error;
    }
    await saveMoarkAccount({ apiKey, cookies: result.cookies, account: info });
    return { success: true, loggedIn: true, hasApiKey: true, account: info };
  });
  ipcMain.handle("moark:get-quota", async () => {
    const account = await loadMoarkAccount();
    let namespacePath = account.account?.namespacePath ?? "";
    if (!namespacePath) {
      // 本地还没有命名空间（旧配置），用 cookie 现拉一次并补写回去
      const info = await fetchMoarkUserInfo(account.cookies);
      if (!info) return null;
      namespacePath = info.namespacePath;
      await saveMoarkAccount({ ...account, account: info });
    }
    return fetchMoarkCallQuota(account.cookies, namespacePath);
  });
  ipcMain.handle("moark:logout", async () => {
    await saveMoarkAccount(getDefaultMoarkAccount());
    await clearMoarkLoginSession();
    return true;
  });
  ipcMain.handle("douyin:extract-copy", (event, douyinUrl: string) =>
    extractDouyinCopy(event.sender.id, douyinUrl),
  );
  ipcMain.handle("douyin:cancel-extraction", (event) =>
    cancelDouyinExtraction(event.sender.id),
  );
  ipcMain.handle(
    "audio:cache-synthesized",
    async (_event, arrayBuffer: ArrayBuffer, fileName: string) => {
      const { mkdir, writeFile } = await import("node:fs/promises");
      const { randomUUID } = await import("node:crypto");
      const synthesizedDir = join(
        app.getPath("temp"),
        "free-super-agent",
        "synthesized-audio",
      );
      await mkdir(synthesizedDir, { recursive: true });
      const ext = fileName.match(/\.[^.]+$/)?.[0] || ".mp3";
      const cachedName = `${randomUUID()}${ext}`;
      const filePath = join(synthesizedDir, cachedName);
      await writeFile(filePath, Buffer.from(arrayBuffer));
      return `local-audio://synthesized/${encodeURIComponent(cachedName)}`;
    },
  );
  // 通用音频文件读取（供上传音色样本使用）
  ipcMain.handle("copy:create", (event, payload: CopyCreationPayload) =>
    createRewriteCopy(event.sender.id, payload),
  );

  ipcMain.handle("copy:cancel", (event) => cancelCopyCreation(event.sender.id));

  // 双语字幕模板：中文逐句翻译成英文字幕（走百炼文本模型）
  ipcMain.handle(
    "subtitle:translate",
    async (_event, payload: { sentences: string[] }) => {
      const config = await loadAppConfig();
      return translateSentences(config, payload?.sentences ?? []);
    },
  );

  // 重点花字：AI 从字幕里挑要大字强调的句子（走百炼文本模型）
  ipcMain.handle(
    "subtitle:pick-emphasis",
    async (_event, payload: { sentences: string[] }) => {
      const config = await loadAppConfig();
      return pickEmphasisSentences(config, payload?.sentences ?? []);
    },
  );

  // 封面标题：AI 按文案提炼候选标题（avoid 为上一批，换一批不重复）
  ipcMain.handle(
    "cover:suggest-titles",
    async (_event, payload: { copyText: string; avoid?: string[] }) => {
      const config = await loadAppConfig();
      return suggestCoverTitles(
        config,
        payload?.copyText ?? "",
        payload?.avoid ?? [],
      );
    },
  );

  // ===== 语音克隆：模力方舟（登录/apiKey 统一走配置中心的中央账户） =====

  // ===== 视频对口型：独享算力 =====
  // ===== 视频对口型：HeyGen 网页版（半自动） =====
  // ===== 百炼 TTS 逐句合成 =====
  ipcMain.handle(
    "bailian-tts:synthesize-all",
    async (_event, payload: { sentences: string[] }) => {
      const config = await loadAppConfig();
      return synthesizeAllSentences(
        config,
        payload.sentences,
        getSynthesizedAudioDir(),
      );
    },
  );
  ipcMain.handle(
    "bailian-tts:synthesize-one",
    async (_event, payload: { text: string; voice?: string }) => {
      const config = await loadAppConfig();
      return synthesizeOneSentence(
        config,
        payload.text,
        getSynthesizedAudioDir(),
        payload.voice,
      );
    },
  );
  // ===== 我的配音：导入录音文件 / 保存软件内录音 =====
  ipcMain.handle(
    "bailian-tts:import-file",
    async (_event, payload: { sourcePath: string }) =>
      importUserAudioFile(payload.sourcePath, getSynthesizedAudioDir()),
  );
  ipcMain.handle(
    "bailian-tts:save-recording",
    async (_event, payload: { dataBase64: string }) =>
      saveRecordedAudio(payload.dataBase64, getSynthesizedAudioDir()),
  );
  ipcMain.handle(
    "bailian-tts:import-full",
    async (_event, payload: { sourcePath: string; sentences: string[] }) =>
      importFullNarration(
        payload.sourcePath,
        payload.sentences ?? [],
        getSynthesizedAudioDir(),
      ),
  );
  // ===== 声音复刻：用一段样本在百炼账号下创建专属音色 =====
  ipcMain.handle(
    "bailian-voice:create-clone",
    async (
      _event,
      payload: { prefix: string; sourcePath?: string; dataBase64?: string },
    ) => {
      const config = await loadAppConfig();
      return createClonedVoice(config, payload, getSynthesizedAudioDir());
    },
  );
  ipcMain.handle(
    "bailian-tts:concat",
    async (_event, payload: { fileNames: string[] }) =>
      concatNarrationAudio(payload.fileNames, getSynthesizedAudioDir()),
  );
  // ===== 素材混剪 =====
  ipcMain.handle(
    "remix:generate-keywords",
    async (_event, payload: { sentences: string[] }) => {
      const config = await loadAppConfig();
      return generateKeywords(config, payload.sentences);
    },
  );
  ipcMain.handle("remix:scan-materials", async () => {
    const config = await loadAppConfig();
    return scanMaterials(config);
  });
  ipcMain.handle(
    "remix:pexels-fetch",
    async (_event, payload: { query: string; excludeIds: number[] }) => {
      const config = await loadAppConfig();
      return fetchPexelsClip(
        config,
        payload.query,
        payload.excludeIds,
        getRemixDirs(),
      );
    },
  );
  ipcMain.handle(
    "remix:compose",
    async (
      _event,
      payload: {
        segments: RemixComposeSegment[];
        narrationFileName: string;
        bgm?: ComposeBgm | null;
        options?: ComposeOptions;
      },
    ) =>
      composeRemix(
        payload.segments,
        join(getSynthesizedAudioDir(), basename(payload.narrationFileName)),
        getRemixDirs(),
        payload.bgm ?? null,
        payload.options,
      ),
  );
  // ===== BGM（在线匹配 Coverr 音乐 + 本地文件） =====
  ipcMain.handle(
    "bgm:search",
    async (_event, payload: { query: string }) => {
      const config = await loadAppConfig();
      return searchBgmTracks(config, payload.query);
    },
  );
  ipcMain.handle(
    "bgm:download",
    async (_event, payload: { id: string; downloadUrl: string }) =>
      downloadBgmTrack(payload.id, payload.downloadUrl, getRemixDirs()),
  );
  ipcMain.handle("bgm:random-local", async () => {
    const config = await loadAppConfig();
    return pickRandomLocalBgm(config);
  });
  ipcMain.handle("dialog:select-audio-file", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [
        {
          name: "音频文件",
          extensions: ["mp3", "wav", "m4a", "aac", "ogg", "flac"],
        },
      ],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  // ===== 应用配置（百炼 + 素材） =====
  ipcMain.handle("app-config:load", () => loadAppConfig());
  ipcMain.handle("app-config:save", (_event, config: AppConfig) =>
    saveAppConfig(config),
  );

  // ===== 画中画历史素材 =====
  ipcMain.handle("pip-history:list", () =>
    listPipHistory(app.getPath("userData")),
  );
  ipcMain.handle(
    "pip-history:save",
    (_event, payload: MainSavePipHistoryPayload) =>
      savePipHistoryEntry(app.getPath("userData"), payload),
  );
  ipcMain.handle("pip-history:delete", (_event, id: string) =>
    deletePipHistoryEntry(app.getPath("userData"), id),
  );
  // ===== 视频渲染（字幕 + 画中画烧制） =====
  ipcMain.handle(
    "dialog:save-image",
    async (_event, dataUrl: string, defaultName: string) => {
      const result = await dialog.showSaveDialog({
        title: "保存封面图片",
        defaultPath: defaultName,
        filters: [{ name: "JPEG 图片", extensions: ["jpg", "jpeg"] }],
      });
      if (result.canceled || !result.filePath) {
        return { success: false };
      }
      const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
      const { writeFile } = await import("node:fs/promises");
      await writeFile(result.filePath, Buffer.from(base64, "base64"));
      return { success: true, filePath: result.filePath };
    },
  );
  /**
   * 选择输出目录，在里面新建子目录 渲染导出_<时间戳>，最多写入 3 个文件：
   *   1. 对口型原视频（sourceVideoUrl，始终导出）
   *   2. 成品视频（videoPayload，配置了字幕或画中画时才渲染导出）
   *   3. 封面图（coverBase64，填写了封面标题时才导出）
   */
  ipcMain.handle(
    "video-render:export-all",
    async (
      _event,
      options: {
        sourceVideoUrl?: string;
        videoPayload?: VideoRenderPayload;
        coverBase64?: string;
        coverFileName?: string;
      },
    ) => {
      const folderResult = await dialog.showOpenDialog({
        title: "选择导出目录",
        properties: ["openDirectory", "createDirectory"],
      });
      if (folderResult.canceled || !folderResult.filePaths.length) {
        return { success: false, canceled: true };
      }

      const {
        copyFile: copyFileFs,
        writeFile: wf,
        mkdir: mkdirFs,
      } = await import("node:fs/promises");
      const ts = Date.now();
      const subDir = join(folderResult.filePaths[0], `渲染导出_${ts}`);
      await mkdirFs(subDir, { recursive: true });

      const results: {
        sourceVideo?: string;
        video?: string;
        cover?: string;
      } = {};

      // 1. 对口型原视频：直接复制，不重编码（始终导出）
      if (options.sourceVideoUrl) {
        try {
          const localPath = await resolveVideoLocalPath(options.sourceVideoUrl);
          const ext = extname(localPath) || ".mp4";
          const sourcePath = join(subDir, `对口型原视频_${ts}${ext}`);
          await copyFileFs(localPath, sourcePath);
          results.sourceVideo = sourcePath;
        } catch (error) {
          return {
            success: false,
            error:
              error instanceof Error ? error.message : "导出对口型原视频失败",
          };
        }
      }

      // 2. 成品视频：烧制字幕 / 画中画
      if (options.videoPayload) {
        const videoPath = join(subDir, `成品视频_${ts}.mp4`);
        const videoResult = await renderVideo({
          ...options.videoPayload,
          outputPath: videoPath,
        });
        if (videoResult.success) {
          results.video = videoPath;
        } else {
          return { success: false, error: videoResult.error };
        }
      }

      // 3. 写入封面
      if (options.coverBase64 && options.coverFileName) {
        const coverPath = join(subDir, options.coverFileName);
        const base64 = options.coverBase64.replace(
          /^data:image\/\w+;base64,/,
          "",
        );
        await wf(coverPath, Buffer.from(base64, "base64"));
        results.cover = coverPath;
      }

      return { success: true, outputDir: subDir, ...results };
    },
  );
  ipcMain.handle("dialog:select-folder", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择素材库文件夹",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths.length) {
      return null;
    }
    return result.filePaths[0];
  });
  ipcMain.handle("video-render:select-output", async () => {
    const result = await dialog.showSaveDialog({
      title: "选择视频保存位置",
      defaultPath: `渲染视频_${Date.now()}.mp4`,
      filters: [{ name: "MP4 视频", extensions: ["mp4"] }],
    });
    if (result.canceled || !result.filePath) {
      return null;
    }
    return result.filePath;
  });
  ipcMain.handle("video-render:render", (_event, payload: VideoRenderPayload) =>
    renderVideo(payload),
  );
  ipcMain.handle(
    "video-render:capture-frame",
    (_event, videoUrl: string, timePercent: number) =>
      captureVideoFrame(videoUrl, timePercent),
  );
  ipcMain.handle(
    "video-render:capture-filmstrip",
    (_event, videoUrl: string, count: number) =>
      captureVideoFilmstrip(videoUrl, count),
  );
  ipcMain.handle("video-render:show-in-folder", (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
  });

  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
