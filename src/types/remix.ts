/** 素材混剪：主进程返回形状（与 electron/services/remix 对应） */
export interface SentenceKeywords {
  zh: string
  en: string
}

export interface MaterialClip {
  fileName: string
  filePath: string
  durationMs: number
}

export interface PexelsClipResult {
  pexelsId: number
  fileName: string
  filePath: string
  durationMs: number
  previewUrl: string
  /** 实际来源：Pexels 或 Pixabay（备用源自动切换） */
  provider: string
}

export interface RemixComposeSegment {
  filePath: string
  durationMs: number
  sourceDurationMs: number
}

export interface RemixComposeResult {
  fileName: string
  filePath: string
  videoUrl: string
  durationMs: number
  introDurationMs?: number
}

/** BGM 在线匹配（Coverr 音乐库）的一首曲子 */
export interface BgmTrack {
  id: string
  title: string
  durationSec: number
  previewUrl: string
  downloadUrl: string
}

export interface BgmDownloadResult {
  fileName: string
  filePath: string
}
