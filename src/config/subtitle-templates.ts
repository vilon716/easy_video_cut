/**
 * 字幕模板（第五步字幕样式弹窗里选用，导出时由主进程按模板
 * 生成 ASS 并用 libass 烧录：描边/底盒/发光/动画/逐字变色）。
 * id 与 electron/services/subtitle-templates.ts 中的规格一一对应。
 * "custom" 是保留项：不用模板，走原来的字体/字号/描边自定义样式。
 */

export interface SubtitleTemplateOption {
  id: string;
  name: string;
  desc: string;
}

export const SUBTITLE_TEMPLATES: SubtitleTemplateOption[] = [
  { id: "classic", name: "经典黄字黑边", desc: "短视频最通用" },
  { id: "karaoke", name: "卡拉OK逐字", desc: "跟着配音逐字变色" },
  { id: "variety", name: "综艺大字弹入", desc: "橙边大字＋弹入动画" },
  { id: "cinema", name: "电影黑条", desc: "底部黑盒白字" },
  { id: "neon", name: "霓虹发光", desc: "青字品红光晕" },
  { id: "bilingual", name: "双语小字", desc: "中文大字＋英文小字（自动翻译）" },
  { id: "redbox", name: "红底醒目", desc: "红盒白字抓眼球" },
  { id: "minimal", name: "极简文艺", desc: "小字细边低调" },
];

export const CUSTOM_TEMPLATE_ID = "custom";
export const DEFAULT_TEMPLATE_ID = "classic";
