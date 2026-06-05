import { formatLogRecordForTest } from './logger';

describe('logger redaction', () => {
  it('redacts sensitive fields in structured log details', () => {
    const record = formatLogRecordForTest('error', 'auth failed', {
      email: 'admin@example.com',
      password: 'secret-password',
      nested: {
        apiToken: 'secret-token',
        sessionSecret: 'secret-session',
      },
    });

    expect(record.detail).toEqual({
      email: 'admin@example.com',
      password: '[REDACTED]',
      nested: {
        apiToken: '[REDACTED]',
        sessionSecret: '[REDACTED]',
      },
    });
  });

  it('serializes errors without dropping the message', () => {
    const record = formatLogRecordForTest('warn', 'operation failed', new Error('network down'));

    expect(record.detail).toMatchObject({
      name: 'Error',
      message: 'network down',
    });
  });
});
