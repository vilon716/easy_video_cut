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
/** 文案风格 ID（见 COPY_STYLE_BLOCKS；空/未知 = 默认洗稿） */
styleId?: string;
/** AI 选题模式：给出一句话选题时走选题模板（忽略 sourceCopy） */
topic?: string;
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

/**
 * 文案风格模式（方法论提炼成提示块，挂在改写要求之后；
 * 与【改写要求】冲突时以改写要求为准）。ID 与渲染层 config/copy-styles 对应。
 */
export const COPY_STYLE_BLOCKS: Record<string, { name: string; block: string }> = {
hook: {
name: "爆款开头",
block: `- 第一句话必须让陌生人愿意多停两秒：直接说观众正在遇到的问题、想得到的结果，或把观众心里正防着的那句话替他说出来（比如“肯定又有坑吧”）。不要以“我”的经历开场，自己的经历放后面当证据。
- 第一句尽量信息密集：一句里同时给出付出、结果或反差中的两样，但每个点都要一听就懂。
- 严禁画饼式开头（“学会这个能省几万”“零基础月入过万”）和自嗨式设问（“为什么我今天非要讲这个”）。承诺必须比后面的证据小一号。
- 开头抛出的期待，紧接着的一两句必须用具体事件、数据或演示兑现，不许悬空。
- 结尾给观众一个明确的关注理由（后面还有什么真实的东西），一句收尾，干脆结束，不拖互动话术。`,
},
tutorial: {
name: "干货教程",
block: `- 按“钩子 → 证据 → 承诺 → 条件 → 指令”组织：先一句话说清学会后能干什么，再给一个马上能验证的证据或演示，然后说清能达到的效果、真实门槛出现在哪一步，最后给出第一步具体怎么做。
- 做减法：一到两个关键点讲透，不罗列一堆工具和名词；删掉不服务主题的信息。
- 举例只选目标观众最常见的那个处境，让人一看就觉得“说的就是我”。
- 全程让观众觉得“有手就会”：步骤具体、门槛低；必要的难点不藏着，提前说清卡住时怎么办。`,
},
story: {
name: "故事记录",
block: `- 按“事件 → 行动 → 变化”推进：先讲发生了什么具体的事，再讲做了什么，最后讲带来了什么变化或结果。
- 用具体细节让观众自己得出结论，不直白说教，不喊口号，不总结大道理。
- 只写原文里真实有的经历和事实，不编造情节、对话和数字；原文没有的转折不要硬加。
- 情绪跟着事件走，平实讲述，结尾停在变化或结果上，不额外升华。`,
},
hotspot: {
name: "热点判断",
block: `- 结论先行：第一句就说这件事跟观众有什么关系、观众该怎么办，不把最有用的话留到最后。
- 然后依次讲：这件事是什么（当证据用）→ 为什么会这样 → 以后可能怎样。判断要落到观众自己的行动上。
- 只用原文给出的事实和数字，不编造日期、数据和出处；原文没说的背景不要补。
- 不站队、不煽动对立，语气是帮观众做判断，不是吵架。`,
},
selling: {
name: "带货转化",
block: `- 先说观众的痛点或想要的结果，再引出产品或服务是怎么做到的，接着给真实证据（效果、过程、反馈，只能用原文里有的），最后自然承接：想要的人去哪里找、怎么联系，一句带过。
- 不夸大功效，不承诺原文没有的结果，不编造销量、评价和价格。
- 承接要具体、低门槛（先试用、先咨询、先看样品之类），不硬推销、不制造焦虑。`,
},
};

function renderStyleBlock(styleId: string | undefined): string {
if (!styleId) return "";
const style = COPY_STYLE_BLOCKS[styleId];
if (!style) return "";
return `\n【文案风格：${style.name}】\n${style.block}\n（风格要求与【改写要求】冲突时，一律以【改写要求】为准。）\n`;
}

/** 公共 prompt 模板（与模力方舟版保持一致，保证改写风格不漂移） */
const copyPromptTemplate = `你是一名短视频IP口播文案专家，请基于用户提供的原始文案进行二次创作。

【改写要求（最高优先级，必须严格执行）】
{{rewriteRequirements}}

以上【改写要求】是本次创作最重要的指令，成品必须明显体现这些要求；当它与下方通用要求发生冲突时，一律以【改写要求】为准（"无"表示没有额外要求）。
{{styleBlock}}

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
.replaceAll("{{styleBlock}}", renderStyleBlock(payload.styleId))
.replaceAll("{{sourceCopy}}", payload.sourceCopy.trim());
}

/** AI 选题模板：一句话选题 → 原创口播文案（不依赖提取原文） */
const topicPromptTemplate = `你是一名短视频IP口播文案专家，请围绕用户给出的一句话选题，创作一段可以直接口播的短视频文案。

【选题】
{{topic}}
{{styleBlock}}
输出要求非常重要：
1. 只输出一段完整口播文案正文。
2. 不要输出标题、开场钩子、完整口播文案、结尾引导等结构名。
3. 不要使用 Markdown 标题、编号、小标题、项目符号、分隔线。
4. 不要解释创作思路，不要给配图建议，不要给话题标签。
5. 文案会直接进入语音合成，所以输出内容必须能被直接朗读。
6. 可以自然分段，但每一段都必须是口播正文的一部分。

创作目标：
1. 紧扣选题展开，开头要有钩子，表达自然、有节奏，避免空泛鸡汤。
2. 不编造不存在的事实、数据和案例细节；选题信息有限时，用通用的经验、判断和操作方法展开，不虚构具体数字、人物和事件。
3. 篇幅约 200–400 字（约 1–2 分钟口播）。
4. 结尾可以自然引导互动，但不要出现"结尾引导"这类标签。

请直接输出最终口播文案正文。`;

function renderTopicPrompt(payload: BailianCopyCreationPayload): string {
return topicPromptTemplate
.replaceAll("{{topic}}", (payload.topic ?? "").trim())
.replaceAll("{{styleBlock}}", renderStyleBlock(payload.styleId));
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
const isTopicMode = Boolean(payload.topic?.trim());
if (!isTopicMode && !payload.sourceCopy.trim()) {
throw new Error("请先完成第一步提取文案");
}

const baseUrl = config.bailianBaseUrl.replace(/\/+$/, "");
const url = `${baseUrl}/compatible-mode/v1/chat/completions`;
const prompt = isTopicMode ? renderTopicPrompt(payload) : renderPrompt(payload);

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
