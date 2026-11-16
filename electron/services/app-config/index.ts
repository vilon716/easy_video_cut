/**
 * 应用配置（百炼 + 素材）
 *
 * 与模力方舟账户相互独立的一份本地配置，存 userData/app-config.json：
 *   - 百炼：API Key、工作空间地址、文案模型、TTS 模型与音色
 *     （文案改写、逐句配音、混剪关键词都走它）
 *   - 素材：Pexels API Key（联网素材）、本地素材库文件夹（本地素材）
 *
 * 换供应商/换账号只改这里：Key 与地址都是配置项，不写死在代码里。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { BUNDLED_DEFAULTS } from "./bundled-defaults";

/** 用户复刻的专属音色（存在百炼账号下，本地只记 ID 与显示名） */
export interface ClonedVoice {
  id: string;
  name: string;
}

export interface AppConfig {
  /** 百炼 API Key（Leo 工作空间的密钥；以后换自己的账号只改这一项） */
  bailianApiKey: string;
  /** 百炼工作空间域名（不带路径），如 https://<ws>.cn-beijing.maas.aliyuncs.com */
  bailianBaseUrl: string;
  /** 文案模型 ID（工作空间内可用的文本模型） */
  bailianTextModel: string;
  /** TTS 模型 ID */
  bailianTtsModel: string;
  /** TTS 音色 */
  bailianTtsVoice: string;
  /** Pexels API Key（混剪联网素材；免费申请，可后补） */
  pexelsApiKey: string;
  /** Pixabay API Key（联网素材备用源；Pexels 失败/无结果时自动切换） */
  pixabayApiKey: string;
  /** Coverr API Key（联网素材备用源 2；前两个都不通时自动切换） */
  coverrApiKey: string;
  /** 本地 BGM 文件夹（本地音乐随机选取从这里抽；空 = 未设置） */
  bgmDir: string;
  /** 本地素材库文件夹绝对路径（混剪本地素材来源） */
  materialsDir: string;
  /** 复刻音色列表（音色选择面板的「我的音色」分组） */
  clonedVoices: ClonedVoice[];
}

/** Leo 的百炼 MaaS 工作空间域名（默认值，用户可在配置中心改） */
export const DEFAULT_BAILIAN_BASE_URL =
  "https://llm-ccyjbn76ya4x8n6g.cn-beijing.maas.aliyuncs.com";

export function getDefaultConfig(): AppConfig {
  const base: AppConfig = {
    bailianApiKey: "",
    bailianBaseUrl: DEFAULT_BAILIAN_BASE_URL,
    bailianTextModel: "kimi-k3.1-pro",
    bailianTtsModel: "qwen-audio-3.1-tts-flash",
    bailianTtsVoice: "longanhuan_v3.1",
    pexelsApiKey: "",
    pixabayApiKey: "",
    coverrApiKey: "",
    bgmDir: "",
    materialsDir: "",
    clonedVoices: [],
  };
  // 出厂预置（自己人体验版）：只覆盖非空字段，仓库空模板时不产生任何影响。
  // materialsDir / bgmDir 是本机路径，禁止预置（在 bundled 里写了也会被忽略）。
  for (const [key, value] of Object.entries(BUNDLED_DEFAULTS)) {
    if (key === "materialsDir" || key === "bgmDir") continue;
    if (typeof value === "string" && value.trim()) {
      (base as unknown as Record<string, unknown>)[key] = value;
    } else if (Array.isArray(value) && value.length) {
      (base as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return base;
}

function trimString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalize(config: Partial<AppConfig>): AppConfig {
  const defaults = getDefaultConfig();
  return {
    bailianApiKey: trimString(config.bailianApiKey),
    bailianBaseUrl:
      trimString(config.bailianBaseUrl).replace(/\/+$/, "") ||
      defaults.bailianBaseUrl,
    bailianTextModel:
      trimString(config.bailianTextModel) || defaults.bailianTextModel,
    bailianTtsModel:
      trimString(config.bailianTtsModel) || defaults.bailianTtsModel,
    bailianTtsVoice:
      trimString(config.bailianTtsVoice) || defaults.bailianTtsVoice,
    pexelsApiKey: trimString(config.pexelsApiKey),
    pixabayApiKey: trimString(config.pixabayApiKey),
    coverrApiKey: trimString(config.coverrApiKey),
    bgmDir: trimString(config.bgmDir),
    materialsDir: trimString(config.materialsDir),
    clonedVoices: Array.isArray(config.clonedVoices)
      ? config.clonedVoices
          .filter(
            (voice): voice is ClonedVoice =>
              typeof voice === "object" &&
              voice !== null &&
              typeof (voice as ClonedVoice).id === "string" &&
              typeof (voice as ClonedVoice).name === "string",
          )
          .map((voice) => ({ id: voice.id.trim(), name: voice.name.trim() }))
          .filter((voice) => voice.id && voice.name)
      : [],
  };
}

export async function readConfig(storePath: string): Promise<AppConfig> {
  try {
    return normalize(
      JSON.parse(await readFile(storePath, "utf-8")) as Partial<AppConfig>,
    );
  } catch {
    return getDefaultConfig();
  }
}

export async function writeConfig(
  storePath: string,
  config: AppConfig,
): Promise<void> {
  await mkdir(dirname(storePath), { recursive: true });
  await writeFile(storePath, JSON.stringify(normalize(config), null, 2), "utf-8");
}
