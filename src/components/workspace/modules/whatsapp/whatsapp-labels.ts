type Translate = (zh: string, en: string) => string;
const labels: Record<string, [string, string]> = {
  PAYMENT_RECEIVED: ['收款通知', 'Payment received'], SHIPMENT: ['出运通知', 'Shipment'], RELEASE: ['放单通知', 'Release'],
  PAYMENT_CORRECTION: ['付款更正', 'Payment correction'], OUTSTANDING_REMINDER: ['欠款提醒', 'Outstanding reminder'],
  PENDING: ['待审核', 'Awaiting approval'], QUEUED: ['排队等待发送', 'Queued'], PAUSED: ['已暂停', 'Paused'],
  SENDING: ['正在提交', 'Submitting'], ACCEPTED: ['平台已受理', 'Accepted by provider'], SENT: ['已发送', 'Sent'],
  DELIVERED: ['已送达', 'Delivered'], READ: ['已读', 'Read'], FAILED: ['发送失败', 'Failed'],
  CANCELLED: ['已取消', 'Cancelled'], UNCERTAIN: ['发送结果待确认', 'Delivery uncertain'],
  DRAFT: ['草稿', 'Draft'], APPROVED: ['审核通过', 'Approved'], REJECTED: ['审核未通过', 'Rejected'],
  SUBMISSION_UNCERTAIN: ['提交结果待确认', 'Submission uncertain'], UNKNOWN: ['审核状态待查询', 'Status not checked'],
  DISABLED: ['平台已停用', 'Disabled by provider'], IN_APPEAL: ['申诉中', 'In appeal'],
  UTILITY: ['业务通知', 'Utility'], MARKETING: ['营销', 'Marketing'], AUTHENTICATION: ['身份验证', 'Authentication'],
};
export function whatsappLabel(value: string, tx: Translate) {
  const label = labels[value];
  return label ? tx(...label) : value;
}
export function whatsappFailure(code: string, tx: Translate) {
  const messages: Record<string, [string, string]> = {
    '131026': ['平台未能送达，不能视为客户上线后会自动收到', 'Provider could not deliver; later delivery is not guaranteed'],
    BALANCE_INSUFFICIENT: ['平台账户余额不足', 'Provider account balance is insufficient'],
    PROVIDER_REJECTED: ['平台拒绝提交', 'Provider rejected submission'],
    REMINDER_IMAGE_FAILED: ['对账图片生成失败', 'Statement image generation failed'],
  };
  const label = messages[code];
  return label ? `${tx(...label)} (${code})` : `${tx('失败代码', 'Failure code')}: ${code}`;
}
const variables: Record<string, [string, string]> = {
  customerName: ['客户名称', 'Customer name'], receiptNo: ['收据编号', 'Receipt number'], receiptNos: ['收据编号', 'Receipt numbers'],
  orderNos: ['订单号', 'Order numbers'], invoiceNo: ['发票号', 'Invoice number'], amount: ['本次收款金额', 'Payment amount'],
  orderBalance: ['关联订单扣款后余额', 'Order balance after payment'], shipmentDate: ['出运日期', 'Shipment date'],
  releaseDate: ['放单日期', 'Release date'], reason: ['更正原因', 'Correction reason'], currentBalance: ['当前余额', 'Current balance'],
  overdueBalance: ['符合提醒条件的欠款金额', 'Eligible outstanding balance'], oldestOrder: ['最早放单的未结清订单', 'Oldest released unpaid order'], days: ['放单后天数', 'Days since release'],
};
export function whatsappVariable(value: string, tx: Translate) {
  return variables[value] ? tx(...variables[value]) : value;
}
