type LogLevel = 'info' | 'warn' | 'error';

type LogRecord = {
  level: LogLevel;
  message: string;
  detail?: unknown;
  timestamp: string;
};

const SENSITIVE_KEY_PATTERN = /(password|token|secret|authorization|cookie|apikey|api_key|session)/i;

function redactLogValue(value: unknown, depth = 0): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }

  if (depth > 6) {
    return '[TRUNCATED]';
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactLogValue(item, depth + 1));
  }

  const record: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
    record[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : redactLogValue(entryValue, depth + 1);
  }
  return record;
}

function formatLogRecord(level: LogLevel, message: string, detail?: unknown): LogRecord {
  return {
    level,
    message,
    ...(detail === undefined ? {} : { detail: redactLogValue(detail) }),
    timestamp: new Date().toISOString(),
  };
}

function writeLog(level: LogLevel, message: string, detail?: unknown) {
  const record = formatLogRecord(level, message, detail);
  const output = JSON.stringify(record);
  if (level === 'error') {
    console.error(output);
    return;
  }
  if (level === 'warn') {
    console.warn(output);
    return;
  }
  console.info(output);
}

export const logger = {
  info: (message: string, detail?: unknown) => writeLog('info', message, detail),
  warn: (message: string, detail?: unknown) => writeLog('warn', message, detail),
  error: (message: string, detail?: unknown) => writeLog('error', message, detail),
};

export function formatLogRecordForTest(level: LogLevel, message: string, detail?: unknown): LogRecord {
  return formatLogRecord(level, message, detail);
}
