/**
* 百炼文案创作（替代模力方舟版，负载与结果形状保持一致，上层无感切换）
*
* 接口：POST {bailianBaseUrl}/compatible-mode/v1/chat/completions（流式 SSE）
* 认证：Bearer 百炼 API Key（配置中心填写，当前用 Leo 的工作空间）
* 模型：配置里的 bailianTextModel（默认 kimi-k3.1-pro）
*
* 只取流式增量里的 content 作为文案；reasoning_content（思考过程）忽略，
* 正文里残留的 <think> 块也会清掉。
*/
import { logInfo} from "./_shared/logger";
import type { AppConfig} from "./app-config";

export interface BailianCopyCreationPayload {
rewriteRequirements: string;
sourceCopy: string;
}

export interface BailianCopyCreationResult {
text: string;
}

/** 流式响应连续多久没有新数据就判定卡住 */
const STREAM_IDLE_TIMEOUT_MS = 60_000;
/** 单次创作的最长等待（推理模型思考较久，给足时间） */
const TOTAL_TIMEOUT_MS = 300_000;

/** 流式响应中每个 data 块的结构 */
interface ChatStreamChunk {
choices?: Array<{
delta?: {
content?: string | null;
reasoning_content?: string | null;
};
finish_reason?: string | null;
}>;
error?: { message?: string; code?: string};
}

/** 非 2xx 响应体的结构 */
interface ErrorResponse {
error?: { message?: string; code?: string} | string;
message?: string;
code?: string;
}

/** 公共 prompt 模板（与模力方舟版保持一致，保证改写风格不漂移） */
const copyPromptTemplate = `你是一名短视频IP口播文案专家，请基于用户提供的原始文案进行二次创作。

【改写要求（最高优先级，必须严格执行）】
{{rewriteRequirements}}

以上【改写要求】是本次创作最重要的指令，成品必须明显体现这些要求；当它与下方通用要求发生冲突时，一律以【改写要求】为准（"无"表示没有额外要求）。

输出要求非常重要：
1. 只输出一段完整口播文案正文。
2. 不要输出标题、开场钩子、完整口播文案、结尾引导等结构名。
3. 不要使用 Markdown 标题、编号、小标题、项目符号、分隔线。
4. 不要解释创作思路，不要给配图建议，不要给话题标签。
5. 文案会直接进入语音合成，所以输出内容必须能被直接朗读。
6. 可以自然分段，但每一段都必须是口播正文的一部分。

创作目标：
1. 严格落实上方【改写要求】，让成品明显体现这些要求（这是第一优先级）。
2. 保留原始文案的核心观点和事实，不编造不存在的信息。
3. 开头要更有钩子，表达要自然、有节奏，避免空泛鸡汤。
4. 结尾可以自然引导互动，但不要出现"结尾引导"这类标签。

原始文案：
{{sourceCopy}}

请直接输出最终口播文案正文，并确保明显体现上方【改写要求】。`;

function renderPrompt(payload: BailianCopyCreationPayload): string {
return copyPromptTemplate
.replaceAll(
"{{rewriteRequirements}}",
payload.rewriteRequirements.trim() || "无",
)
.replaceAll("{{sourceCopy}}", payload.sourceCopy.trim());
}

const LEADING_LABELS = [
  "标题",
  "开场钩子",
  "完整口播文案",
  "口播文案",
  "可选结尾引导",
  "结尾引导",
];
const OPEN_BRACKET = "【";
const CLOSE_BRACKET = "】";

/** 去掉行首的结构标签（如「标题：」「【开场钩子】：」），与原正则版等效 */
function stripLeadingLabel(line: string): string {
  for (const label of LEADING_LABELS) {
    for (const prefix of [
      `${OPEN_BRACKET}${label}${CLOSE_BRACKET}`,
      `${OPEN_BRACKET}${label}`,
      label,
    ]) {
      if (line.startsWith(prefix)) {
        return line.slice(prefix.length).replace(/^[：:]\s*/, "");
      }
    }
  }
  return line;
}

function cleanText(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      stripLeadingLabel(
        line
          .replace(/^#{1,6}\s*/, "")
          .replace(/^[-*]\s+/, "")
          .replace(/^\d+[.、]\s*/, "")
          .trim(),
      ),
    )
    .filter((line) => line && !/^[-=]{3,}$/.test(line))
    .join("\n")
    .trim();
}

/** 去掉正文里可能残留的 <think>…</think> 思考块 */
function stripThinking(text: string): string {
return text
.replace(/<think>[\s\S]*?<\/think>/g, "")
.replace(/^[\s\S]*?<\/think>/, "")
.trim();
}

/** 从非 2xx 响应里提取可读的错误信息 */
async function readErrorMessage(response: Response): Promise<string> {
const raw = await response.text().catch(() => "");
try {
const data = JSON.parse(raw) as ErrorResponse;
const err = data.error;
if (typeof err === "string") return err;
return (
err?.message??
err?.code??
data.message??
data.code??
`HTTP ${response.status}`
);
} catch {
if (!raw.trim() || raw.trimStart().startsWith("<")) {
return `服务暂时不可用（HTTP ${response.status}）`;
}
return raw.slice(0, 200);
}
}

export async function createCopyBailian(
config: AppConfig,
payload: BailianCopyCreationPayload,
userSignal: AbortSignal,
): Promise<BailianCopyCreationResult> {
const apiKey = config.bailianApiKey.trim();
if (!apiKey) {
throw new Error("请先在配置中心填写百炼 API Key");
}
if (!payload.sourceCopy.trim()) {
throw new Error("请先完成第一步提取文案");
}

const baseUrl = config.bailianBaseUrl.replace(/\/+$/, "");
const url = `${baseUrl}/compatible-mode/v1/chat/completions`;
const prompt = renderPrompt(payload);

// 空闲计时器：每收到一块数据就重置
const idleController = new AbortController();
let idleTimer: ReturnType<typeof setTimeout> | undefined;
const resetIdle = () => {
clearTimeout(idleTimer);
idleTimer = setTimeout(
() => idleController.abort(new Error("模型响应超时")),
STREAM_IDLE_TIMEOUT_MS,
);
};

const signal = AbortSignal.any([
userSignal,
idleController.signal,
AbortSignal.timeout(TOTAL_TIMEOUT_MS),
]);

resetIdle();
try {
const response = await fetch(url, {
method: "POST",
headers: {
Authorization: `Bearer ${apiKey}`,
"Content-Type": "application/json",
Accept: "text/event-stream",
},
body: JSON.stringify({
model: config.bailianTextModel,
messages: [{ role: "user", content: prompt}],
stream: true,
max_tokens: 8192,
}),
signal,
});

if (!response.ok) {
throw new Error(await readErrorMessage(response));
}
if (!response.body) {
throw new Error("模型没有返回数据");
}

const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
let content = "";
let finishReason = "";

const handleLine = (line: string): boolean => {
const trimmed = line.trim();
if (!trimmed.startsWith("data:")) return false;
const data = trimmed.slice(5).trim();
if (data === "[DONE]") return true;
let chunk: ChatStreamChunk;
try {
chunk = JSON.parse(data) as ChatStreamChunk;
} catch {
return false;
}
if (chunk.error) {
throw new Error(
chunk.error.message?? chunk.error.code?? "模型返回错误",
);
}
const choice = chunk.choices?.[0];
content += choice?.delta?.content?? "";
if (choice?.finish_reason) finishReason = choice.finish_reason;
return false;
};

let done = false;
while (!done) {
const { value, done: streamDone} = await reader.read();
if (streamDone) break;
resetIdle();
buffer += decoder.decode(value, { stream: true});
const lines = buffer.split("\n");
buffer = lines.pop()?? "";
for (const line of lines) {
if (handleLine(line)) {
done = true;
break;
}
}
}
if (!done && buffer) handleLine(buffer);
await reader.cancel().catch(() => undefined);

const text = cleanText(stripThinking(content));
if (!text) {
throw new Error(
finishReason === "length"
? "模型输出被截断，没有生成正文"
: "模型返回内容为空",
);
}
logInfo("copy-creation-bailian", `文案生成成功，模型 ${config.bailianTextModel}`);
return { text};
} catch (error) {
if (signal.aborted &&!userSignal.aborted) {
const reason = signal.reason;
throw new Error(
reason instanceof Error && reason.name!== "TimeoutError"
? reason.message
: "模型响应超时",
);
}
throw error;
} finally {
clearTimeout(idleTimer);
}
}

/** 从模型回复里提取 JSON 数组文本（推理模型常先说一段再给结果，从最后一个 [ 往前试） */
function extractJsonArrayText(raw: string): string | null {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  for (
    let i = cleaned.lastIndexOf("[");
    i >= 0;
    i = i === 0 ? -1 : cleaned.lastIndexOf("[", i - 1)
  ) {
    const slice = cleaned.slice(i);
    try {
      const parsed: unknown = JSON.parse(slice);
      if (Array.isArray(parsed)) return slice;
    } catch {
      // 继续往前找
    }
  }
  return null;
}

/**
 * 双语字幕：把每一句中文翻译成简洁的英文字幕（一次请求全部句子）。
 * 只接受 JSON 字符串数组、顺序与入参一致；失败直接抛错，不静默兜底。
 */
export async function translateSentences(
  config: AppConfig,
  sentences: string[],
): Promise<string[]> {
  const apiKey = config.bailianApiKey.trim();
  if (!apiKey) {
    throw new Error("请先在配置中心填写百炼 API Key");
  }
  const list = sentences.map((item) => item.trim()).filter(Boolean);
  if (!list.length) return [];

  const baseUrl = config.bailianBaseUrl.replace(/\/+$/, "");
  const url = `${baseUrl}/compatible-mode/v1/chat/completions`;
  const prompt = [
    "把下面每一句中文短视频字幕翻译成简洁自然的英文字幕（口语化、短句，不要逐字硬译）。",
    "只输出一个 JSON 字符串数组，不要输出任何解释、标题或代码块标记。",
    "数组长度必须和句子数量一致，顺序一一对应。",
    "",
    "句子列表（JSON）：",
    JSON.stringify(list),
  ].join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.bailianTextModel,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 4096,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    throw new Error(
      `翻译请求失败：${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timer);
  }

  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(`翻译失败：HTTP ${response.status} ${rawText.slice(0, 160)}`);
  }
  let content = "";
  try {
    const data = JSON.parse(rawText) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    content = data.choices?.[0]?.message?.content ?? "";
  } catch {
    throw new Error(`翻译响应解析失败：${rawText.slice(0, 160)}`);
  }
  const arrayText = extractJsonArrayText(content);
  if (!arrayText) {
    throw new Error(
      `翻译结果里没找到译文数组，模型原文开头：${content.slice(0, 120)}`,
    );
  }
  const parsed = JSON.parse(arrayText) as unknown[];
  const translations = parsed.map((item) =>
    typeof item === "string" ? item.trim() : "",
  );
  // 与原句对齐：翻译时过滤了空句，这里按非空顺序回填
  const result: string[] = [];
  let cursor = 0;
  for (const sentence of sentences) {
    if (!sentence.trim()) {
      result.push("");
    } else {
      result.push(translations[cursor] ?? "");
      cursor += 1;
    }
  }
  return result;
}

/** 通用：向文本模型要一个 JSON 数组（失败抛错并带模型原文开头） */
async function chatJsonArray(
  config: AppConfig,
  prompt: string,
): Promise<unknown[]> {
  const apiKey = config.bailianApiKey.trim();
  if (!apiKey) {
    throw new Error("请先在配置中心填写百炼 API Key");
  }
  const baseUrl = config.bailianBaseUrl.replace(/\/+$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/compatible-mode/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.bailianTextModel,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 4096,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    throw new Error(
      `请求失败：${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timer);
  }
  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(`请求失败：HTTP ${response.status} ${rawText.slice(0, 160)}`);
  }
  let content = "";
  try {
    const data = JSON.parse(rawText) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    content = data.choices?.[0]?.message?.content ?? "";
  } catch {
    throw new Error(`响应解析失败：${rawText.slice(0, 160)}`);
  }
  const arrayText = extractJsonArrayText(content);
  if (!arrayText) {
    throw new Error(`结果里没找到 JSON 数组，模型原文开头：${content.slice(0, 120)}`);
  }
  const parsed: unknown = JSON.parse(arrayText);
  if (!Array.isArray(parsed)) {
    throw new Error("结果不是 JSON 数组");
  }
  return parsed;
}

export interface EmphasisPick {
  /** 句子下标（0 起） */
  index: number;
  /** 花字短句（≤12 字） */
  text: string;
}

/**
 * 重点花字：从字幕句子里挑最值得大字强调的（数字/价格/结论/转折优先），
 * 每句提炼一个短花字。挑不出就返回空数组，由界面提示手动加。
 */
export async function pickEmphasisSentences(
  config: AppConfig,
  sentences: string[],
): Promise<EmphasisPick[]> {
  const list = sentences.map((item) => item.trim());
  if (!list.length) return [];
  const prompt = [
    "下面是一个短视频的逐句字幕（带下标）。挑出最值得在画面中央弹大字强调的句子，最多 3 句：",
    "优先有具体数字、价格、结论、强转折的句子；平淡的过渡句不要选。",
    "每句给一个花字短句：提炼成 4~10 个字的有冲击力的短语，不要照抄整句，不要引号。",
    '只输出 JSON 数组，每项 {"index": 句子下标, "text": "花字短句"}，不要输出任何解释。',
    "",
    "字幕（JSON）：",
    JSON.stringify(list.map((text, index) => ({ index, text }))),
  ].join("\n");
  const parsed = await chatJsonArray(config, prompt);
  const picks: EmphasisPick[] = [];
  for (const raw of parsed) {
    const item = raw as { index?: unknown; text?: unknown };
    if (
      typeof item.index === "number" &&
      Number.isInteger(item.index) &&
      item.index >= 0 &&
      item.index < list.length &&
      typeof item.text === "string" &&
      item.text.trim()
    ) {
      picks.push({ index: item.index, text: item.text.trim().slice(0, 12) });
    }
  }
  return picks.slice(0, 3);
}

/**
 * 封面标题提炼：按文案出 5 个候选标题；avoid 里是上一批，
 * 要求不与它们重复，方便用户「换一批」。
 */
export async function suggestCoverTitles(
  config: AppConfig,
  copyText: string,
  avoid: string[],
): Promise<string[]> {
  const text = copyText.trim();
  if (!text) {
    throw new Error("还没有文案，先完成文案和配音再提炼标题");
  }
  const prompt = [
    "给下面这条短视频文案提炼 5 个封面标题，要求：",
    "1. 每个标题不超过 14 个字，口语化、抓眼球，一眼能看懂视频讲什么。",
    "2. 可以用数字、疑问、对比，但不要用「震惊」「必看」这类违规标题党词，不要引号、不要编号。",
    "3. 5 个标题角度要不同：比如数字型、疑问型、结论型、对比型、痛点型各一个。",
    avoid.length
      ? `4. 不要和这批重复或雷同：${JSON.stringify(avoid)}`
      : "",
    "只输出一个 JSON 字符串数组，不要输出任何解释。",
    "",
    "文案：",
    text.slice(0, 2000),
  ]
    .filter(Boolean)
    .join("\n");
  const parsed = await chatJsonArray(config, prompt);
  return parsed
    .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .map((item) => item.trim().slice(0, 20))
    .slice(0, 5);
}
