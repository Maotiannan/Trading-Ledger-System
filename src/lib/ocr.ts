import { ReceiptOcrResult, DetailOcrResult, SwiftOcrResult } from '@/lib/types';
import { getSystemSettings } from '@/lib/system-settings';
import { normalizeSwiftOcrResult } from '@/lib/swift-normalization';

type OcrConfig = {
  maxRetries: number;
  timeoutMs: number;
  retryBaseDelayMs: number;
  inputCostPer1k: number;
  outputCostPer1k: number;
  model: string;
  apiBaseUrl: string;
  apiKey: string;
  disabled: boolean;
};
let ocrModelOverrideLogged = false;

function normalizeOcrApiBaseUrl(rawValue: string): string {
  let normalized = String(rawValue || '').trim();
  if (!normalized) return 'https://api.openai.com/v1';

  // Allow users to paste full endpoints; strip known suffixes to keep a stable base URL.
  normalized = normalized.replace(/\/+$/, '');
  normalized = normalized.replace(/\/chat\/completions$/i, '');
  normalized = normalized.replace(/\/models$/i, '');
  normalized = normalized.replace(/\/+$/, '');
  return normalized || 'https://api.openai.com/v1';
}

function buildEndpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

const OCR_DEFAULTS = {
  OCR_DISABLED: process.env.OCR_DISABLED ?? 'false',
  OCR_API_BASE_URL: process.env.OCR_API_BASE_URL ?? 'https://api.openai.com/v1',
  OCR_API_KEY: process.env.OCR_API_KEY ?? '',
  OCR_MODEL: process.env.OCR_MODEL ?? 'gpt-4o-mini',
  OCR_MAX_RETRIES: process.env.OCR_MAX_RETRIES ?? '3',
  OCR_TIMEOUT_MS: process.env.OCR_TIMEOUT_MS ?? '60000',
  OCR_RETRY_BASE_DELAY_MS: process.env.OCR_RETRY_BASE_DELAY_MS ?? '1200',
  OCR_INPUT_COST_PER_1K: process.env.OCR_INPUT_COST_PER_1K ?? '0',
  OCR_OUTPUT_COST_PER_1K: process.env.OCR_OUTPUT_COST_PER_1K ?? '0',
};
let ocrDisabledLogged = false;

function isBigModelProvider(baseUrl: string): boolean {
  return /(^https?:\/\/)?([a-z0-9-]+\.)*bigmodel\.cn/i.test(baseUrl);
}

function isVisionModel(model: string): boolean {
  const normalized = String(model || '').toLowerCase();
  return normalized.includes('v') || normalized.includes('vision') || normalized.includes('ocr');
}

function resolveVisionModel(config: OcrConfig): string {
  const normalized = String(config.model || '').trim();
  if (!isBigModelProvider(config.apiBaseUrl)) return normalized;
  if (isVisionModel(normalized)) return normalized;
  if (!ocrModelOverrideLogged) {
    console.warn(`[OCR] BigModel configured with non-vision model "${normalized}", auto-switching to "glm-4.6v" for image OCR`);
    ocrModelOverrideLogged = true;
  }
  return 'glm-4.6v';
}

function prepareImageUrlForProvider(imageBase64: string, config: OcrConfig): string {
  const input = String(imageBase64 || '').trim();
  if (!input) return input;
  if (input.startsWith('http://') || input.startsWith('https://')) return input;
  if (input.startsWith('data:')) return input;
  return ensureDataUrl(input);
}

function ensureDataUrl(imageBase64: string): string {
  if (imageBase64.startsWith('data:')) return imageBase64;
  return `data:image/jpeg;base64,${imageBase64}`;
}


function parseBoolean(value: string): boolean {
  return value.toLowerCase() === 'true';
}

function parseNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

async function getOcrConfig(): Promise<OcrConfig> {
  const keys = Object.keys(OCR_DEFAULTS);
  const overrides = await getSystemSettings(keys);
  const merged = Object.fromEntries(
    keys.map((key) => [key, overrides[key] ?? OCR_DEFAULTS[key as keyof typeof OCR_DEFAULTS]])
  );

  const timeoutMs = Math.max(1000, parseNumber(merged.OCR_TIMEOUT_MS, 60000));
  const normalizedBaseUrl = normalizeOcrApiBaseUrl(merged.OCR_API_BASE_URL || 'https://api.openai.com/v1');
  const effectiveTimeoutMs = isBigModelProvider(normalizedBaseUrl)
    ? Math.max(timeoutMs, 60000)
    : timeoutMs;

  return {
    maxRetries: Math.max(1, parseNumber(merged.OCR_MAX_RETRIES, 3)),
    timeoutMs: effectiveTimeoutMs,
    retryBaseDelayMs: Math.max(100, parseNumber(merged.OCR_RETRY_BASE_DELAY_MS, 1200)),
    inputCostPer1k: Math.max(0, parseNumber(merged.OCR_INPUT_COST_PER_1K, 0)),
    outputCostPer1k: Math.max(0, parseNumber(merged.OCR_OUTPUT_COST_PER_1K, 0)),
    model: merged.OCR_MODEL || 'gpt-4o-mini',
    apiBaseUrl: normalizedBaseUrl,
    apiKey: merged.OCR_API_KEY || '',
    disabled: parseBoolean(merged.OCR_DISABLED || 'false'),
  };
}

async function createVisionCompletion(
  prompt: string,
  imageBase64: string,
  config: OcrConfig,
  signal?: AbortSignal
) {
  if (config.disabled) {
    throw new Error('OCR disabled by OCR_DISABLED=true');
  }
  if (!config.apiKey) {
    throw new Error('OCR_API_KEY is not configured');
  }

  const model = resolveVisionModel(config);
  const imageUrl = prepareImageUrlForProvider(imageBase64, config);
  const body: Record<string, unknown> = {
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      },
    ],
    temperature: 0,
  };
  // GLM-4.6V supports configurable thinking mode; OCR extraction is faster with thinking disabled.
  if (isBigModelProvider(config.apiBaseUrl)) {
    body.thinking = { type: 'disabled' };
  }

  const response = await fetch(buildEndpoint(config.apiBaseUrl, '/chat/completions'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`OCR provider HTTP ${response.status}: ${text}`);
  }

  return response.json();
}

async function probeProviderModels(
  config: OcrConfig,
  signal?: AbortSignal
): Promise<{ modelExists: boolean; total: number; available: string[] }> {
  const response = await fetch(buildEndpoint(config.apiBaseUrl, '/models'), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`OCR provider HTTP ${response.status}: ${text}`);
  }

  const json = await response.json().catch(() => ({}));
  const data = Array.isArray(json?.data) ? json.data : [];
  const available = data
    .map((m: { id?: string }) => String(m?.id || '').trim())
    .filter((id: string) => Boolean(id));
  const modelExists = available.some((id) => id.toLowerCase() === config.model.toLowerCase());
  return { modelExists, total: data.length, available };
}

async function probeModelCompletion(config: OcrConfig, signal?: AbortSignal): Promise<boolean> {
  const model = resolveVisionModel(config);
  const response = await fetch(buildEndpoint(config.apiBaseUrl, '/chat/completions'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    signal,
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: '请仅返回OK' }],
      temperature: 0,
      ...(isBigModelProvider(config.apiBaseUrl) ? { thinking: { type: 'disabled' } } : {}),
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`OCR provider HTTP ${response.status}: ${text}`);
  }
  const json = await response.json().catch(() => ({}));
  const content = String(json?.choices?.[0]?.message?.content || '').trim();
  return Boolean(content);
}

function canUseOcr(config: OcrConfig): boolean {
  if (config.disabled) return false;
  if (!config.apiKey) return false;
  return true;
}

function logOcrDisabledReason(label: string, config: OcrConfig): void {
  if (ocrDisabledLogged) return;
  if (config.disabled) {
    console.warn(`[OCR:${label}] OCR is disabled by OCR_DISABLED=true, fallback parser will be used`);
  } else if (!config.apiKey) {
    console.warn(`[OCR:${label}] OCR_API_KEY is not configured, fallback parser will be used`);
  }
  ocrDisabledLogged = true;
}

function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  const msg = error.message.toLowerCase();
  return msg.includes('timeout') || msg.includes('timed out') || msg.includes('fetch failed') || msg.includes('network');
}

async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(`${label} request timeout after ${timeoutMs}ms`), timeoutMs);
  try {
    return await fn(controller.signal);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`${label} request timeout after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function withRetry<T>(fn: (signal: AbortSignal) => Promise<T>, label: string, config: OcrConfig): Promise<T> {
  let lastError: unknown;

  for (let i = 0; i < config.maxRetries; i++) {
    try {
      return await withTimeout(fn, config.timeoutMs, label);
    } catch (error) {
      lastError = error;
      console.error(`[OCR:${label}] attempt ${i + 1} failed`, error);

      if (i < config.maxRetries - 1 && isRetryableError(error)) {
        const waitMs = config.retryBaseDelayMs * Math.pow(2, i);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }

      break;
    }
  }

  throw (lastError instanceof Error ? lastError : new Error(`[OCR:${label}] unknown failure`));
}

function parseJsonObject<T>(content: string): T | null {
  const parseCandidate = (raw: string): T | null => {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  };

  const sanitizeUnescapedInnerQuotes = (raw: string): string => {
    let out = '';
    let inString = false;
    let escaped = false;

    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];

      if (!inString) {
        out += ch;
        if (ch === '"') {
          inString = true;
          escaped = false;
        }
        continue;
      }

      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }

      if (ch === '\\') {
        out += ch;
        escaped = true;
        continue;
      }

      if (ch === '"') {
        let j = i + 1;
        while (j < raw.length && /\s/.test(raw[j])) j++;
        const next = raw[j];
        // 合法结束引号: key 后面接冒号，value 后面接逗号/右花括号/右中括号
        if (next === ':' || next === ',' || next === '}' || next === ']' || next === undefined) {
          out += ch;
          inString = false;
        } else {
          // 字符串内部未转义双引号，替换为单引号以提高容错
          out += "'";
        }
        continue;
      }

      out += ch;
    }

    return out;
  };

  try {
    const cleaned = content.replace(/```json|```/gi, '');
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const strictParsed = parseCandidate(jsonMatch[0]);
    if (strictParsed) return strictParsed;

    const repaired = sanitizeUnescapedInnerQuotes(jsonMatch[0]);
    return parseCandidate(repaired);
  } catch {
    return null;
  }
}

function logUsage(label: string, response: any, config: OcrConfig): void {
  const usage = response?.usage;
  if (!usage) return;

  const promptTokens = Number(usage.prompt_tokens || 0);
  const completionTokens = Number(usage.completion_tokens || 0);
  const totalTokens = Number(usage.total_tokens || promptTokens + completionTokens);
  const estimatedCost =
    (promptTokens / 1000) * config.inputCostPer1k +
    (completionTokens / 1000) * config.outputCostPer1k;

  console.log(
    `[OCR:${label}] usage prompt=${promptTokens} completion=${completionTokens} total=${totalTokens} estimated_cost=${estimatedCost.toFixed(6)}`
  );
}

async function runVisionRequest<T>(
  label: string,
  imageBase64: string,
  prompt: string,
  fallback: T
): Promise<T> {
  const config = await getOcrConfig();

  if (!canUseOcr(config)) {
    logOcrDisabledReason(label, config);
    return fallback;
  }

  try {
    const response = await withRetry(
      (signal) => createVisionCompletion(prompt, imageBase64, config, signal),
      label,
      config
    );

    logUsage(label, response, config);
    const content = response?.choices?.[0]?.message?.content || '{}';
    const parsed = parseJsonObject<T>(content);
    if (parsed) return parsed;

    console.error(`[OCR:${label}] parse failed`, content);
    throw new Error(`OCR响应解析失败，请检查模型输出格式`);
  } catch (error) {
    console.error(`[OCR:${label}] request failed`, error);
    throw (error instanceof Error ? error : new Error('OCR识别失败'));
  }
}

// 识别收据(RECEIPT)
export async function recognizeReceipt(imageBase64: string): Promise<ReceiptOcrResult> {
  const prompt = `请识别这张收据图片并提取以下信息，以JSON格式返回：
{
  "receiptNo": "收据号(No.后面的字符串)",
  "date": "日期(格式: YYYY-MM-DD)",
  "tel": "电话号码(Tel)",
  "usd": 付款金额(数字，不含货币符号),
  "invNo": "账单号(通常是L25MH...这类L+年份+MH开头的编码；如果是定金DEPOSIT或图片没有发票号则为null)",
  "orderNo": "客户单号(ORDER)",
  "payer": "付款人(recu de M./Mme后面的名字)",
  "isDeposit": 是否为定金(boolean),
  "motif": "Motif整行文字，用于从Payment for/Initial payment for/Final payment for后提取ORDER NO"
}

注意：
1. isDeposit只有图片明确写有DEPOSIT/Deposit/Acompte/Advance deposit这类定金字样时才为true；Initial payment不是DEPOSIT
2. 账单号通常是L25MH...这类编码
3. 客户单号经常写在Motif行，例如Payment for Rahim-11、Initial payment for MAB-1-10、Final payment for PIKIN-23/PIKIN-19C；请优先从Motif行的for后面提取orderNo
4. 如果Motif行同时包含账单号和客户单号，例如Payment for L25MH060523 Big Alpha-07，必须返回invNo=L25MH060523且orderNo=Big Alpha-07；如果Motif行只有客户单号，则invNo返回null
5. 如果某个字段无法识别，返回null
6. 只返回JSON，不要其他文字`;

  const fallback: ReceiptOcrResult = {
    receiptNo: null,
    date: null,
    tel: null,
    usd: null,
    invNo: null,
    orderNo: null,
    payer: null,
    isDeposit: false
  };

  return runVisionRequest<ReceiptOcrResult>('receipt', imageBase64, prompt, fallback);
}

// 识别付款明细(DETAIL)
export async function recognizeDetail(imageBase64: string): Promise<DetailOcrResult> {
  const prompt = `请识别这张付款明细图片并提取以下信息，以JSON格式返回：
{
  "date": "明细创建日期(格式: YYYY-MM-DD)",
  "items": [
    {
      "mark": "客户唛头(客户名称缩写)",
      "orderNo": "单号(如RAHIM-08)",
      "amount": 金额(数字)
    }
  ]
}

注意：
1. 每一行明细包含唛头、单号和金额
2. 唛头通常是客户名称缩写，如RAHIM
3. 单号格式通常是"唛头-数字"，如RAHIM-08
4. 金额是数字，不含货币符号
5. 识别所有可见的明细行
6. 只返回JSON，不要其他文字`;

  const fallback: DetailOcrResult = {
    date: null,
    items: []
  };

  return runVisionRequest<DetailOcrResult>('detail', imageBase64, prompt, fallback);
}

// 识别SWIFT水单
export async function recognizeSwift(imageBase64: string): Promise<SwiftOcrResult> {
  const prompt = `请识别这张SWIFT转账水单图片并提取以下信息，以JSON格式返回：
{
  "amount": 汇款金额(数字，不含货币符号),
  "date": "汇款日期(格式: YYYY-MM-DD)",
  "senderName": "业务付款人姓名（优先取报文正文 Block 4 里的 :50K: 字段，不要取报文头 Sender BIC）",
  "senderAddress": "业务付款人地址（取 :50K: 后续地址行）",
  "receiverName": "业务收款人名称（优先取报文正文 Block 4 里的 :59: 收款方名称，不要取报文头 Receiver BIC）",
  "receiverAccount": "业务收款人银行账号（取 :59: 账号部分）"
}

注意：
1. 必须优先解析报文正文 Message Text / Block 4 里的业务字段，而不是报文头里的 Sender/Receiver BIC。
2. :50K: 表示业务付款人；其第一行是付款人姓名，后续行合并为付款人地址。
3. :59: 表示业务收款人；账号部分放入 receiverAccount，名称行合并为 receiverName。
4. 金额优先取 :32A: 或正文中最明确的业务汇款金额，返回数字，不含货币符号和千位分隔。
5. 日期优先取 Value Date / :32A: 日期，并格式化为 YYYY-MM-DD。
6. 如果某个字段无法识别，返回 null。
7. 只返回JSON，不要其他文字。`;

  const fallback: SwiftOcrResult = {
    amount: null,
    date: null,
    senderName: null,
    senderAddress: null,
    receiverName: null,
    receiverAccount: null
  };

  const raw = await runVisionRequest<SwiftOcrResult>('swift', imageBase64, prompt, fallback);
  return normalizeSwiftOcrResult(raw);
}

export async function testOcrConnectivity(): Promise<{ success: boolean; message: string; detail?: string }> {
  const config = await getOcrConfig();
  if (config.disabled) {
    return { success: false, message: 'OCR_DISABLED=true，当前已禁用OCR' };
  }
  if (!config.apiKey) {
    return { success: false, message: 'OCR_API_KEY 未配置' };
  }

  try {
    const effectiveModel = resolveVisionModel(config);
    const probe = await withRetry(
      (signal) => probeProviderModels(config, signal),
      'settings-ocr-test',
      config
    );
    const preview = probe.available.slice(0, 8).join(', ');
    const listedModelExists = probe.available.some((id) => id.toLowerCase() === effectiveModel.toLowerCase());
    let modelUsable = listedModelExists;
    let visionProbeNote = '';
    if (!modelUsable) {
      try {
        modelUsable = await withRetry(
          (signal) => probeModelCompletion({ ...config, model: effectiveModel }, signal),
          'settings-ocr-vision-probe',
          config
        );
        if (modelUsable) {
          visionProbeNote = '；/models 未列出该模型，但 chat/completions 实测调用成功';
        }
      } catch (probeError) {
        const reason = probeError instanceof Error ? probeError.message : 'unknown';
        visionProbeNote = `；视觉实测调用失败：${reason}`;
      }
    }
    const modelsEndpoint = buildEndpoint(config.apiBaseUrl, '/models');
    const chatEndpoint = buildEndpoint(config.apiBaseUrl, '/chat/completions');
    const detail = modelUsable
      ? `configuredModel=${config.model}，effectiveModel=${effectiveModel} 可用，provider models=${probe.total}，available=[${preview}]，modelsEndpoint=${modelsEndpoint}，chatEndpoint=${chatEndpoint}${visionProbeNote}`
      : `已连通 provider，但模型不可用（effectiveModel=${effectiveModel}，configuredModel=${config.model}，models=${probe.total}，available=[${preview}]，modelsEndpoint=${modelsEndpoint}，chatEndpoint=${chatEndpoint}${visionProbeNote}）`;
    return {
      success: modelUsable,
      message: modelUsable
        ? 'OCR配置连通成功'
        : 'OCR配置已连通，但模型不可用',
      detail,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'unknown error';
    return {
      success: false,
      message: `OCR连接失败（model=${config.model}）`,
      detail: msg,
    };
  }
}
