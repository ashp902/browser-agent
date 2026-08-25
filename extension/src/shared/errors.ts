// Typed local error taxonomy (docs/01 §15).
//
// LocalError objects are safe to surface to the user/model: messages are
// human-readable and never contain stack traces, page content, or extension
// internals (docs/10 §9).

export type LocalErrorCode =
  | 'NO_ACTIVE_TAB'
  | 'UNSUPPORTED_URL'
  | 'PERMISSION_REQUIRED'
  | 'CONTENT_RUNTIME_UNAVAILABLE'
  | 'DOCUMENT_CHANGED'
  | 'RPC_VALIDATION_FAILED'
  | 'LOCAL_TIMEOUT'
  | 'ACTION_FAILED'
  | 'INTERNAL_EXTENSION_ERROR';

export interface LocalError {
  code: LocalErrorCode;
  message: string;
  retryable?: boolean;
}

export function localError(code: LocalErrorCode, message: string, retryable?: boolean): LocalError {
  return retryable === undefined ? { code, message } : { code, message, retryable };
}

export function isLocalError(value: unknown): value is LocalError {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.code === 'string' && typeof candidate.message === 'string';
}

/**
 * Normalizes an arbitrary thrown value into a safe LocalError. The raw error is
 * only meaningful in development logs; callers must not forward raw exception
 * text to the model (docs/10 §9).
 */
export function normalizeUnknownError(error: unknown, fallbackMessage: string): LocalError {
  if (isLocalError(error)) return error;
  return localError('INTERNAL_EXTENSION_ERROR', fallbackMessage);
}
