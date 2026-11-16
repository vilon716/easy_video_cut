/**
 * 重点花字（共享单例）
 *
 * 导出时在画面中央弹大字强调的句子：AI 挑（走百炼）或手动加，
 * 每项记下当时的字幕起止时间，导出渲染时由主进程按 ASS 烧录。
 * 注意：字幕重新生成后时间轴可能变化，花字时间不会自动跟随，
 * 拿不准时删掉重新挑一次即可。
 */
import { ref } from "vue";
import { useSubtitleRecognition } from "@/composables/useSubtitleRecognition";

export interface EmphasisItem {
  id: string;
  /** 第几句（0 起） */
  segmentIndex: number;
  /** 花字短句（可编辑） */
  text: string;
  start: number;
  end: number;
}

let sharedState: ReturnType<typeof useImpl> | null = null;

function useImpl() {
  const items = ref<EmphasisItem[]>([]);
  const isPicking = ref(false);

  /** AI 挑重点句：替换当前花字列表，返回挑出的条数 */
  async function pickWithAi(): Promise<number> {
    const { subtitleList } = useSubtitleRecognition();
    const list = subtitleList.value;
    if (!list.length) {
      throw new Error("请先生成字幕");
    }
    isPicking.value = true;
    try {
      const result = await window.desktopApi.pickEmphasis({
        sentences: list.map((item) => item.text),
      });
      if (!Array.isArray(result)) {
        throw new Error("挑选结果异常");
      }
      const picked: EmphasisItem[] = [];
      for (const raw of result) {
        const entry = raw as { index?: unknown; text?: unknown };
        if (
          typeof entry.index === "number" &&
          typeof entry.text === "string" &&
          entry.text.trim() &&
          list[entry.index]
        ) {
          picked.push({
            id: `emph-${Date.now()}-${entry.index}`,
            segmentIndex: entry.index,
            text: entry.text.trim(),
            start: list[entry.index].start,
            end: list[entry.index].end,
          });
        }
      }
      items.value = picked;
      return picked.length;
    } finally {
      isPicking.value = false;
    }
  }

  /** 手动给某句加花字（默认文案取该句前 8 字，可再改） */
  function addManual(segmentIndex: number): void {
    const { subtitleList } = useSubtitleRecognition();
    const segment = subtitleList.value[segmentIndex];
    if (!segment) return;
    items.value = [
      ...items.value,
      {
        id: `emph-${Date.now()}-m${segmentIndex}`,
        segmentIndex,
        text: segment.text.trim().slice(0, 8),
        start: segment.start,
        end: segment.end,
      },
    ];
  }

  function removeItem(id: string): void {
    items.value = items.value.filter((item) => item.id !== id);
  }

  return { items, isPicking, pickWithAi, addManual, removeItem };
}

export function useEmphasis() {
  if (!sharedState) {
    sharedState = useImpl();
  }
  return sharedState;
}
