export interface CopyCreationPayload {
  rewriteRequirements: string
  sourceCopy: string
  /** 文案风格 ID（config/copy-styles；'default' = 默认洗稿） */
  styleId?: string
  /** AI 选题模式：一句话选题（给出时忽略 sourceCopy） */
  topic?: string
}

export interface CopyCreationResult {
  text: string
}
