import { getApiErrorCode, getApiErrorMessage, WorkspaceApiError } from '@/components/workspace/api/client';

describe('workspace api client', () => {
  let originalLang = 'zh';

  beforeEach(() => {
    originalLang = document.documentElement.lang;
    document.documentElement.lang = 'en';
  });

  afterEach(() => {
    document.documentElement.lang = originalLang;
  });

  it('prefers error code translation over raw message when available', () => {
    const message = getApiErrorMessage(
      { code: 'FORBIDDEN', error: '无权限' },
      'fallback',
    );

    expect(message).toBe('Permission denied');
    expect(getApiErrorCode({ code: 'FORBIDDEN', error: '无权限' })).toBe('FORBIDDEN');
  });

  it('translates auth-specific error codes', () => {
    const message = getApiErrorMessage(
      { code: 'INVALID_CREDENTIALS', error: '邮箱或密码错误' },
      'fallback',
    );

    expect(message).toBe('Invalid email or password');
  });

  it('appends detail text when requested', () => {
    const message = getApiErrorMessage(
      { code: 'BAD_REQUEST', error: '参数错误', detail: 'field=OCR_DISABLED' },
      'fallback',
      { appendDetail: true },
    );

    expect(message).toBe('Invalid request | field=OCR_DISABLED');
  });

  it('reads WorkspaceApiError instances directly', () => {
    const error = new WorkspaceApiError('Conflict detected', {
      code: 'CONFLICT',
      detail: { key: 'value' },
      status: 409,
    });

    expect(getApiErrorMessage(error, 'fallback')).toBe('Conflict detected');
    expect(getApiErrorCode(error)).toBe('CONFLICT');
  });

  it('falls back to translated raw message when no code exists', () => {
    expect(getApiErrorMessage({ error: '请上传Excel文件' }, 'fallback')).toBe('Please upload an Excel file');
  });
});
