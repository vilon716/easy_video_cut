/**
 * 文案风格模式（第二步文案创作）
 *
 * 每个风格对应主进程 copy-creation-bailian.ts 里的一段提示块：
 * 选了风格，创作时就按那套结构与打法改写。ID 必须与服务层
 * COPY_STYLE_BLOCKS 的键一致（'default' 表示不加风格块）。
 */
export interface CopyStyleOption {
  id: string
  label: string
  hint: string
}

export const COPY_STYLES: CopyStyleOption[] = [
  { id: 'default', label: '默认洗稿', hint: '不套风格，按改写要求自由发挥' },
  { id: 'hook', label: '爆款开头', hint: '第一句破冰抓人，正文马上兑现，结尾给关注理由' },
  { id: 'tutorial', label: '干货教程', hint: '钩子 → 证据 → 承诺 → 条件 → 指令，只讲关键点' },
  { id: 'story', label: '故事记录', hint: '事件 → 行动 → 变化，用细节说话，不编情节' },
  { id: 'hotspot', label: '热点判断', hint: '结论先行，落到这件事跟观众有什么关系' },
  { id: 'selling', label: '带货转化', hint: '痛点 → 方案 → 证据 → 承接，不夸大不硬推' },
]

export const DEFAULT_COPY_STYLE_ID = 'default'

export function findCopyStyle(id: string): CopyStyleOption {
  return COPY_STYLES.find((style) => style.id === id) ?? COPY_STYLES[0]
}
