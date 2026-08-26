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
});
