import { ReceiptOcrResult, DetailOcrResult, SwiftOcrResult } from '@/lib/types';

const OCR_MAX_RETRIES = Number(process.env.OCR_MAX_RETRIES || 3);
const OCR_TIMEOUT_MS = Number(process.env.OCR_TIMEOUT_MS || 15000);
const OCR_RETRY_BASE_DELAY_MS = Number(process.env.OCR_RETRY_BASE_DELAY_MS || 1200);
const OCR_INPUT_COST_PER_1K = Number(process.env.OCR_INPUT_COST_PER_1K || 0);
const OCR_OUTPUT_COST_PER_1K = Number(process.env.OCR_OUTPUT_COST_PER_1K || 0);
const OCR_MODEL = process.env.OCR_MODEL || 'gpt-4o-mini';
const OCR_API_BASE_URL = (process.env.OCR_API_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const OCR_API_KEY = process.env.OCR_API_KEY || '';
const OCR_DISABLED = process.env.OCR_DISABLED === 'true';
let ocrDisabledLogged = false;

function ensureDataUrl(imageBase64: string): string {
  if (imageBase64.startsWith('data:')) return imageBase64;
  return `data:image/jpeg;base64,${imageBase64}`;
}

async function createVisionCompletion(prompt: string, imageBase64: string) {
  if (OCR_DISABLED) {
    throw new Error('OCR disabled by OCR_DISABLED=true');
  }
  if (!OCR_API_KEY) {
    throw new Error('OCR_API_KEY is not configured');
  }

  const response = await fetch(`${OCR_API_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OCR_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OCR_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: ensureDataUrl(imageBase64) } },
          ],
        },
      ],
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`OCR provider HTTP ${response.status}: ${text}`);
  }

  return response.json();
}

function canUseOcr(): boolean {
  if (OCR_DISABLED) return false;
  if (!OCR_API_KEY) return false;
  return true;
}

function logOcrDisabledReason(label: string): void {
  if (ocrDisabledLogged) return;
  if (OCR_DISABLED) {
    console.warn(`[OCR:${label}] OCR is disabled by OCR_DISABLED=true, fallback parser will be used`);
  } else if (!OCR_API_KEY) {
    console.warn(`[OCR:${label}] OCR_API_KEY is not configured, fallback parser will be used`);
  }
  ocrDisabledLogged = true;
}

function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  const msg = error.message.toLowerCase();
  return msg.includes('timeout') || msg.includes('timed out') || msg.includes('fetch failed') || msg.includes('network');
}

async function withTimeout<T>(fn: () => Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<T>((_, reject) => {
      const timeoutError = new Error(`${label} request timeout after ${timeoutMs}ms`);
      setTimeout(() => reject(timeoutError), timeoutMs);
    }),
  ]);
}

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastError: unknown;

  for (let i = 0; i < OCR_MAX_RETRIES; i++) {
    try {
      return await withTimeout(fn, OCR_TIMEOUT_MS, label);
    } catch (error) {
      lastError = error;
      console.error(`[OCR:${label}] attempt ${i + 1} failed`, error);

      if (i < OCR_MAX_RETRIES - 1 && isRetryableError(error)) {
        const waitMs = OCR_RETRY_BASE_DELAY_MS * Math.pow(2, i);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }

      break;
    }
  }

  throw (lastError instanceof Error ? lastError : new Error(`[OCR:${label}] unknown failure`));
}

function parseJsonObject<T>(content: string): T | null {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]) as T;
  } catch {
    return null;
  }
}

function logUsage(label: string, response: any): void {
  const usage = response?.usage;
  if (!usage) return;

  const promptTokens = Number(usage.prompt_tokens || 0);
  const completionTokens = Number(usage.completion_tokens || 0);
  const totalTokens = Number(usage.total_tokens || promptTokens + completionTokens);
  const estimatedCost =
    (promptTokens / 1000) * OCR_INPUT_COST_PER_1K +
    (completionTokens / 1000) * OCR_OUTPUT_COST_PER_1K;

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
  if (!canUseOcr()) {
    logOcrDisabledReason(label);
    return fallback;
  }

  try {
    const response = await withRetry(
      () => createVisionCompletion(prompt, imageBase64),
      label
    );

    logUsage(label, response);
    const content = response?.choices?.[0]?.message?.content || '{}';
    const parsed = parseJsonObject<T>(content);
    if (parsed) return parsed;

    console.error(`[OCR:${label}] parse failed, fallback used`, content);
    return fallback;
  } catch (error) {
    console.error(`[OCR:${label}] request failed, fallback used`, error);
    return fallback;
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
  "invNo": "账单号(L**MH开头的编码，如果是定金DEPOSIT则为null)",
  "orderNo": "客户单号(ORDER)",
  "payer": "付款人(recu de M./Mme后面的名字)",
  "isDeposit": 是否为定金(boolean)
}

注意：
1. 如果图片上显示DEPOSIT字样，isDeposit为true
2. 账单号通常是L开头MH结尾的编码
3. 客户单号格式类似XXX-XX，如ROI-25、MAB-1-12等
4. 如果某个字段无法识别，返回null
5. 只返回JSON，不要其他文字`;

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
  "senderName": "汇款人姓名",
  "senderAddress": "汇款人地址",
  "receiverName": "收款人姓名",
  "receiverAccount": "收款人账号"
}

注意：
1. 金额通常是USD或美元金额
2. 日期格式化为YYYY-MM-DD
3. 如果某个字段无法识别，返回null
4. 只返回JSON，不要其他文字`;

  const fallback: SwiftOcrResult = {
    amount: null,
    date: null,
    senderName: null,
    senderAddress: null,
    receiverName: null,
    receiverAccount: null
  };

  return runVisionRequest<SwiftOcrResult>('swift', imageBase64, prompt, fallback);
}
