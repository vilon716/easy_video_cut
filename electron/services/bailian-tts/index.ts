/**
 * 百炼 TTS 逐句合成
 *
 * 接口：POST {bailianBaseUrl}/api/v1/services/audio/tts/SpeechSynthesizer（同步）
 *   body: { model, input: { text, voice, format: "mp3", sample_rate: 24000 } }
 *   返回 output.audio.url（或 base64 data），主进程下载后落盘。
 *
 * 落盘目录由 main.ts 传入（temp/free-super-agent/synthesized-audio），
 * 与既有 local-audio://synthesized/<file> 协议一一对应，渲染层可直接播放。
 * 时长用随包 ffmpeg 的 -i 输出解析（项目未打包 ffprobe）。
 *
 * 逐句合成的意义：每句时长即混剪步每段素材的长度、字幕步每句的时间轴，
 * 单句出错也只需重合成那一句。
 */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { resolveFfmpegPath } from "../_shared/ffmpeg-path";
import { logInfo } from "../_shared/logger";
import type { AppConfig } from "../app-config";

export interface BailianTtsSentenceResult {
  index: number;
  text: string;
  fileName: string;
  audioUrl: string;
  durationMs: number;
}

export interface BailianNarrationResult {
  fileName: string;
  audioUrl: string;
  durationMs: number;
}

interface SpeechSynthesizerResponse {
  output?: {
    audio?: { url?: string; data?: string };
    message?: string;
  };
  code?: string;
  message?: string;
}

/** 用 ffmpeg -i 解析媒体时长（无 ffprobe 时的通行做法） */
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

/** 合成一句并落盘，返回文件信息与时长（voiceOverride 供音色面板逐行试听） */
async function synthesizeSentenceAudio(
  config: AppConfig,
  text: string,
  outDir: string,
  voiceOverride?: string,
): Promise<{ fileName: string; audioUrl: string; durationMs: number }> {
  const apiKey = config.bailianApiKey.trim();
  if (!apiKey) {
    throw new Error("请先在配置中心填写百炼 API Key");
  }
  const baseUrl = config.bailianBaseUrl.replace(/\/+$/, "");
  const response = await fetch(
    `${baseUrl}/api/v1/services/audio/tts/SpeechSynthesizer`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.bailianTtsModel,
        input: {
          text,
          voice: voiceOverride?.trim() || config.bailianTtsVoice,
          format: "mp3",
          sample_rate: 24000,
        },
      }),
      signal: AbortSignal.timeout(120_000),
    },
  );

  let data: SpeechSynthesizerResponse | undefined;
  try {
    data = (await response.json()) as SpeechSynthesizerResponse;
  } catch {
    data = undefined;
  }
  if (!response.ok) {
    throw new Error(
      `语音合成失败：HTTP ${response.status}${data?.message ? `，${data.message}` : ""}`,
    );
  }

  const audio = data?.output?.audio;
  let bytes: Buffer | undefined;
  if (audio?.url) {
    const download = await fetch(audio.url, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!download.ok) {
      throw new Error(`合成音频下载失败：HTTP ${download.status}`);
    }
    bytes = Buffer.from(await download.arrayBuffer());
  } else if (typeof audio?.data === "string" && audio.data.length > 100) {
    bytes = Buffer.from(audio.data, "base64");
  }
  if (!bytes || !bytes.length) {
    throw new Error(data?.output?.message || "语音合成未返回音频");
  }

  await mkdir(outDir, { recursive: true });
  const fileName = `${randomUUID()}.mp3`;
  const filePath = join(outDir, fileName);
  await writeFile(filePath, bytes);
  const durationMs = await probeDurationMs(filePath);
  return {
    fileName,
    audioUrl: `local-audio://synthesized/${fileName}`,
    durationMs,
  };
}

/** 逐句合成全部句子（顺序执行，失败即停并指出是哪一句） */
export async function synthesizeAllSentences(
  config: AppConfig,
  sentences: string[],
  outDir: string,
): Promise<BailianTtsSentenceResult[]> {
  const results: BailianTtsSentenceResult[] = [];
  for (let index = 0; index < sentences.length; index += 1) {
    const text = sentences[index].trim();
    if (!text) continue;
    try {
      const audio = await synthesizeSentenceAudio(config, text, outDir);
      results.push({ index, text, ...audio });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`第 ${index + 1} 句合成失败：${message}`);
    }
  }
  logInfo("bailian-tts", `逐句合成完成，共 ${results.length} 句`);
  return results;
}

/** 合成单句（单句重试用；voiceOverride 供音色面板逐行试听） */
export async function synthesizeOneSentence(
  config: AppConfig,
  text: string,
  outDir: string,
  voiceOverride?: string,
): Promise<{ fileName: string; audioUrl: string; durationMs: number }> {
  return synthesizeSentenceAudio(config, text.trim(), outDir, voiceOverride);
}

/**
 * 把用户自己的录音转成与 TTS 一致的 mp3（24kHz 单声道），落盘并测时长。
 * 参数对齐后，逐句旁白仍可走 concatNarrationAudio 的流拷贝拼接，
 * 混剪/字幕的时间轴逻辑完全不用改。
 */
async function normalizeUserAudio(
  sourcePath: string,
  outDir: string,
): Promise<{ fileName: string; audioUrl: string; durationMs: number }> {
  await mkdir(outDir, { recursive: true });
  const fileName = `${randomUUID()}.mp3`;
  const outputPath = join(outDir, fileName);
  await runFfmpeg([
    "-y",
    "-i",
    sourcePath,
    "-vn",
    "-ar",
    "24000",
    "-ac",
    "1",
    "-codec:a",
    "libmp3lame",
    "-b:a",
    "64k",
    outputPath,
  ]);
  const durationMs = await probeDurationMs(outputPath);
  if (!durationMs) {
    throw new Error("没能读出这段音频的时长，请换一个音频文件再试");
  }
  return {
    fileName,
    audioUrl: `local-audio://synthesized/${fileName}`,
    durationMs,
  };
}

/** 导入用户选好的录音文件（第三步「我的配音」逐句上传） */
export async function importUserAudioFile(
  sourcePath: string,
  outDir: string,
): Promise<{ fileName: string; audioUrl: string; durationMs: number }> {
  return normalizeUserAudio(sourcePath, outDir);
}

/** 保存软件内录音（渲染层 MediaRecorder 的 webm 数据）并转成统一 mp3 */
export async function saveRecordedAudio(
  dataBase64: string,
  outDir: string,
): Promise<{ fileName: string; audioUrl: string; durationMs: number }> {
  const bytes = Buffer.from(dataBase64, "base64");
  if (!bytes.length) {
    throw new Error("录音数据为空，请重新录制");
  }
  await mkdir(outDir, { recursive: true });
  const rawPath = join(outDir, `recording-${randomUUID()}.webm`);
  await writeFile(rawPath, bytes);
  return normalizeUserAudio(rawPath, outDir);
}

/** 把逐句音频按顺序拼成完整旁白（同参数 mp3 直接流拷贝拼接） */
export async function concatNarrationAudio(
  fileNames: string[],
  outDir: string,
): Promise<BailianNarrationResult> {
  if (!fileNames.length) {
    throw new Error("没有可拼接的句子音频");
  }
  await mkdir(outDir, { recursive: true });
  const listPath = join(outDir, `narration-list-${randomUUID()}.txt`);
  const listContent = fileNames
    .map((name) => `file '${join(outDir, basename(name)).replace(/'/g, "'\\''")}'`)
    .join("\n");
  await writeFile(listPath, listContent, "utf-8");

  const fileName = `narration-${randomUUID()}.mp3`;
  const outputPath = join(outDir, fileName);
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
    outputPath,
  ]);
  const durationMs = await probeDurationMs(outputPath);
  logInfo("bailian-tts", `旁白拼接完成，总时长 ${durationMs}ms`);
  return {
    fileName,
    audioUrl: `local-audio://synthesized/${fileName}`,
    durationMs,
  };
}
