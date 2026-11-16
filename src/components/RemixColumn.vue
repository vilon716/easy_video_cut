<script setup lang="ts">
/**
 * 第三步：AI 配音（百炼逐句合成） + 第四步：素材混剪
 *
 * 配音走百炼（配置中心的百炼与素材），逐句合成并拼成完整旁白。
 * 混剪按逐句时长配画面并合上旁白，成片写入成片槽位由下方预览，
 * 故两步放在同一列。
 */
import { ElDivider } from 'element-plus'
import BailianTtsSection from '@/components/bailian-tts/BailianTtsSection.vue'
import RemixSection from '@/components/remix/RemixSection.vue'
import BgmSection from '@/components/remix/BgmSection.vue'
import FinalVideoSection from '@/components/FinalVideoSection.vue'
</script>

<template>
  <article class="feature-column">
    <div class="column-body voice-tool">
      <el-divider class="step-divider">第三步：AI 配音</el-divider>

      <BailianTtsSection />

      <RemixSection />
      <BgmSection />
      <FinalVideoSection />
    </div>
  </article>
</template>

<style scoped>
.feature-column {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #d8e0ea;
  border-radius: 6px;
  background: #ffffff;
}

.column-body {
  flex: 1;
  min-height: 0;
  padding: 12px;
  color: #5f6e80;
  font-size: 13px;
  line-height: 1.6;
}

.voice-tool {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  overflow-y: auto;
}

/* 成片预览撑满剩余空间，使本列底边与其他列对齐；
 * flex-basis 用 0，避免生成视频后被视频原始高度撑爆本列。 */
.voice-tool :deep(.final-video-section) {
  flex: 1 1 0;
  min-height: 240px;
}

.step-divider {
  margin-top: 20px;
  margin-bottom: 15px;
  border-color: #b9c9dc;
}

.step-divider :deep(.el-divider__text) {
  padding: 5px 14px;
  border: 1px solid #c7d5e7;
  border-radius: 999px;
  color: #29435f;
  background: linear-gradient(180deg, #ffffff 0%, #eef5fb 100%);
  font-size: 13px;
  font-weight: 700;
  box-shadow: 0 4px 12px rgba(42, 74, 108, 0.08);
}

/* ── 配置弹窗 ── */
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(15, 23, 42, 0.35);
}

.config-modal {
  width: min(94vw, 560px);
  max-height: calc(100vh - 40px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.28);
}

.modal-header {
  min-height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 18px;
  border-bottom: 1px solid #e1e7ef;
}

.modal-header h2 {
  margin: 0;
  color: #172033;
  font-size: 17px;
}

.icon-button {
  width: 32px;
  height: 32px;
  display: inline-grid;
  place-items: center;
  border: 1px solid transparent;
  border-radius: 6px;
  color: #64748b;
  background: transparent;
  font-size: 24px;
  line-height: 1;
}

.icon-button:hover {
  border-color: #d4dce8;
  color: #172033;
  background: #f6f8fb;
}

.config-modal-body {
  display: grid;
  gap: 16px;
  padding: 18px;
  overflow: auto;
}

.provider-select-field {
  display: grid;
  gap: 6px;
}

.provider-select-field > span {
  color: #334155;
  font-size: 12px;
  font-weight: 700;
}

.provider-select-field select {
  width: 100%;
  height: 34px;
  padding: 0 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  color: #172033;
  background: #ffffff;
  font-size: 13px;
  outline: none;
}

.provider-select-field select:focus {
  border-color: #2a6f97;
  box-shadow: 0 0 0 3px rgba(42, 111, 151, 0.12);
}

.modal-actions {
  min-height: 56px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 10px 16px;
  border-top: 1px solid #e1e7ef;
  background: #fbfcfe;
}
</style>
