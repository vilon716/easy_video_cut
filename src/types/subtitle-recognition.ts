export type SubtitleRecognitionProviderKey = "sourcecode";

export interface SubtitleRecognitionConfigStore {
  activeProvider: SubtitleRecognitionProviderKey;
  sourcecode: {
    apiKey: string;
  };
}

export interface SubtitleSegment {
  end: number;
  id: string;
  start: number;
  text: string;
  /** 双语模板的英文小字（生成字幕时自动翻译填充，可为空） */
  subText?: string;
}

export interface SubtitleRecognitionResult {
  executionTimeMs: number;
  requestId: string;
  srt: string;
  status: string;
  subtitles: SubtitleSegment[];
  text: string;
}
