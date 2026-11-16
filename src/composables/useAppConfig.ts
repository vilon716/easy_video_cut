/**
 * 应用配置（百炼 + 素材）共享状态
 *
 * 与模力方舟账户相互独立：百炼 Key/地址/模型、Pexels Key、本地素材库路径，
 * 存主进程 userData/app-config.json。配置中心负责编辑，这里负责读写与缓存。
 */
import { computed, ref } from "vue";

export interface AppConfigState {
  bailianApiKey: string;
  bailianBaseUrl: string;
  bailianTextModel: string;
  bailianTtsModel: string;
  bailianTtsVoice: string;
  pexelsApiKey: string;
  pixabayApiKey: string;
  coverrApiKey: string;
  bgmDir: string;
  materialsDir: string;
}

export const APP_CONFIG_DEFAULTS: AppConfigState = {
  bailianApiKey: "",
  bailianBaseUrl:
    "https://llm-ccyjbn76ya4x8n6g.cn-beijing.maas.aliyuncs.com",
  bailianTextModel: "kimi-k3.1-pro",
  bailianTtsModel: "qwen-audio-3.1-tts-flash",
  bailianTtsVoice: "longanhuan_v3.1",
  pexelsApiKey: "",
  pixabayApiKey: "",
  coverrApiKey: "",
  bgmDir: "",
  materialsDir: "",
};

let sharedState: ReturnType<typeof useImpl> | null = null;

function useImpl() {
  const config = ref<AppConfigState>({ ...APP_CONFIG_DEFAULTS });
  const isLoaded = ref(false);
  const isSaving = ref(false);

  const hasBailianKey = computed(() =>
    Boolean(config.value.bailianApiKey.trim()),
  );
  const hasPexelsKey = computed(() => Boolean(config.value.pexelsApiKey.trim()));
  const hasPixabayKey = computed(() =>
    Boolean(config.value.pixabayApiKey.trim()),
  );
  const hasCoverrKey = computed(() =>
    Boolean(config.value.coverrApiKey.trim()),
  );
  /** 任一在线素材源已配置（Pexels→Pixabay→Coverr，服务层自动切换） */
  const hasOnlineKey = computed(
    () => hasPexelsKey.value || hasPixabayKey.value || hasCoverrKey.value,
  );
  const hasMaterialsDir = computed(() =>
    Boolean(config.value.materialsDir.trim()),
  );

  async function refreshConfig(): Promise<void> {
    try {
      const loaded = (await window.desktopApi.loadAppConfig()) as
        | Partial<AppConfigState>
        | undefined;
      config.value = { ...APP_CONFIG_DEFAULTS, ...(loaded ?? {}) };
    } catch {
      // 读取失败时保留默认值，不阻塞界面
    }
    isLoaded.value = true;
  }

  async function saveConfig(next: AppConfigState): Promise<void> {
    isSaving.value = true;
    try {
      await window.desktopApi.saveAppConfig({ ...next });
      config.value = { ...next };
    } finally {
      isSaving.value = false;
    }
  }

  return {
    config,
    isLoaded,
    isSaving,
    hasBailianKey,
    hasPexelsKey,
    hasPixabayKey,
    hasCoverrKey,
    hasOnlineKey,
    hasMaterialsDir,
    refreshConfig,
    saveConfig,
  };
}

export function useAppConfig() {
  if (!sharedState) {
    sharedState = useImpl();
  }
  return sharedState;
}
