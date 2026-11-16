<script setup lang="ts">
import AppFooter from '@/components/AppFooter.vue'
import AppHeader from '@/components/AppHeader.vue'
import DouyinExtractionColumn from '@/components/DouyinExtractionColumn.vue'
import ExportColumn from '@/components/ExportColumn.vue'
import SubtitleRecognitionColumn from '@/components/SubtitleRecognitionColumn.vue'
import RemixColumn from '@/components/RemixColumn.vue'
</script>

<template>
  <div class="app-frame">
    <AppHeader />

    <main class="app-content">
      <section class="column-board" aria-label="功能模块区域">
        <DouyinExtractionColumn />
        <RemixColumn />
        <SubtitleRecognitionColumn />
        <ExportColumn />
      </section>
    </main>

    <AppFooter />
  </div>
</template>
