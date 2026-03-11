export const apiErrorCodes = {
  BAD_REQUEST: 'BAD_REQUEST',
  FORBIDDEN: 'FORBIDDEN',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  CONFLICT: 'CONFLICT',
  INVALID_ACTION: 'INVALID_ACTION',
  INVALID_TARGET_TYPE: 'INVALID_TARGET_TYPE',
  DELETION_NOT_ALLOWED: 'DELETION_NOT_ALLOWED',
  DELETION_REQUEST_EXISTS: 'DELETION_REQUEST_EXISTS',
  DELETION_REQUEST_NOT_FOUND: 'DELETION_REQUEST_NOT_FOUND',
  DELETION_REQUEST_ALREADY_PROCESSED: 'DELETION_REQUEST_ALREADY_PROCESSED',
  DELETION_REQUEST_STATE_CHANGED: 'DELETION_REQUEST_STATE_CHANGED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ApiErrorCode = (typeof apiErrorCodes)[keyof typeof apiErrorCodes];

type ApiErrorConfig = {
  code: ApiErrorCode;
  status: number;
  message: string;
  detail?: unknown;
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly detail?: unknown;

  constructor({ code, status, message, detail }: ApiErrorConfig) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

export function createApiError(config: ApiErrorConfig): ApiError {
  return new ApiError(config);
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
