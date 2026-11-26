import { defaultLocale, type SupportedLocale } from '@/lib/i18n';

type LocalizedMessage = Record<SupportedLocale, string>;

type BusinessMessageRule = {
  match: RegExp;
  message: LocalizedMessage;
};

const exactMessages: Record<string, LocalizedMessage> = {
  '旧 SWIFT 容差已停用，请刷新后使用每张手续费上限': {
    zh: '旧 SWIFT 容差已停用，请刷新后使用每张手续费上限', en: 'The old SWIFT tolerances were retired. Refresh and use the per-copy fee limit.',
  },
  '请在收货人管理中修改收货人或默认项': {
    zh: '请在收货人管理中修改收货人或默认项', en: 'Use CONSIGNEE Management to change consignees or the default.',
  },
  'Customer details on a source invoice are read-only. Use Customer Management.': {
    zh: '来源账单的客户资料为只读，请在客户管理中维护。', en: 'Customer details on a source invoice are read-only. Use Customer Management.',
  },
  'Invalid invoice number. System pool names cannot be used.': {
    zh: 'INV NO 不能为空、超过191个字符或包含控制字符，也不能使用系统资金池名称。',
    en: 'Invalid invoice number. Use 1-191 characters without control characters or system pool names.',
  },
  'Invoice ID and current invoice number are required.': {
    zh: '缺少发票 ID 或原 INV NO，请刷新后重试。', en: 'Invoice ID and current invoice number are required. Refresh and retry.',
  },
  'Invoice number is already occupied.': {
    zh: '此 INV NO 已被其他发票使用。', en: 'Invoice number is already occupied.',
  },
  'Invoice number has changed. Refresh before editing.': {
    zh: 'INV NO 已被修改，请刷新后重新编辑。', en: 'Invoice number has changed. Refresh before editing.',
  },
  'Complete or cancel the pending invoice generation before editing locally.': {
    zh: '请先完成或取消正在进行的发票生成，再修改 INV NO。', en: 'Complete or cancel the pending invoice generation before editing locally.',
  },
  '请选择付款代理': {
    zh: '请选择付款代理',
    en: 'Please select a payment agent.',
  },
  '公司名称不能为空': {
    zh: '公司名称不能为空',
    en: 'Company name is required.',
  },
  '无权限维护付款代理': {
    zh: '无权限维护付款代理',
    en: 'You do not have permission to manage payment agents.',
  },
  '付款代理不存在': {
    zh: '付款代理不存在',
    en: 'Payment agent not found.',
  },
  '无权修改该付款代理': {
    zh: '无权修改该付款代理',
    en: 'You do not have permission to edit this payment agent.',
  },
  '无权使用该付款代理': {
    zh: '无权使用该付款代理',
    en: 'You do not have permission to use this payment agent.',
  },
  '付款代理已创建': {
    zh: '付款代理已创建',
    en: 'Payment agent created.',
  },
  '付款代理已更新': {
    zh: '付款代理已更新',
    en: 'Payment agent updated.',
  },
  '付款代理已删除': {
    zh: '付款代理已删除',
    en: 'Payment agent deleted.',
  },
  '付款代理附件已上传': {
    zh: '付款代理附件已上传',
    en: 'Payment agent file uploaded.',
  },
  '付款代理附件不存在': {
    zh: '付款代理附件不存在',
    en: 'Payment agent file not found.',
  },
  '请选择付款代理后再确认创建': {
    zh: '请选择付款代理后再确认创建',
    en: 'Select a payment agent before confirming creation.',
  },
  '上传付款代理文件失败': {
    zh: '上传付款代理文件失败',
    en: 'Failed to upload payment agent file.',
  },
  '保存付款代理失败': {
    zh: '保存付款代理失败',
    en: 'Failed to save payment agent.',
  },
  '删除付款代理失败': {
    zh: '删除付款代理失败',
    en: 'Failed to delete payment agent.',
  },
};

const ruleMessages: BusinessMessageRule[] = [
  {
    match: /^金额差异 .* 超过允许范围\(±\d+(?:\.\d+)?\)，无法通过验证$/,
    message: {
      zh: '与payment details金额差异过大，录入失败',
      en: 'Amount differs too much from the selected payment detail. Record creation failed.',
    },
  },
  {
    match: /^金额差异 .* 超出正常容差\(±\d+(?:\.\d+)?\)，已标红但允许通过$/,
    message: {
      zh: '与payment details金额存在差异，请确认后继续',
      en: 'Amount differs from the selected payment detail. Please review before continuing.',
    },
  },
  {
    match: /^Invalid input: expected number, received NaN$/i,
    message: {
      zh: '录入内容无效，请检查金额和必填字段',
      en: 'Invalid input. Please check numeric and required fields.',
    },
  },
  {
    match: /^AI识别失败：/i,
    message: {
      zh: 'AI识别失败，请重试',
      en: 'AI recognition failed. Please retry.',
    },
  },
];

export function presentBusinessErrorMessage(raw: string, locale: SupportedLocale = defaultLocale): string {
  const message = String(raw || '').trim();
  if (!message) return message;
  if (exactMessages[message]) return exactMessages[message][locale];
  for (const rule of ruleMessages) {
    if (rule.match.test(message)) {
      return rule.message[locale];
    }
  }
  return message;
}
