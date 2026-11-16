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
    };
  }

  async function createRewriteCopy(sourceCopy: string): Promise<void> {
    if (isCreatingCopy.value) {
      return;
    }

    // 文案创作走百炼：没填百炼 Key 时引导去配置中心（不再要求模力方舟授权）
    if (!appConfig.isLoaded.value) {
      await appConfig.refreshConfig();
    }
    if (!appConfig.hasBailianKey.value) {
      ElMessage.warning("请先在配置中心填写百炼 API Key");
      openConfigCenter();
      return;
    }

    if (!sourceCopy.trim()) {
      ElMessage.warning("请先完成第一步提取文案");
      return;
    }

    isCopyCreationCancelled.value = false;
    isCreatingCopy.value = true;
    createdCopy.value = "";
    startCreationTimer();

    try {
      const result = await window.desktopApi.createRewriteCopy(
        getPayload(sourceCopy),
      );

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
    createdCopy,
    creationElapsedText,
    createRewriteCopy,
    isCreatingCopy,
    rewriteRequirements,
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
