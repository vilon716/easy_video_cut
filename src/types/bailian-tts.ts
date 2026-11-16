/** 百炼 TTS 逐句合成：主进程返回形状（与 electron/services/bailian-tts 对应） */
export interface BailianTtsSentenceResult {
  index: number
  text: string
  fileName: string
  audioUrl: string
  durationMs: number
}

export interface BailianNarrationResult {
  fileName: string
  audioUrl: string
  durationMs: number
}
