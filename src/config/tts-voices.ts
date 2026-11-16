/**
 * 百炼 TTS 全部系统音色（模型 qwen-audio-3.1-tts-flash）
 *
 * 名单取自阿里云官方《Qwen-Audio-TTS 音色列表》中该模型的系统音色全表
 * （多语种与方言 / 精品中文 / 其他系统音色 / 精品英文，共 88 个；
 * 小语种音色只支持对应外语、国内口播用不上，未收录）。
 * 音色与模型绑定：换模型时这批 ID 不可混用；名单外的音色（复刻音色等）
 * 仍可在配置中心直接填 voice ID。
 *
 * group 用于选择面板分组；traits 是官方声线特质，tags 是适用场景/标记，
 * 两者都参与面板搜索过滤。
 */
export type TtsVoiceGroup = "方言多语种" | "女声" | "男声" | "童声" | "英文";

export const TTS_VOICE_GROUPS: TtsVoiceGroup[] = [
  "方言多语种",
  "女声",
  "男声",
  "童声",
  "英文",
];

export interface TtsVoiceOption {
  id: string;
  name: string;
  gender: "女" | "男" | "儿童";
  traits: string;
  tags: string;
  group: TtsVoiceGroup;
}

const DIALECT_TAGS =
  "支持方言 上海话 广东话 东北话 重庆话 陕西话 云南话 宁波话 甘肃话 多语种 日语 韩语 法语 德语";

export const TTS_VOICE_OPTIONS: TtsVoiceOption[] = [
  // ===== 方言多语种（同一音色可切多种方言/外语） =====
  { id: "longanhuan_v3.1", name: "龙安欢", gender: "女", traits: "活泼亲切", tags: DIALECT_TAGS, group: "方言多语种" },
  { id: "longanlingxin_v3.1", name: "龙安灵心", gender: "女", traits: "温柔治愈", tags: DIALECT_TAGS, group: "方言多语种" },
  { id: "longanfengyue_v3.1", name: "龙安风悦", gender: "女", traits: "明快自然", tags: DIALECT_TAGS, group: "方言多语种" },
  { id: "xunanchuan_v3.1", name: "许南川", gender: "男", traits: "磁性叙事", tags: DIALECT_TAGS, group: "方言多语种" },
  // ===== 女声 =====
  { id: "yuxiaoyun_v3.1", name: "于小云", gender: "女", traits: "元气、亲切、自然", tags: "广告营销 广播 客服 旁白", group: "女声" },
  { id: "qiaoxiaojiao_v3.1", name: "乔小娇", gender: "女", traits: "俏丽、可爱", tags: "广告营销 客服 有声书", group: "女声" },
  { id: "xiaxiaochen_v3.1", name: "夏小晨", gender: "女", traits: "元气、明亮", tags: "广告营销 有声书", group: "女声" },
  { id: "wenhuaiqing_v3.1", name: "温怀清", gender: "女", traits: "清亮、柔和", tags: "儿童故事 客服 广告营销 新闻播报", group: "女声" },
  { id: "anxiaolan_v3.1", name: "安小岚", gender: "女", traits: "清甜、纯净", tags: "有声书 客服 旁白 新闻播报 广告营销", group: "女声" },
  { id: "xieshurou_v3.1", name: "谢舒柔", gender: "女", traits: "柔和、自然、知性", tags: "有声书 客服 旁白", group: "女声" },
  { id: "baiqinglan_v3.1", name: "白清岚", gender: "女", traits: "明亮、清纯", tags: "语音助手 客服", group: "女声" },
  { id: "xuyuyuan_v3.1", name: "许玉远", gender: "女", traits: "知性、成熟、质感", tags: "广告营销 新闻播报 旁白 客服 有声书", group: "女声" },
  { id: "anruorou_v3.1", name: "安若柔", gender: "女", traits: "气声、知性", tags: "旁白 语音助手", group: "女声" },
  { id: "wenhuaizhi_v3.1", name: "闻怀之", gender: "女", traits: "稳重、成熟", tags: "有声书 新闻播报 广告营销 客服 旁白", group: "女声" },
  { id: "xiaoxingzhi_v3.1", name: "萧行之", gender: "女", traits: "端庄、贵气", tags: "新闻播报 有声书 旁白 客服", group: "女声" },
  { id: "guyunshu_v3.1", name: "顾云舒", gender: "女", traits: "成熟、稳重", tags: "音乐电台 客服 有声书 旁白", group: "女声" },
  { id: "yeqinghe_v3.1", name: "叶清禾", gender: "女", traits: "亲切、温柔", tags: "有声书 广告营销 旁白 客服", group: "女声" },
  { id: "yunhuanhuan_v3.1", name: "云欢欢", gender: "女", traits: "高亢、热情", tags: "有声书 旁白 客服", group: "女声" },
  { id: "xuxiaoqiao_v3.1", name: "徐小俏", gender: "女", traits: "自然、俏皮", tags: "有声书 旁白 客服", group: "女声" },
  { id: "baianran_v3.1", name: "白安然", gender: "女", traits: "低沉、浑厚、气声", tags: "配音讲解 有声书 旁白", group: "女声" },
  { id: "xuyanchu_v3.1", name: "许言初", gender: "女", traits: "沉稳、磁性", tags: "新闻播报 有声书", group: "女声" },
  { id: "yezhiqing_v3.1", name: "叶知晴", gender: "女", traits: "轻快、自然", tags: "儿童故事 客服 语音助手", group: "女声" },
  { id: "anyuqing_v3.1", name: "安语晴", gender: "女", traits: "甜妹", tags: "语音助手 旁白 新闻播报", group: "女声" },
  { id: "linxiaoling_v3.1", name: "林小灵", gender: "女", traits: "甜妹", tags: "语音助手", group: "女声" },
  { id: "longfeifei_v3.1", name: "龙菲菲", gender: "女", traits: "甜妹", tags: "社交陪伴", group: "女声" },
  { id: "longjing_v3.1", name: "龙婧", gender: "女", traits: "质感、沉稳", tags: "新闻播报", group: "女声" },
  { id: "longqiang_v3.1", name: "龙嫱", gender: "女", traits: "浪漫、风情", tags: "社交陪伴", group: "女声" },
  { id: "longyan_v3.1", name: "龙颜", gender: "女", traits: "温暖、自然、亲切", tags: "社交陪伴", group: "女声" },
  { id: "longxiaobai_v3.1", name: "龙小白", gender: "女", traits: "磁性、质感", tags: "新闻播报", group: "女声" },
  { id: "longyue_v3.1", name: "龙悦", gender: "女", traits: "温暖、磁性", tags: "有声书", group: "女声" },
  { id: "loongbella_v3.1", name: "Bella", gender: "女", traits: "干练、磁性、知性", tags: "中英双语 英文 新闻播报", group: "女声" },
  { id: "longanlingxi_v3.1", name: "龙安灵希", gender: "女", traits: "可爱甜美", tags: "社交陪伴", group: "女声" },
  { id: "longyingtao_v3.1", name: "龙应桃", gender: "女", traits: "温柔淡定", tags: "客服", group: "女声" },
  { id: "longanya_v3.1", name: "龙安雅", gender: "女", traits: "高雅气质", tags: "社交陪伴", group: "女声" },
  { id: "longwan_v3.1", name: "龙婉", gender: "女", traits: "细腻柔声", tags: "社交陪伴", group: "女声" },
  { id: "longxing_v3.1", name: "龙星", gender: "女", traits: "温婉邻家", tags: "社交陪伴", group: "女声" },
  { id: "longhua_v3.1", name: "龙华", gender: "女", traits: "元气甜美", tags: "社交陪伴", group: "女声" },
  { id: "longanyuanfei_v3.1", name: "龙安元妃", gender: "女", traits: "高傲妃子音", tags: "角色 社交陪伴", group: "女声" },
  { id: "loongstella_v3.1", name: "Stella", gender: "女", traits: "飒爽利落", tags: "新闻播报", group: "女声" },
  { id: "longyuan_v3.1", name: "龙媛", gender: "女", traits: "温暖治愈", tags: "有声书", group: "女声" },
  { id: "longmiao_v3.1", name: "龙妙", gender: "女", traits: "抑扬顿挫", tags: "有声书", group: "女声" },
  { id: "longanli_v3.1", name: "龙安莉", gender: "女", traits: "利落从容", tags: "语音助手", group: "女声" },
  { id: "longanwen_v3.1", name: "龙安温", gender: "女", traits: "优雅知性", tags: "语音助手", group: "女声" },
  { id: "longxiaoxia_v3.1", name: "龙小夏", gender: "女", traits: "沉稳权威", tags: "语音助手", group: "女声" },
  // ===== 男声 =====
  { id: "anmingyuan_v3.1", name: "安明远", gender: "男", traits: "清亮、自然", tags: "广告营销 有声书 旁白", group: "男声" },
  { id: "huozhuoshi_v3.1", name: "霍拙石", gender: "男", traits: "清亮", tags: "有声书 广告营销 旁白", group: "男声" },
  { id: "andi_v3.1", name: "安迪", gender: "男", traits: "ABC口音", tags: "语音助手 中英双语", group: "男声" },
  { id: "longcheng_v3.1", name: "龙橙", gender: "男", traits: "智慧、磁性", tags: "社交陪伴", group: "男声" },
  { id: "longlaotie_v3.1", name: "龙老铁", gender: "男", traits: "东北、直率", tags: "方言 东北话", group: "男声" },
  { id: "longshao_v3.1", name: "龙邵", gender: "男", traits: "积极、元气", tags: "社交陪伴", group: "男声" },
  { id: "longshu_v3.1", name: "龙书", gender: "男", traits: "沉稳、磁性", tags: "新闻播报", group: "男声" },
  { id: "longze_v3.1", name: "龙泽", gender: "男", traits: "温暖、元气、自然", tags: "社交陪伴", group: "男声" },
  { id: "longhao_v3.1", name: "龙浩", gender: "男", traits: "多情、忧郁", tags: "社交陪伴", group: "男声" },
  { id: "longjin_v3.1", name: "龙津", gender: "男", traits: "优雅、温润", tags: "诗词朗诵", group: "男声" },
  { id: "longnan_v3.1", name: "龙楠", gender: "男", traits: "睿智", tags: "有声书", group: "男声" },
  { id: "longshuo_v3.1", name: "龙硕", gender: "男", traits: "博才、干练", tags: "新闻播报", group: "男声" },
  { id: "longtian_v3.1", name: "龙天", gender: "男", traits: "磁性、理智", tags: "社交陪伴", group: "男声" },
  { id: "longxiaocheng_v3.1", name: "龙小诚", gender: "男", traits: "磁性、低音", tags: "社交陪伴", group: "男声" },
  { id: "longsanshu_v3.1", name: "龙三叔", gender: "男", traits: "沉稳质感", tags: "有声书", group: "男声" },
  { id: "longhan_v3.1", name: "龙寒", gender: "男", traits: "温暖痴情", tags: "社交陪伴", group: "男声" },
  { id: "longanzhi_v3.1", name: "龙安智", gender: "男", traits: "睿智轻熟", tags: "社交陪伴", group: "男声" },
  { id: "longzhe_v3.1", name: "龙哲", gender: "男", traits: "呆板大暖男", tags: "社交陪伴", group: "男声" },
  { id: "longanyang_v3.1", name: "龙安洋", gender: "男", traits: "阳光大男孩", tags: "社交陪伴 标杆音色", group: "男声" },
  { id: "libai_v3.1", name: "李白", gender: "男", traits: "古代诗仙", tags: "诗词朗诵 角色", group: "男声" },
  { id: "longanlang_v3.1", name: "龙安朗", gender: "男", traits: "清爽利落", tags: "语音助手", group: "男声" },
  { id: "longanchong_v3.1", name: "龙安冲", gender: "男", traits: "激情推销", tags: "直播带货", group: "男声" },
  // ===== 童声 =====
  { id: "longke_v3.1", name: "龙可", gender: "儿童", traits: "懵懂", tags: "童声 儿童", group: "童声" },
  { id: "longjielidou_v3.1", name: "龙杰力豆", gender: "男", traits: "天真男童", tags: "儿童陪伴 童声", group: "童声" },
  { id: "longhuohuo_v3.1", name: "龙火火", gender: "男", traits: "顽皮少年", tags: "角色 少年", group: "童声" },
  { id: "longling_v3.1", name: "龙铃", gender: "女", traits: "稚气呆板", tags: "童声 儿童", group: "童声" },
  { id: "longniuniu_v3.1", name: "龙牛牛", gender: "男", traits: "阳光男童", tags: "儿童有声书 童声", group: "童声" },
  { id: "longshanshan_v3.1", name: "龙闪闪", gender: "男", traits: "戏剧化童声", tags: "儿童有声书 童声", group: "童声" },
  { id: "longpaopao_v3.1", name: "龙泡泡", gender: "女", traits: "飞天泡泡音", tags: "儿童陪伴 童声", group: "童声" },
  // ===== 英文（仅支持英文） =====
  { id: "Emily_v3.1", name: "Emily", gender: "女", traits: "英式女声", tags: "英文 英式", group: "英文" },
  { id: "Luna_v3.1", name: "Luna", gender: "女", traits: "英式女声", tags: "英文 英式", group: "英文" },
  { id: "Eric_v3.1", name: "Eric", gender: "男", traits: "英式男声", tags: "英文 英式", group: "英文" },
  { id: "Luca_v3.1", name: "Luca", gender: "男", traits: "英式男声", tags: "英文 英式", group: "英文" },
  { id: "Abby_v3.1", name: "Abby", gender: "女", traits: "美式女声", tags: "英文 美式", group: "英文" },
  { id: "Annie_v3.1", name: "Annie", gender: "女", traits: "美式女声", tags: "英文 美式", group: "英文" },
  { id: "Ava_v3.1", name: "Ava", gender: "女", traits: "美式女声", tags: "英文 美式", group: "英文" },
  { id: "Beth_v3.1", name: "Beth", gender: "女", traits: "美式女声", tags: "英文 美式", group: "英文" },
  { id: "Betty_v3.1", name: "Betty", gender: "女", traits: "美式女声", tags: "英文 美式", group: "英文" },
  { id: "Cally_v3.1", name: "Cally", gender: "女", traits: "美式女声", tags: "英文 美式", group: "英文" },
  { id: "Cindy_v3.1", name: "Cindy", gender: "女", traits: "美式女声", tags: "英文 美式", group: "英文" },
  { id: "Donna_v3.1", name: "Donna", gender: "女", traits: "美式女声", tags: "英文 美式", group: "英文" },
  { id: "Andy_v3.1", name: "Andy", gender: "男", traits: "美式男声", tags: "英文 美式", group: "英文" },
  { id: "Brian_v3.1", name: "Brian", gender: "男", traits: "美式男声", tags: "英文 美式", group: "英文" },
  { id: "David_v3.1", name: "David", gender: "男", traits: "美式男声", tags: "英文 美式", group: "英文" },
];

export function findTtsVoice(id: string): TtsVoiceOption | undefined {
  return TTS_VOICE_OPTIONS.find((option) => option.id === id);
}

export function ttsVoiceLabel(id: string): string {
  const voice = findTtsVoice(id);
  if (!voice) return id;
  return voice.name + " · " + voice.gender + " · " + voice.traits;
}
