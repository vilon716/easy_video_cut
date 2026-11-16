/**
 * 成片槽位（共享单例）
 *
 * 当前流程里「最新一版成片」的统一存放处：混剪步生成后写入，
 * 下方预览、第五步字幕（取视频源）、导出渲染都从这里读。
 * 原先这份状态挂在对口型运行时上，混剪改造后抽成独立模块。
 */
import { computed, ref } from "vue";

let sharedState: ReturnType<typeof useImpl> | null = null;

function useImpl() {
  const resultVideoUrl = ref("");
  const hasResult = computed(() => Boolean(resultVideoUrl.value));
  /** 片头时长（毫秒）：成片带片头时，字幕时间轴整体后移这么多 */
  const introOffsetMs = ref(0);

  function setResult(url: string): void {
    resultVideoUrl.value = url;
  }

  function setIntroOffset(ms: number): void {
    introOffsetMs.value = Math.max(0, Math.round(ms) || 0);
  }

  function clearResult(): void {
    resultVideoUrl.value = "";
    introOffsetMs.value = 0;
  }

  return {
    resultVideoUrl,
    hasResult,
    introOffsetMs,
    setResult,
    setIntroOffset,
    clearResult,
  };
}

export function useFinalVideo() {
  if (!sharedState) {
    sharedState = useImpl();
  }
  return sharedState;
}
