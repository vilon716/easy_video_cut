import { ElMessage } from "element-plus";
import { computed, onUnmounted, ref } from "vue";
import { useWorkflowState } from "@/composables/useWorkflowState";
import { useMoarkAccount } from "@/composables/useMoarkAccount";
import { useAppConfig } from "@/composables/useAppConfig";
import type {
  CopyCreationPayload,
  CopyCreationResult,
} from "@/types/copy-creation";

function isCopyCreationResult(value: unknown): value is CopyCreationResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "text" in value &&
    typeof value.text === "string"
  );
}

let sharedCopyCreationState: ReturnType<typeof useCopyCreationImpl> | null =
  null;

function useCopyCreationImpl() {
  const { openConfigCenter } = useMoarkAccount();
  const appConfig = useAppConfig();
  const rewriteRequirements = ref("");
  /** 文案风格 ID（持久化到 localStorage，默认洗稿） */
  const COPY_STYLE_STORAGE_KEY = "free-super-agent.copy-style";
  const copyStyleId = ref(
    (() => {
      try {
        return window.localStorage.getItem(COPY_STYLE_STORAGE_KEY) || "default";
      } catch {
        return "default";
      }
    })(),
  );

  function setCopyStyleId(id: string): void {
    copyStyleId.value = id;
    try {
      window.localStorage.setItem(COPY_STYLE_STORAGE_KEY, id);
    } catch {
      // 存储不可用时仅保留内存状态
    }
  }
  const { createdCopyText: createdCopy } = useWorkflowState();
  const isCreatingCopy = ref(false);
  const isCopyCreationCancelled = ref(false);
  const creationElapsedMs = ref(0);
  let creationStartedAt = 0;
  let creationTimer: number | undefined;

  const creationElapsedText = computed(
    () => `${(creationElapsedMs.value / 1000).toFixed(2)}秒`,
  );

  function startCreationTimer(): void {
    creationStartedAt = Date.now();
    creationElapsedMs.value = 0;

    if (creationTimer) {
      window.clearInterval(creationTimer);
    }

    creationTimer = window.setInterval(() => {
      creationElapsedMs.value = Date.now() - creationStartedAt;
    }, 100);
  }

  function stopCreationTimer(): void {
    if (creationStartedAt > 0) {
      creationElapsedMs.value = Date.now() - creationStartedAt;
    }

    if (creationTimer) {
      window.clearInterval(creationTimer);
      creationTimer = undefined;
    }
  }

  function getPayload(sourceCopy: string): CopyCreationPayload {
    return {
      rewriteRequirements: rewriteRequirements.value,
      sourceCopy,
      styleId: copyStyleId.value,
    };
  }

  /** 百炼 Key 前置检查（改写与选题两种创作共用） */
  async function ensureBailianKey(): Promise<boolean> {
    if (!appConfig.isLoaded.value) {
      await appConfig.refreshConfig();
    }
    if (!appConfig.hasBailianKey.value) {
      ElMessage.warning("请先在配置中心填写百炼 API Key");
      openConfigCenter();
      return false;
    }
    return true;
  }

  async function createRewriteCopy(sourceCopy: string): Promise<void> {
    if (isCreatingCopy.value) {
      return;
    }

    if (!(await ensureBailianKey())) {
      return;
    }

    if (!sourceCopy.trim()) {
      ElMessage.warning("请先完成第一步提取文案");
      return;
    }

    await runCreation(getPayload(sourceCopy));
  }

  /** AI 选题：一句话选题直接出文案（不用抖音链接），结果同样进文案创作 */
  async function createFromTopic(topic: string): Promise<void> {
    if (isCreatingCopy.value) {
      return;
    }

    if (!(await ensureBailianKey())) {
      return;
    }

    if (!topic.trim()) {
      ElMessage.warning("先写一句话选题");
      return;
    }

    await runCreation({
      rewriteRequirements: "",
      sourceCopy: "",
      styleId: copyStyleId.value,
      topic: topic.trim(),
    });
  }

  async function runCreation(payload: CopyCreationPayload): Promise<void> {
    isCopyCreationCancelled.value = false;
    isCreatingCopy.value = true;
    createdCopy.value = "";
    startCreationTimer();

    try {
      const result = await window.desktopApi.createRewriteCopy(payload);

      if (isCopyCreationCancelled.value) {
        return;
      }

      if (!isCopyCreationResult(result)) {
        throw new Error("Invalid copy creation result");
      }

      createdCopy.value = result.text;
      ElMessage.success("文案创作完成");
    } catch (error) {
      if (!isCopyCreationCancelled.value) {
        const message = error instanceof Error ? error.message : "文案创作失败";
        if (/401|403|api ?key|unauthorized|invalid.*key/i.test(message)) {
          ElMessage.error("百炼 API Key 可能不正确，请在配置中心检查");
          openConfigCenter();
        } else {
          ElMessage.error(message);
        }
      }
    } finally {
      isCreatingCopy.value = false;
      stopCreationTimer();
    }
  }

  async function stopCopyCreation(): Promise<void> {
    if (!isCreatingCopy.value) {
      return;
    }

    isCopyCreationCancelled.value = true;
    await window.desktopApi.cancelCopyCreation();
    isCreatingCopy.value = false;
    stopCreationTimer();
    ElMessage.info("已停止创作");
  }

  onUnmounted(() => {
    if (creationTimer) {
      window.clearInterval(creationTimer);
    }
  });

  return {
    copyStyleId,
    createdCopy,
    creationElapsedText,
    createFromTopic,
    createRewriteCopy,
    isCreatingCopy,
    rewriteRequirements,
    setCopyStyleId,
    stopCopyCreation,
  };
}

/**
 * 文案创作改写 composable（共享单例模式）
 */
export function useCopyCreation() {
  if (!sharedCopyCreationState) {
    sharedCopyCreationState = useCopyCreationImpl();
  }
  return sharedCopyCreationState;
}
