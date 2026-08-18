import type { FeatureKey, QuotaKey } from '../contracts/entitlements.js';

export type ApiErrorCode =
  | 'FEATURE_NOT_AVAILABLE'
  | 'QUOTA_EXCEEDED'
  | 'SUBSCRIPTION_INACTIVE'
  | 'WORKSPACE_ACCESS_DENIED'
  | 'TRIAL_EXPIRED';

export interface ApiErrorDetails {
  feature?: FeatureKey;
  quota?: QuotaKey;
  tenantId?: string;
  plan?: string;
  limit?: number | null;
  used?: number;
  retryAfterSeconds?: number;
}

const DEFAULT_STATUS: Record<ApiErrorCode, number> = {
  FEATURE_NOT_AVAILABLE: 403,
  QUOTA_EXCEEDED: 429,
  SUBSCRIPTION_INACTIVE: 402,
  WORKSPACE_ACCESS_DENIED: 403,
  TRIAL_EXPIRED: 402,
};

const DEFAULT_MESSAGE: Record<ApiErrorCode, string> = {
  FEATURE_NOT_AVAILABLE: 'This feature is not available for the current workspace.',
  QUOTA_EXCEEDED: 'The workspace quota has been exceeded.',
  SUBSCRIPTION_INACTIVE: 'The workspace subscription is inactive.',
  WORKSPACE_ACCESS_DENIED: 'You do not have access to this workspace.',
  TRIAL_EXPIRED: 'The workspace trial has expired.',
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly statusCode: number;
  readonly details: ApiErrorDetails;

  constructor(code: ApiErrorCode, details: ApiErrorDetails = {}, message = DEFAULT_MESSAGE[code]) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = DEFAULT_STATUS[code];
    this.details = details;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function serializeApiError(error: ApiError, requestId: string) {
  return {
    error: {
      code: error.code,
      message: error.message,
      requestId,
      details: error.details,
    },
  };
}
