/**
 * 百炼 TTS 常用音色（模型 qwen-audio-3.1-tts-flash 的系统音色）
 *
 * 名单取自阿里云官方《Qwen-Audio-TTS 音色列表》中该模型的中文音色，
 * 按短视频口播常用度精选。音色与模型绑定：换模型时这批 ID 不可混用，
 * 其他音色（英文/角色/复刻音色）可在配置中心直接填 voice ID。
 */
export interface TtsVoiceOption {
  id: string;
  label: string;
}

export const TTS_VOICE_OPTIONS: TtsVoiceOption[] = [
  { id: "longanhuan_v3.1", label: "龙安欢 · 女 · 活泼亲切（默认）" },
  { id: "longanlingxin_v3.1", label: "龙安灵心 · 女 · 温柔治愈" },
  { id: "longanfengyue_v3.1", label: "龙安风悦 · 女 · 明快播报" },
  { id: "xunanchuan_v3.1", label: "许南川 · 男 · 磁性故事感" },
  { id: "yuxiaoyun_v3.1", label: "于小云 · 女 · 元气亲切" },
  { id: "qiaoxiaojiao_v3.1", label: "乔小娇 · 女 · 俏丽可爱" },
  { id: "xiaxiaochen_v3.1", label: "夏小晨 · 女 · 元气明亮" },
  { id: "anxiaolan_v3.1", label: "安小岚 · 女 · 清甜纯净" },
  { id: "xieshurou_v3.1", label: "谢舒柔 · 女 · 柔和知性" },
  { id: "xuyuyuan_v3.1", label: "许玉远 · 女 · 知性成熟" },
  { id: "wenhuaiqing_v3.1", label: "温怀清 · 女 · 清亮柔和" },
  { id: "wenhuaizhi_v3.1", label: "闻怀之 · 女 · 稳重成熟" },
  { id: "yeqinghe_v3.1", label: "叶清禾 · 女 · 亲切温柔" },
  { id: "baianran_v3.1", label: "白安然 · 女 · 低沉浑厚" },
  { id: "xuyanchu_v3.1", label: "许言初 · 女 · 沉稳磁性" },
  { id: "longjing_v3.1", label: "龙婧 · 女 · 质感沉稳 · 新闻播报" },
  { id: "longxiaobai_v3.1", label: "龙小白 · 女 · 磁性质感 · 新闻播报" },
  { id: "loongbella_v3.1", label: "Bella · 女 · 干练知性 · 中英双语" },
  { id: "anmingyuan_v3.1", label: "安明远 · 男 · 清亮自然" },
  { id: "huozhuoshi_v3.1", label: "霍拙石 · 男 · 清亮" },
  { id: "longshu_v3.1", label: "龙书 · 男 · 沉稳磁性 · 新闻播报" },
  { id: "longshuo_v3.1", label: "龙硕 · 男 · 博才干练 · 新闻播报" },
  { id: "longxiaocheng_v3.1", label: "龙小诚 · 男 · 磁性低音" },
  { id: "longsanshu_v3.1", label: "龙三叔 · 男 · 沉稳质感 · 有声书" },
  { id: "longze_v3.1", label: "龙泽 · 男 · 温暖元气" },
  { id: "longanyang_v3.1", label: "龙安洋 · 男 · 阳光大男孩" },
  { id: "longanchong_v3.1", label: "龙安冲 · 男 · 激情推销 · 直播带货" },
  { id: "longlaotie_v3.1", label: "龙老铁 · 男 · 东北直率" },
];

export function ttsVoiceLabel(id: string): string {
  return TTS_VOICE_OPTIONS.find((option) => option.id === id)?.label ?? id;
}
