/**
 * 字幕模板 → ASS 生成（导出时由 video-render 调用，libass 烧录）。
 *
 * 模板规格按 1080×1920 参考分辨率定义，生成时按成片实际宽度等比缩放。
 * 颜色为 ASS 的 &HAABBGGRR 顺序。BorderStyle=3 是底盒样式，
 * 注意 libass 下底盒颜色取 OutlineColour（不是 BackColour）。
 */

export interface AssSubtitleItem {
  start: number;
  end: number;
  text: string;
  /** 双语模板的英文小字（可选） */
  subText?: string;
}

interface TemplateSpec {
  fontSize: number;
  primary: string;
  secondary: string;
  outline: string;
  back: string;
  bold: number;
  borderStyle: number;
  outlineWidth: number;
  shadow: number;
  marginV: number;
  spacing: number;
  effect: "karaoke" | "pop" | "neon" | "bilingual" | null;
}

const WHITE = "&H00FFFFFF";
const BLACK = "&H00000000";
const YELLOW = "&H0000FFFF";

const TEMPLATES: Record<string, TemplateSpec> = {
  classic: {
    fontSize: 84, primary: YELLOW, secondary: WHITE, outline: BLACK,
    back: BLACK, bold: -1, borderStyle: 1, outlineWidth: 6, shadow: 2,
    marginV: 190, spacing: 0, effect: null,
  },
  karaoke: {
    // libass 卡拉OK：未唱部分用 SecondaryColour，唱过扫成 PrimaryColour
    fontSize: 84, primary: YELLOW, secondary: WHITE, outline: BLACK,
    back: BLACK, bold: -1, borderStyle: 1, outlineWidth: 6, shadow: 2,
    marginV: 190, spacing: 0, effect: "karaoke",
  },
  variety: {
    fontSize: 96, primary: WHITE, secondary: WHITE, outline: "&H000080FF",
    back: "&H7F000000", bold: -1, borderStyle: 1, outlineWidth: 9, shadow: 4,
    marginV: 200, spacing: 0, effect: "pop",
  },
  cinema: {
    fontSize: 62, primary: WHITE, secondary: WHITE, outline: BLACK,
    back: "&H8C000000", bold: 0, borderStyle: 3, outlineWidth: 26, shadow: 0,
    marginV: 130, spacing: 0, effect: null,
  },
  neon: {
    fontSize: 80, primary: "&H00FFFF00", secondary: WHITE,
    outline: "&H00FF00FF", back: "&H00FF00FF", bold: -1, borderStyle: 1,
    outlineWidth: 2, shadow: 6, marginV: 190, spacing: 0, effect: "neon",
  },
  bilingual: {
    fontSize: 82, primary: WHITE, secondary: WHITE, outline: BLACK,
    back: BLACK, bold: -1, borderStyle: 1, outlineWidth: 5, shadow: 2,
    marginV: 190, spacing: 0, effect: "bilingual",
  },
  redbox: {
    fontSize: 80, primary: WHITE, secondary: WHITE, outline: "&H140000E6",
    back: BLACK, bold: -1, borderStyle: 3, outlineWidth: 20, shadow: 0,
    marginV: 200, spacing: 0, effect: null,
  },
  minimal: {
    fontSize: 54, primary: "&H00F2F2F2", secondary: WHITE,
    outline: "&H78000000", back: BLACK, bold: 0, borderStyle: 1,
    outlineWidth: 1, shadow: 0, marginV: 150, spacing: 3, effect: null,
  },
};

export function isSubtitleTemplateId(id: string | undefined): boolean {
  return Boolean(id && TEMPLATES[id]);
}

/**
 * 重点花字 ASS：画面正中的大字强调（综艺风橙边 + 弹入），
 * 与字幕是两套独立事件，导出时叠在字幕之后渲染。
 */
export function buildEmphasisAss(
  items: AssSubtitleItem[],
  width: number,
  height: number,
  fontName = "Microsoft YaHei",
): string | null {
  const valid = items.filter((item) => item.text.trim());
  if (!valid.length) return null;
  const scale = width / 1080;
  const fontSize = Math.round(118 * scale);
  const outlineWidth = Math.max(2, Math.round(10 * scale));
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: E,${fontName},${fontSize},&H00FFFFFF,&H00FFFFFF,&H000080FF,&H7F000000,-1,0,0,0,100,100,0,0,1,${outlineWidth},4,5,40,40,0,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  // 花字 118px 大字：一行最多 8 字，长短语断成两行居中，也避免冲出屏幕
  const events = valid.map(
    (item) =>
      `Dialogue: 0,${formatAssTime(item.start)},${formatAssTime(item.end)},E,,0,0,0,,{\\fad(120,160)\\t(0,180,\\fscx116\\fscy116)\\t(180,340,\\fscx100\\fscy100)}${wrapTextLines(item.text.trim(), 8).map(escapeAssText).join("\\N")}`,
  );
  return [...header, ...events].join("\n");
}

function formatAssTime(seconds: number): string {
  const totalCs = Math.max(0, Math.round(seconds * 100));
  const cs = totalCs % 100;
  const totalSeconds = Math.floor(totalCs / 100);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs)}`;
}

/** 转义 ASS 特殊字符（花括号是标签定界符，换成全角；反斜杠去掉） */
function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, "/")
    .replace(/\{/g, "｛")
    .replace(/\}/g, "｝")
    .replace(/\r?\n/g, "\\N");
}

/** 行首禁则：这些标点不能落在一行开头，断行时并入上一行 */
const NO_LINE_START = "，。！？；、）】」』%…·";

/**
 * 计算每行字数（断行点）：libass 对无空格的中文长句不会自动断行
 * （WrapStyle 0/2 实测都不断），必须在生成 ASS 时按字数手动插入 \N。
 */
function lineBreakCounts(chars: string[], maxChars: number): number[] {
  const counts: number[] = [];
  let i = 0;
  while (i < chars.length) {
    let end = Math.min(i + maxChars, chars.length);
    while (end < chars.length && NO_LINE_START.includes(chars[end])) end++;
    counts.push(end - i);
    i = end;
  }
  return counts.length ? counts : [chars.length];
}

/** 中文按字数断行（每行 ≤ maxChars 字），返回断好的行 */
function wrapTextLines(text: string, maxChars: number): string[] {
  const chars = [...text];
  if (chars.length <= maxChars) return [text];
  const lines: string[] = [];
  let i = 0;
  for (const count of lineBreakCounts(chars, maxChars)) {
    lines.push(chars.slice(i, i + count).join(""));
    i += count;
  }
  return lines;
}

/** 英文按词断行（双语模板的小字用） */
function wrapWords(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [text];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (word.length > maxChars) {
      if (current) {
        lines.push(current);
        current = "";
      }
      for (let i = 0; i < word.length; i += maxChars) {
        lines.push(word.slice(i, i + maxChars));
      }
      continue;
    }
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [text];
}

/** 卡拉OK：逐字 \kf，按字数均分这句的时长（厘秒）；长句按行断开，\N 不占字时 */
function karaokeText(
  text: string,
  durationSec: number,
  maxChars: number,
): string {
  const chars = [...text.replace(/\s/g, "")];
  if (!chars.length) return escapeAssText(text);
  const totalCs = Math.max(chars.length, Math.round(durationSec * 100));
  const per = Math.max(1, Math.floor(totalCs / chars.length));
  const tagged = chars.map((char) => `{\\kf${per}}${escapeAssText(char)}`);
  const lines: string[] = [];
  let i = 0;
  for (const count of lineBreakCounts(chars, maxChars)) {
    lines.push(tagged.slice(i, i + count).join(""));
    i += count;
  }
  return lines.join("\\N");
}

/**
 * 按模板生成完整 ASS 文本；模板 id 不认识时返回 null（调用方回退旧样式）。
 * fontName：libass 按名找字体，配合 subtitles 滤镜的 fontsdir 指到内置字体目录。
 */
export function buildSubtitleAss(
  items: AssSubtitleItem[],
  templateId: string,
  width: number,
  height: number,
  fontName = "Microsoft YaHei",
): string | null {
  const spec = TEMPLATES[templateId];
  if (!spec || !items.length) return null;
  const scale = width / 1080;
  const fontSize = Math.round(spec.fontSize * scale);
  const outlineWidth = Math.max(
    spec.borderStyle === 3 ? 4 : 1,
    Math.round(spec.outlineWidth * scale),
  );
  const marginV = Math.round(spec.marginV * scale);
  const shadow = Math.round(spec.shadow * scale);

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: T,${fontName},${fontSize},${spec.primary},${spec.secondary},${spec.outline},${spec.back},${spec.bold},0,0,0,100,100,${spec.spacing},0,${spec.borderStyle},${outlineWidth},${shadow},2,40,40,${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  // 每行字数：可用宽 = 1080 参考宽 − 左右边距 80，按模板字号（含字距）折算
  const maxChars = Math.max(
    6,
    Math.floor(1000 / (spec.fontSize + spec.spacing)),
  );
  const wrapMain = (value: string): string =>
    wrapTextLines(value, maxChars).map(escapeAssText).join("\\N");

  const events = items.map((item) => {
    const raw = item.text.trim();
    let text: string;
    if (spec.effect === "karaoke") {
      text = karaokeText(raw, item.end - item.start, maxChars);
    } else if (spec.effect === "pop") {
      text =
        "{\\fad(150,80)\\t(0,200,\\fscx118\\fscy118)\\t(200,380,\\fscx100\\fscy100)}" +
        wrapMain(raw);
    } else if (spec.effect === "neon") {
      text = "{\\blur3}" + wrapMain(raw);
    } else if (spec.effect === "bilingual" && item.subText?.trim()) {
      const subSize = Math.max(20, Math.round(fontSize * 0.56));
      const maxSubChars = Math.max(
        16,
        Math.floor(1000 / (spec.fontSize * 0.56 * 0.5)),
      );
      const sub = wrapWords(item.subText.trim(), maxSubChars)
        .map(escapeAssText)
        .join("\\N");
      text = wrapMain(raw) + `\\N{\\fs${subSize}\\c&HD9D9D9&}` + sub;
    } else {
      text = wrapMain(raw);
    }
    return `Dialogue: 0,${formatAssTime(item.start)},${formatAssTime(item.end)},T,,0,0,0,,${text}`;
  });

  return [...header, ...events].join("\n");
}
