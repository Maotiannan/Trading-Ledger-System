import {
  normalizeApiErrorLocale,
  translateApiErrorCode,
  translateApiErrorMessage,
} from '@/lib/api-error-catalog';

describe('api-error-catalog', () => {
  it('normalizes unsupported locales to zh', () => {
    expect(normalizeApiErrorLocale('fr')).toBe('zh');
    expect(normalizeApiErrorLocale(null)).toBe('zh');
  });

  it('translates known error codes to english', () => {
    expect(translateApiErrorCode('FORBIDDEN', '无权限', 'en')).toBe('Permission denied');
  });

  it('translates dynamic chinese message fragments to english', () => {
    expect(
      translateApiErrorMessage('SWIFT_REJECT_TOLERANCE 不能小于 SWIFT_WARNING_TOLERANCE', 'en'),
    ).toBe('SWIFT_REJECT_TOLERANCE cannot be lower than SWIFT_WARNING_TOLERANCE');
  });

  it('translates duplicate receipt number messages to english', () => {
    expect(
      translateApiErrorMessage('收据号 0001001 已存在，请换一个编号', 'en'),
    ).toBe('Receipt No. 0001001 already exists, please choose another number');
  });

  it('translates pending signed-receipt draft consistency errors to english', () => {
    expect(
      translateApiErrorMessage('待签字收据缺少有效签字会话，无法修改', 'en'),
    ).toBe('This pending signed receipt has no active signing session and cannot be edited.');
  });

  it('translates transfer-aware receipt edit confirmation to english', () => {
    expect(
      translateApiErrorMessage('该收据已发生余额转移。请确认撤销转移后再修改收据。', 'en'),
    ).toBe('This receipt has an existing balance transfer. Confirm reversal before editing the receipt.');
  });

  it.each([
    ['邮件外发功能尚未启用', 'Outbound email is not enabled'],
    ['客户尚未配置通知邮箱', 'The customer has no notification email'],
    ['邮件任务已审批或状态已变化', 'The email task was already approved or its status changed'],
    ['该邮件可能已经发出，确认承担重复发送风险后才能重试', 'This email may already have been sent. Confirm before retrying.'],
    ['邮件服务或发件人尚未正确配置', 'The email provider or sender is not configured'],
  ])('translates email management error "%s"', (message, expected) => {
    expect(translateApiErrorMessage(message, 'en')).toBe(expected);
  });
});
