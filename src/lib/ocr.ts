import ZAI from 'z-ai-web-dev-sdk';
import { ReceiptOcrResult, DetailOcrResult, SwiftOcrResult } from '@/lib/types';

let zaiInstance: Awaited<ReturnType<typeof ZAI.create>> | null = null;

async function getZai() {
  if (!zaiInstance) {
    zaiInstance = await ZAI.create();
  }
  return zaiInstance;
}

// 重试包装函数
async function withRetry<T>(fn: () => Promise<T>, maxRetries: number = 3, delayMs: number = 1000): Promise<T> {
  let lastError: Error | null = null;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      console.error(`Attempt ${i + 1} failed:`, error);
      
      // 如果是网络超时错误，等待后重试
      if (error instanceof Error && (
        error.message.includes('timeout') || 
        error.message.includes('Timeout') ||
        error.message.includes('fetch failed')
      )) {
        if (i < maxRetries - 1) {
          console.log(`Retrying in ${delayMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          delayMs *= 2; // 指数退避
          continue;
        }
      }
      
      // 其他错误直接抛出
      throw error;
    }
  }
  
  throw lastError;
}

// 识别收据(RECEIPT)
export async function recognizeReceipt(imageBase64: string): Promise<ReceiptOcrResult> {
  const zai = await getZai();

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

  const response = await withRetry(() => zai.chat.completions.createVision({
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageBase64 } }
        ]
      }
    ],
    thinking: { type: 'disabled' }
  }), 3, 2000);

  const content = response.choices[0]?.message?.content || '{}';

  try {
    // 尝试解析JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as ReceiptOcrResult;
    }
  } catch {
    console.error('Failed to parse receipt OCR result:', content);
  }

  return {
    receiptNo: null,
    date: null,
    tel: null,
    usd: null,
    invNo: null,
    orderNo: null,
    payer: null,
    isDeposit: false
  };
}

// 识别付款明细(DETAIL)
export async function recognizeDetail(imageBase64: string): Promise<DetailOcrResult> {
  const zai = await getZai();

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

  const response = await withRetry(() => zai.chat.completions.createVision({
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageBase64 } }
        ]
      }
    ],
    thinking: { type: 'disabled' }
  }), 3, 2000);

  const content = response.choices[0]?.message?.content || '{}';

  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as DetailOcrResult;
    }
  } catch {
    console.error('Failed to parse detail OCR result:', content);
  }

  return {
    date: null,
    items: []
  };
}

// 识别SWIFT水单
export async function recognizeSwift(imageBase64: string): Promise<SwiftOcrResult> {
  const zai = await getZai();

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

  const response = await withRetry(() => zai.chat.completions.createVision({
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageBase64 } }
        ]
      }
    ],
    thinking: { type: 'disabled' }
  }), 3, 2000);

  const content = response.choices[0]?.message?.content || '{}';

  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as SwiftOcrResult;
    }
  } catch {
    console.error('Failed to parse SWIFT OCR result:', content);
  }

  return {
    amount: null,
    date: null,
    senderName: null,
    senderAddress: null,
    receiverName: null,
    receiverAccount: null
  };
}
