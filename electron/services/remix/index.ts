/**
 * 素材混剪服务（第四步的核心）
 *
 * 四件事：
 *   1. generateKeywords：百炼大模型为每句文案出中/英两个素材关键词
 *      （中文匹配本地素材文件名，英文去 Pexels 搜竖屏视频）。
 *   2. scanMaterials：扫描配置里的本地素材库文件夹，索引片段与时长。
 *   3. fetchPexelsClip：按英文关键词在线搜竖屏视频（Pexels 主、Pixabay
 *      备，失败自动切换），下载到缓存目录。
 *   4. composeRemix：逐句把素材裁成配音时长、统一 1080×1920/30fps，
 *      无声拼接后与完整旁白合流，产出成片。
 *
 * 成片以 local-video://local-file/<编码绝对路径> 返回——预览、字幕、
 * 导出渲染都已支持这种地址，无需新增协议。
 */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { app, net } from "electron";
import { existsSync } from "node:fs";
import { access, mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { resolveFfmpegPath } from "../_shared/ffmpeg-path";
import { logInfo } from "../_shared/logger";
import type { AppConfig } from "../app-config";

export interface SentenceKeywords {
  zh: string;
  en: string;
}

export interface MaterialClip {
  fileName: string;
  filePath: string;
  durationMs: number;
}

export interface PexelsClipResult {
  pexelsId: number;
  fileName: string;
  filePath: string;
  durationMs: number;
  previewUrl: string;
  /** 实际来源：Pexels 或 Pixabay */
  provider: string;
}

export interface RemixComposeSegment {
  filePath: string;
  durationMs: number;
  sourceDurationMs: number;
}

export interface RemixComposeResult {
  fileName: string;
  filePath: string;
  videoUrl: string;
  durationMs: number;
  /** 片头时长（毫秒）：字幕时间轴要整体后移这么多；无片头为 0 */
  introDurationMs: number;
}

export interface ComposeOptions {
  /** 转场：none 无 / fade 柔和叠化（经黑） / flash 闪白 */
  transition?: string;
  /** 素材填充：crop 裁剪铺满 / blur 虚化背景填充 */
  fillMode?: string;
  /** 片头标题（空 = 无片头） */
  introText?: string;
  /** 片尾文案（空 = 无片尾） */
  outroText?: string;
}

export const INTRO_DURATION_MS = 1600;
export const OUTRO_DURATION_MS = 2200;

export interface RemixDirs {
  cacheDir: string;
  resultDir: string;
  bgmCacheDir: string;
}

/** BGM 在线匹配（Coverr 音乐库）的一首曲子 */
export interface BgmTrack {
  id: string;
  title: string;
  durationSec: number;
  /** 可直接给 <audio> 试听的签名链接 */
  previewUrl: string;
  /** 下载链接（与试听同一条签名链接） */
  downloadUrl: string;
}

export interface BgmDownloadResult {
  fileName: string;
  filePath: string;
}

/** 混剪合成时的 BGM 输入：本地文件路径 + 音量（0–1） */
export interface ComposeBgm {
  filePath: string;
  volume: number;
}

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi"]);
const MAX_MATERIAL_FILES = 300;
const MAX_SCAN_DEPTH = 3;

export function toLocalFileUrl(filePath: string): string {
  return `local-video://local-file/${encodeURIComponent(filePath)}`;
}

/** 用 ffmpeg -i 解析媒体时长（项目未打包 ffprobe） */
function probeDurationMs(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn(resolveFfmpegPath(), ["-i", filePath], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("error", () => resolve(0));
    proc.on("close", () => {
      const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!match) {
        resolve(0);
        return;
      }
      const seconds =
        Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
      resolve(Math.round(seconds * 1000));
    });
  });
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(resolveFfmpegPath(), args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg 执行失败：${stderr.slice(-300)}`));
      }
    });
  });
}

// ── 1. 关键词 ────────────────────────────────────────────────────────────────

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: unknown;
      reasoning_content?: string;
    };
  }>;
  error?: { message?: string };
  message?: string;
}

/** 从 chat 响应里把正文文本抠出来（纯字符串/分段数组/推理字段都见过） */
function extractChatText(data: ChatCompletionResponse): string {
  const message = data.choices?.[0]?.message;
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === "object" &&
        part !== null &&
        "text" in part &&
        typeof (part as { text?: unknown }).text === "string"
          ? ((part as { text: string }).text as string)
          : "",
      )
      .join("");
  }
  if (typeof message?.reasoning_content === "string") {
    return message.reasoning_content;
  }
  return "";
}

/**
 * 从模型返回里抠出 JSON 数组：推理型模型常先写分析再给答案，
 * 从最后一个 "[" 开始逐个往前试解析，第一个能解析成数组的为准。
 */
function extractJsonArray(content: string): unknown[] | null {
  const end = content.lastIndexOf("]");
  if (end < 0) return null;
  for (
    let start = content.lastIndexOf("[", end);
    start >= 0;
    start = start > 0 ? content.lastIndexOf("[", start - 1) : -1
  ) {
    try {
      const value = JSON.parse(content.slice(start, end + 1)) as unknown;
      if (Array.isArray(value)) return value;
    } catch {
      // 继续往前找下一个候选起点
    }
  }
  return null;
}

export async function generateKeywords(
  config: AppConfig,
  sentences: string[],
): Promise<SentenceKeywords[]> {
  const apiKey = config.bailianApiKey.trim();
  if (!apiKey) {
    throw new Error("请先在配置中心填写百炼 API Key");
  }
  const baseUrl = config.bailianBaseUrl.replace(/\/+$/, "");
  const numbered = sentences.map((s, i) => `${i + 1}. ${s}`).join("\n");
  const prompt = `你是短视频混剪助手，负责给口播文案的每一句配画面。下面是文案的每一句，请逐句处理：
1. 先想这一句说的是什么事，在脑子里换成一个能拍出来的具体画面（scene，中文短句）；
2. 再给两个素材搜索关键词：
- zh：中文汉字 2-6 个字，就是 scene 里的核心物体或场景，用于匹配本地素材文件名；
- en：英文 1-3 个单词，与 zh 是同一个画面，用于在线搜视频素材。

铁律：
- 关键词必须是具体的物体或场景（显卡、钢琴、海边、办公室），绝对不要抽象词（需求、更新、迭代、花钱、关注），更不要冒出与句子无关的词。
- 句子是口头禅、求点赞、打招呼这类没有实际画面的，就给最贴近的场景：求点赞关注→手机点赞画面；聊花钱/价格→购物付款画面；打招呼寒暄→对镜说话画面。

示例：
句子「想自己部署就得买个显卡，那不得花钱吗」→ {"scene": "特写一块电脑显卡", "zh": "电脑显卡", "en": "graphics card"}
句子「觉得有用的话点个赞关注一下」→ {"scene": "手指点手机上的点赞按钮", "zh": "手机点赞", "en": "tapping like button"}
句子「夕阳下在海边散步」→ {"scene": "夕阳下在海边散步", "zh": "海边夕阳", "en": "beach sunset"}

只输出一个 JSON 数组，每项形如 {"scene": "...", "zh": "...", "en": "..."}，顺序与句子一致，不要输出任何其他文字。

文案：
${numbered}`;

  try {
    const response = await fetch(
      `${baseUrl}/compatible-mode/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.bailianTextModel,
          messages: [{ role: "user", content: prompt }],
          stream: false,
          max_tokens: 4096,
        }),
        signal: AbortSignal.timeout(120_000),
      },
    );
    if (!response.ok) {
      throw new Error(`关键词生成失败：HTTP ${response.status}`);
    }
    const data = (await response.json()) as ChatCompletionResponse;
    const content = extractChatText(data);
    logInfo("remix", `关键词原始返回（前 200 字）：${content.slice(0, 200)}`);
    const parsed = extractJsonArray(content) as Array<{
      zh?: unknown;
      en?: unknown;
    }> | null;
    if (!parsed) {
      throw new Error(
        `模型没按格式返回关键词，原文开头：${content.slice(0, 120) || "（空）"}`,
      );
    }
    const hasCjk = (value: string) => /[一-鿿]/.test(value);
    const keywords = sentences.map((_, i) => {
      let zh =
        typeof parsed[i]?.zh === "string" ? (parsed[i].zh as string).trim() : "";
      let en =
        typeof parsed[i]?.en === "string" ? (parsed[i].en as string).trim() : "";
      // 模型偶尔把中英写反或全写英文，这里纠偏：
      // zh 里没有汉字而 en 里有，说明写反了，对调
      if (!hasCjk(zh) && hasCjk(en)) {
        const swap = zh;
        zh = en;
        en = swap;
      }
      // zh 里是英文：挪给 en（Pexels 用），zh 留空（拿英文匹配中文文件名没意义）
      if (!hasCjk(zh) && zh && !en) {
        en = zh;
      }
      if (!hasCjk(zh)) {
        zh = "";
      }
      return { zh, en };
    });
    if (keywords.every((item) => !item.zh && !item.en)) {
      throw new Error(
        `模型返回的关键词全是空的，原文开头：${content.slice(0, 120) || "（空）"}`,
      );
    }
    return keywords;
  } catch (error) {
    // 不许静默吞掉：失败就把原因抛给界面，用户看得见、能截图定位
    logInfo(
      "remix",
      `关键词生成失败：${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  }
}

// ── 2. 本地素材库 ────────────────────────────────────────────────────────────

async function walkVideos(
  dir: string,
  depth: number,
  out: string[],
): Promise<void> {
  if (depth > MAX_SCAN_DEPTH || out.length >= MAX_MATERIAL_FILES) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= MAX_MATERIAL_FILES) break;
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkVideos(full, depth + 1, out);
    } else if (VIDEO_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
}

export async function scanMaterials(config: AppConfig): Promise<MaterialClip[]> {
  const root = config.materialsDir.trim();
  if (!root) {
    throw new Error("请先在配置中心选择本地素材库文件夹");
  }
  const files: string[] = [];
  await walkVideos(root, 0, files);
  const clips: MaterialClip[] = [];
  for (const filePath of files) {
    clips.push({
      fileName: basename(filePath),
      filePath,
      durationMs: await probeDurationMs(filePath),
    });
  }
  logInfo("remix", `素材库扫描完成：${clips.length} 个片段`);
  return clips;
}

// ── 3. Pexels 素材 ───────────────────────────────────────────────────────────

interface PexelsSearchResponse {
  videos?: Array<{
    id: number;
    duration?: number;
    video_files?: Array<{
      link?: string;
      width?: number;
      height?: number;
      file_type?: string;
    }>;
  }>;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function fetchFromPexels(
  config: AppConfig,
  query: string,
  excludeIds: number[],
  dirs: RemixDirs,
): Promise<PexelsClipResult> {
  const apiKey = config.pexelsApiKey.trim();
  const searchUrl =
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}` +
    `&orientation=portrait&per_page=8`;
  // 用 Electron 的 net.fetch（Chromium 网络栈，跟随系统代理，和浏览器
  // 一样能连通海外站点）；Node 自带 fetch 不走系统代理，国内直连会超时。
  const response = await net.fetch(searchUrl, {
    headers: { Authorization: apiKey },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Pexels 搜索失败：HTTP ${response.status}`);
  }
  const data = (await response.json()) as PexelsSearchResponse;
  const candidates = (data.videos ?? []).filter(
    (video) => !excludeIds.includes(video.id),
  );
  if (!candidates.length) {
    throw new Error(`Pexels 没有找到「${query}」的新素材`);
  }

  const video = candidates[0];
  const files = (video.video_files ?? []).filter(
    (file) => file.link && (file.file_type === "video/mp4" || file.link.endsWith(".mp4")),
  );
  if (!files.length) {
    throw new Error("Pexels 返回的素材没有可用的 mp4 文件");
  }
  // 优先竖屏、宽度 720~1440 的文件（够清晰又不至于太大）；否则取最大的 mp4
  const portrait = files.filter(
    (file) => (file.height ?? 0) > (file.width ?? 0),
  );
  const pool = portrait.length ? portrait : files;
  const sized = pool
    .filter((file) => (file.width ?? 0) >= 720 && (file.width ?? 0) <= 1440)
    .sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  const chosen =
    sized[0] ??
    [...pool].sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0))[0];

  await mkdir(dirs.cacheDir, { recursive: true });
  const fileName = `pexels-${video.id}.mp4`;
  const filePath = join(dirs.cacheDir, fileName);
  if (!(await fileExists(filePath))) {
    const download = await net.fetch(chosen.link as string, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!download.ok) {
      throw new Error(`Pexels 素材下载失败：HTTP ${download.status}`);
    }
    await writeFile(filePath, Buffer.from(await download.arrayBuffer()));
  }
  const durationMs =
    typeof video.duration === "number" && video.duration > 0
      ? Math.round(video.duration * 1000)
      : await probeDurationMs(filePath);
  return {
    pexelsId: video.id,
    fileName,
    filePath,
    durationMs,
    previewUrl: toLocalFileUrl(filePath),
    provider: "Pexels",
  };
}

interface PixabayVideoFile {
  url?: string;
  width?: number;
  height?: number;
  size?: number;
}

interface PixabaySearchResponse {
  hits?: Array<{
    id: number;
    duration?: number;
    videos?: Record<string, PixabayVideoFile>;
  }>;
}

/** Pixabay 备用源：搜索 → 竖屏优先、宽度接近 1080 的一档 → 下载缓存 */
async function fetchFromPixabay(
  config: AppConfig,
  query: string,
  excludeIds: number[],
  dirs: RemixDirs,
): Promise<PexelsClipResult> {
  const apiKey = config.pixabayApiKey.trim();
  const searchUrl =
    `https://pixabay.com/api/videos/?key=${encodeURIComponent(apiKey)}` +
    `&q=${encodeURIComponent(query)}&per_page=10&safesearch=true`;
  const response = await net.fetch(searchUrl, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`搜索失败：HTTP ${response.status}`);
  }
  const data = (await response.json()) as PixabaySearchResponse;
  const hits = (data.hits ?? []).filter((hit) => !excludeIds.includes(hit.id));
  if (!hits.length) {
    throw new Error(`没有找到「${query}」的新素材`);
  }
  await mkdir(dirs.cacheDir, { recursive: true });
  for (const hit of hits) {
    const tiers = ["large", "medium", "small", "tiny"]
      .map((key) => hit.videos?.[key])
      .filter((file): file is PixabayVideoFile => Boolean(file?.url));
    if (!tiers.length) continue;
    const portrait = tiers.filter(
      (file) => (file.height ?? 0) > (file.width ?? 0),
    );
    const pool = portrait.length ? portrait : tiers;
    const chosen = [...pool].sort(
      (a, b) =>
        Math.abs((a.width ?? 0) - 1080) - Math.abs((b.width ?? 0) - 1080),
    )[0];
    const fileName = `pixabay-${hit.id}.mp4`;
    const filePath = join(dirs.cacheDir, fileName);
    if (!(await fileExists(filePath))) {
      const download = await net.fetch(chosen.url as string, {
        signal: AbortSignal.timeout(120_000),
      });
      if (!download.ok) continue;
      await writeFile(filePath, Buffer.from(await download.arrayBuffer()));
    }
    const durationMs =
      typeof hit.duration === "number" && hit.duration > 0
        ? Math.round(hit.duration * 1000)
        : await probeDurationMs(filePath);
    return {
      pexelsId: hit.id,
      fileName,
      filePath,
      durationMs,
      previewUrl: toLocalFileUrl(filePath),
      provider: "Pixabay",
    };
  }
  throw new Error(`没有找到「${query}」的可下载素材`);
}

interface CoverrSearchResponse {
  hits?: Array<{
    id: string;
    duration?: number;
    is_vertical?: boolean;
    urls?: {
      mp4?: string;
      mp4_download?: string;
    };
  }>;
}

/** Coverr 的 id 是字符串，压成稳定数字以复用「排除已用」的记账方式 */
function hashCoverrId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** Coverr 备用源 2：搜索 → 竖屏优先 → 下载缓存（横屏素材混剪时会裁切） */
async function fetchFromCoverr(
  config: AppConfig,
  query: string,
  excludeIds: number[],
  dirs: RemixDirs,
): Promise<PexelsClipResult> {
  const apiKey = config.coverrApiKey.trim();
  const searchUrl =
    `https://api.coverr.co/videos?query=${encodeURIComponent(query)}` +
    `&urls=true&page_size=10`;
  const response = await net.fetch(searchUrl, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`搜索失败：HTTP ${response.status}`);
  }
  const data = (await response.json()) as CoverrSearchResponse;
  const hits = (data.hits ?? []).filter(
    (hit) => hit.id && !excludeIds.includes(hashCoverrId(hit.id)),
  );
  if (!hits.length) {
    throw new Error(`没有找到「${query}」的新素材`);
  }
  const ordered = [
    ...hits.filter((hit) => hit.is_vertical),
    ...hits.filter((hit) => !hit.is_vertical),
  ];
  await mkdir(dirs.cacheDir, { recursive: true });
  for (const hit of ordered) {
    const downloadLink = hit.urls?.mp4_download || "";
    const link = downloadLink || hit.urls?.mp4 || "";
    if (!link) continue;
    const fileName = `coverr-${hit.id}.mp4`;
    const filePath = join(dirs.cacheDir, fileName);
    if (!(await fileExists(filePath))) {
      const download = await net.fetch(link, {
        signal: AbortSignal.timeout(120_000),
      });
      if (!download.ok) continue;
      await writeFile(filePath, Buffer.from(await download.arrayBuffer()));
      // 用 mp4 直链下载时按官方建议回 ping 下载统计（失败不影响使用）；
      // 用 mp4_download 链接下载的官方会自动登记，无需 ping。
      if (!downloadLink) {
        void net
          .fetch(
            `https://api.coverr.co/videos/${encodeURIComponent(hit.id)}/stats/downloads`,
            {
              method: "PATCH",
              headers: { Authorization: `Bearer ${apiKey}` },
              signal: AbortSignal.timeout(10_000),
            },
          )
          .catch(() => undefined);
      }
    }
    const durationMs =
      typeof hit.duration === "number" && hit.duration > 0
        ? Math.round(hit.duration * 1000)
        : await probeDurationMs(filePath);
    return {
      pexelsId: hashCoverrId(hit.id),
      fileName,
      filePath,
      durationMs,
      previewUrl: toLocalFileUrl(filePath),
      provider: "Coverr",
    };
  }
  throw new Error(`没有找到「${query}」的可下载素材`);
}

/**
 * 在线素材入口（IPC 名称与返回形状不变）：Pexels → Pixabay → Coverr
 * 依次尝试，失败或无结果自动切换下一家；全失败时把各家原因一起
 * 抛出，界面能显示到底卡在哪。
 */
export async function fetchPexelsClip(
  config: AppConfig,
  query: string,
  excludeIds: number[],
  dirs: RemixDirs,
): Promise<PexelsClipResult> {
  const errors: string[] = [];
  if (config.pexelsApiKey.trim()) {
    try {
      return await fetchFromPexels(config, query, excludeIds, dirs);
    } catch (error) {
      errors.push(
        `Pexels：${error instanceof Error ? error.message : "请求失败"}`,
      );
    }
  }
  if (config.pixabayApiKey.trim()) {
    try {
      return await fetchFromPixabay(config, query, excludeIds, dirs);
    } catch (error) {
      errors.push(
        `Pixabay：${error instanceof Error ? error.message : "请求失败"}`,
      );
    }
  }
  if (config.coverrApiKey.trim()) {
    try {
      return await fetchFromCoverr(config, query, excludeIds, dirs);
    } catch (error) {
      errors.push(
        `Coverr：${error instanceof Error ? error.message : "请求失败"}`,
      );
    }
  }
  if (!errors.length) {
    throw new Error(
      "请先在配置中心填写在线素材 Key（Pexels / Pixabay / Coverr 任一）",
    );
  }
  throw new Error(errors.join("；"));
}

// ── 4. BGM（本地文件之外的在线匹配走 Coverr 音乐库，与视频共用一个 Key） ──────

interface CoverrAudioSearchResponse {
  hits?: Array<Record<string, unknown>>;
}

/**
 * 在线匹配 BGM：Coverr 音乐搜索。
 * 官方文档只给了视频的返回结构，音乐的 urls 字段名未公开——这里
 * 防御式取链接（优先 mp3 相关键、否则 urls 里的第一个 http 链接），
 * 一首可用链接都没有时把第一条原始返回拼进报错，方便照着截图修。
 */
/**
 * 从一条音频记录里挑出可播放/下载的链接：官方没公开音乐的字段结构，
 * 就在 hit 本体与 hit.urls 里按键名打分找（mp3 相关优先，图片链接排除）。
 */
function pickAudioLink(hit: Record<string, unknown>): string {
  const pools: Array<Record<string, unknown>> = [];
  if (hit.urls && typeof hit.urls === "object") {
    pools.push(hit.urls as Record<string, unknown>);
  }
  pools.push(hit);
  const keyScore = (key: string): number => {
    const k = key.toLowerCase();
    if (k.includes("mp3_download")) return 0;
    if (k.includes("mp3")) return 1;
    if (k.includes("download")) return 2;
    if (k.includes("audio")) return 3;
    if (k.includes("preview")) return 4;
    if (k.includes("url") || k.includes("file") || k.includes("stream")) {
      return 5;
    }
    return 9;
  };
  let best = "";
  let bestScore = 9;
  for (const pool of pools) {
    for (const [key, value] of Object.entries(pool)) {
      if (typeof value !== "string" || !value.startsWith("http")) continue;
      if (/\.(png|jpe?g|svg|webp)(\?|$)/i.test(value)) continue;
      const score = keyScore(key);
      if (score < bestScore) {
        best = value;
        bestScore = score;
      }
    }
  }
  return best;
}

interface BgmSearchOutcome {
  tracks: BgmTrack[];
  /** 第一条原始返回（或整个信封），给报错诊断用 */
  rawSample: string;
}

async function searchBgmOnce(
  apiKey: string,
  query: string,
): Promise<BgmSearchOutcome> {
  const url =
    `https://api.coverr.co/audios?query=${encodeURIComponent(query)}` +
    `&urls=true&page_size=8&sort=popular`;
  const response = await net.fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Coverr 音乐搜索失败：HTTP ${response.status}`);
  }
  const data = (await response.json()) as CoverrAudioSearchResponse;
  const hits = data.hits ?? [];
  const tracks: BgmTrack[] = [];
  for (const hit of hits) {
    const link = pickAudioLink(hit);
    const id = typeof hit.id === "string" ? hit.id : "";
    if (!id || !link) continue;
    const durationRaw = hit.duration;
    const durationSec =
      typeof durationRaw === "number"
        ? durationRaw
        : typeof durationRaw === "string"
          ? Number.parseFloat(durationRaw) || 0
          : 0;
    const titleRaw =
      typeof hit.title === "string"
        ? hit.title
        : typeof hit.name === "string"
          ? hit.name
          : "";
    tracks.push({
      id,
      title: titleRaw.trim() ? titleRaw.trim() : "未命名音乐",
      durationSec,
      previewUrl: link,
      downloadUrl: link,
    });
  }
  return {
    tracks,
    rawSample: JSON.stringify(hits[0] ?? data).slice(0, 400),
  };
}

/**
 * 在线匹配 BGM：按风格词搜 Coverr 音乐库；风格太偏门搜不到时，
 * 自动兜底到热门曲库（空关键词按热度列），保证随机/匹配有结果。
 */
export async function searchBgmTracks(
  config: AppConfig,
  query: string,
): Promise<BgmTrack[]> {
  const apiKey = config.coverrApiKey.trim();
  if (!apiKey) {
    throw new Error("请先在配置中心填写 Coverr API Key（BGM 在线匹配共用）");
  }
  const first = await searchBgmOnce(apiKey, query);
  if (first.tracks.length) {
    return first.tracks;
  }
  if (query.trim()) {
    const fallback = await searchBgmOnce(apiKey, "");
    if (fallback.tracks.length) {
      return fallback.tracks;
    }
    throw new Error(
      `没搜到可用的音乐，接口返回开头：${fallback.rawSample || first.rawSample}`,
    );
  }
  throw new Error(`没搜到可用的音乐，接口返回开头：${first.rawSample}`);
}

/** 把选中的 Coverr 曲子下载到本地缓存（下过的不重复下） */
export async function downloadBgmTrack(
  id: string,
  downloadUrl: string,
  dirs: RemixDirs,
): Promise<BgmDownloadResult> {
  const safeId = id.replace(/[^\w-]/g, "") || "track";
  const fileName = `bgm-${safeId}.mp3`;
  const filePath = join(dirs.bgmCacheDir, fileName);
  await mkdir(dirs.bgmCacheDir, { recursive: true });
  if (!(await fileExists(filePath))) {
    const response = await net.fetch(downloadUrl, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) {
      throw new Error(`BGM 下载失败：HTTP ${response.status}`);
    }
    await writeFile(filePath, Buffer.from(await response.arrayBuffer()));
  }
  return { fileName, filePath };
}

const AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".wav",
  ".m4a",
  ".aac",
  ".ogg",
  ".flac",
]);

async function walkAudioFiles(
  dir: string,
  depth: number,
  out: string[],
): Promise<void> {
  if (depth > 2 || out.length >= 200) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkAudioFiles(full, depth + 1, out);
    } else if (
      entry.isFile() &&
      AUDIO_EXTENSIONS.has(extname(entry.name).toLowerCase())
    ) {
      out.push(full);
    }
    if (out.length >= 200) return;
  }
}

/** 本地 BGM 随机选取：从配置里的 BGM 文件夹随机抽一首 */
export async function pickRandomLocalBgm(
  config: AppConfig,
): Promise<BgmDownloadResult> {
  const dir = config.bgmDir.trim();
  if (!dir) {
    throw new Error("请先选择 BGM 文件夹");
  }
  const files: string[] = [];
  await walkAudioFiles(dir, 0, files);
  if (!files.length) {
    throw new Error("这个文件夹里没找到音乐文件（MP3 / WAV / M4A 等）");
  }
  const picked = files[Math.floor(Math.random() * files.length)];
  return { fileName: basename(picked), filePath: picked };
}

// ── 5. 混剪合成 ──────────────────────────────────────────────────────────────

/** ffmpeg 滤镜参数里的路径转义（与 video-render 同一套） */
function escapeFilterPath(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "'\\''");
}

/** 内置字体目录（与 video-render 的 getFontFilePath 同一套查找顺序） */
function resolveFontsDir(): string {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, "fonts")]
    : [join(app.getAppPath(), "src/assets/fonts")];
  for (const dir of candidates) {
    if (existsSync(join(dir, "MSYHBD.TTC"))) return dir;
  }
  return candidates[0];
}

function escapeCardAssText(text: string): string {
  return text
    .replace(/\\/g, "/")
    .replace(/\{/g, "｛")
    .replace(/\}/g, "｝")
    .replace(/\r?\n/g, "\\N");
}

/** 片头/片尾卡的 ASS：深底、居中大字、淡入淡出（片头带轻微放大弹入） */
function buildCardAss(text: string, isIntro: boolean): string {
  const tags = isIntro
    ? "{\\fad(280,260)\\t(0,240,\\fscx112\\fscy112)\\t(240,420,\\fscx100\\fscy100)}"
    : "{\\fad(300,400)}";
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1080",
    "PlayResY: 1920",
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: C,Microsoft YaHei,118,&H00FFFFFF,&H00FFFFFF,&H00000000,&H7F000000,-1,0,0,0,100,100,2,0,1,8,3,5,60,60,0,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    `Dialogue: 0,0:00:00.00,0:00:0${isIntro ? "1.60" : "2.20"},C,,0,0,0,,${tags}${escapeCardAssText(text)}`,
  ].join("\n");
}

/** 生成一张片头/片尾卡片段（纯色底 + ASS 大字，无声，1080×1920/30fps） */
async function buildCardSegment(
  text: string,
  durationSec: number,
  isIntro: boolean,
  dirs: RemixDirs,
  runId: string,
  kind: string,
): Promise<string> {
  const assPath = join(dirs.resultDir, `card-${runId}-${kind}.ass`);
  await writeFile(assPath, buildCardAss(text, isIntro), "utf-8");
  const segmentPath = join(dirs.resultDir, `seg-${runId}-${kind}.mp4`);
  await runFfmpeg([
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=0x14181f:s=1080x1920:r=30:d=${durationSec.toFixed(2)}`,
    "-vf",
    `subtitles='${escapeFilterPath(assPath)}':fontsdir='${escapeFilterPath(resolveFontsDir())}'`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    segmentPath,
  ]);
  return segmentPath;
}

export async function composeRemix(
  segments: RemixComposeSegment[],
  narrationPath: string,
  dirs: RemixDirs,
  bgm?: ComposeBgm | null,
  options?: ComposeOptions,
): Promise<RemixComposeResult> {
  if (!segments.length) {
    throw new Error("没有可合成的句子段落");
  }
  await mkdir(dirs.resultDir, { recursive: true });
  const runId = randomUUID();
  const segmentPaths: string[] = [];

  const introText = options?.introText?.trim() ?? "";
  const outroText = options?.outroText?.trim() ?? "";
  const introMs = introText ? INTRO_DURATION_MS : 0;
  const transition = options?.transition ?? "none";
  const useBlurFill = options?.fillMode === "blur";

  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    const targetSec = Math.max(0.3, segment.durationMs / 1000);
    const sourceSec = segment.sourceDurationMs / 1000;
    const startSec =
      sourceSec > targetSec ? ((sourceSec - targetSec) / 2).toFixed(3) : "0";
    const segmentPath = join(dirs.resultDir, `seg-${runId}-${i}.mp4`);

    // 转场：每段首尾短淡化（经黑/闪白），总时长不变、与旁白字幕不错位
    // 注意：fade 按帧时间戳判断，滤镜链头加 setpts=PTS-STARTPTS 把时间戳归零，
    // 配合输入侧 -ss（见 commonArgs），淡入淡出才落在每段自己的首尾
    let fadeVf = "";
    if (transition === "fade" || transition === "flash") {
      const d = Math.min(0.2, targetSec / 3);
      const colorArg = transition === "flash" ? ":color=white" : "";
      const outStart = Math.max(0, targetSec - d).toFixed(3);
      fadeVf = `,fade=t=in:st=0:d=${d.toFixed(3)}${colorArg},fade=t=out:st=${outStart}:d=${d.toFixed(3)}${colorArg}`;
    }

    const commonArgs = [
      "-y",
      "-stream_loop",
      "-1",
      // -ss 必须放输入侧：放输出侧时掐帧发生在滤镜之后，fade 会按未掐的
      // 时间轴提前淡出、把整段压黑（实测踩过，本地长素材几乎全军覆没）
      "-ss",
      startSec,
      "-i",
      segment.filePath,
      "-t",
      targetSec.toFixed(3),
    ];
    const encodeArgs = [
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      segmentPath,
    ];
    if (useBlurFill) {
      // 虚化填充：背景放大裁满+强模糊压暗，前景按原比例完整显示居中
      const graph =
        "setpts=PTS-STARTPTS,split[fa][fb];" +
        "[fa]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=42,eq=brightness=-0.12[fbg];" +
        "[fb]scale=1080:1920:force_original_aspect_ratio=decrease[ffg];" +
        `[fbg][ffg]overlay=(W-w)/2:(H-h)/2${fadeVf},fps=30,setsar=1[vout]`;
      await runFfmpeg([
        ...commonArgs,
        "-filter_complex",
        graph,
        "-map",
        "[vout]",
        ...encodeArgs,
      ]);
    } else {
      await runFfmpeg([
        ...commonArgs,
        "-vf",
        `setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1${fadeVf}`,
        ...encodeArgs,
      ]);
    }
    segmentPaths.push(segmentPath);
  }

  // 片头/片尾卡（同样的编码参数，可直接进 concat）
  const orderedPaths = [...segmentPaths];
  if (introText) {
    orderedPaths.unshift(
      await buildCardSegment(
        introText,
        INTRO_DURATION_MS / 1000,
        true,
        dirs,
        runId,
        "intro",
      ),
    );
  }
  if (outroText) {
    orderedPaths.push(
      await buildCardSegment(
        outroText,
        OUTRO_DURATION_MS / 1000,
        false,
        dirs,
        runId,
        "outro",
      ),
    );
  }

  const listPath = join(dirs.resultDir, `concat-${runId}.txt`);
  await writeFile(
    listPath,
    orderedPaths
      .map((path) => `file '${path.replace(/'/g, "'\\''")}'`)
      .join("\n"),
    "utf-8",
  );
  const videoOnlyPath = join(dirs.resultDir, `video-${runId}.mp4`);
  await runFfmpeg([
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-c",
    "copy",
    videoOnlyPath,
  ]);

  const fileName = `remix-${runId}.mp4`;
  const outputPath = join(dirs.resultDir, fileName);
  // 全片总时长（含片头/片尾卡）：BGM 铺满到这个长度
  const segmentsSec = segments.reduce(
    (sum, segment) => sum + Math.max(0.3, segment.durationMs / 1000),
    0,
  );
  const totalSec =
    introMs / 1000 + segmentsSec + (outroText ? OUTRO_DURATION_MS / 1000 : 0);
  // 有片尾时不能 -shortest（会把片尾静音段切掉）
  const shortestArgs = outroText ? [] : ["-shortest"];
  if (bgm?.filePath) {
    // 有 BGM：循环铺满全片 → 压音量 → 结尾 2 秒淡出 → 与旁白混音
    // 有片头时旁白整体延后 introMs，BGM 从 0 开始铺
    const volume = Math.min(1, Math.max(0, bgm.volume));
    const fadeStart = Math.max(0, totalSec - 2).toFixed(2);
    const narrChain = introMs
      ? `[1:a]adelay=${introMs}|${introMs}[narr];`
      : "";
    const narrLabel = introMs ? "[narr]" : "[1:a]";
    await runFfmpeg([
      "-y",
      "-i",
      videoOnlyPath,
      "-i",
      narrationPath,
      "-stream_loop",
      "-1",
      "-i",
      bgm.filePath,
      "-filter_complex",
      `${narrChain}[2:a]atrim=0:${totalSec.toFixed(2)},volume=${volume.toFixed(3)},afade=t=out:st=${fadeStart}:d=2,asetpts=N/SR/TB[bgm];${narrLabel}[bgm]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`,
      "-map",
      "0:v:0",
      "-map",
      "[aout]",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      ...shortestArgs,
      outputPath,
    ]);
  } else if (introMs) {
    // 无 BGM 但有片头：旁白延后 introMs 与画面对齐
    await runFfmpeg([
      "-y",
      "-i",
      videoOnlyPath,
      "-i",
      narrationPath,
      "-filter_complex",
      `[1:a]adelay=${introMs}|${introMs}[aout]`,
      "-map",
      "0:v:0",
      "-map",
      "[aout]",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      ...shortestArgs,
      outputPath,
    ]);
  } else {
    await runFfmpeg([
      "-y",
      "-i",
      videoOnlyPath,
      "-i",
      narrationPath,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      ...shortestArgs,
      outputPath,
    ]);
  }

  const durationMs = await probeDurationMs(outputPath);
  logInfo("remix", `混剪合成完成：${fileName}，时长 ${durationMs}ms`);
  return {
    fileName,
    filePath: outputPath,
    videoUrl: toLocalFileUrl(outputPath),
    durationMs,
    introDurationMs: introMs,
  };
}
