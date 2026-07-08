const MAX_ERROR_MESSAGE_LENGTH = 320;

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [redacted]'],
  [/\b(sk|pk|or)-[A-Za-z0-9_-]{12,}\b/g, '[redacted-key]'],
  [/\bpk_[A-Za-z0-9_-]{8,}\b/g, '[redacted-key]'],
  [/([?&](?:api[_-]?key|key|token|secret|password|authorization)=)[^&#\s]+/gi, '$1[redacted]'],
  [/([a-z][a-z0-9+.-]*:\/\/)([^:@/\s]+):([^@/\s]+)@/gi, '$1[redacted]@'],
  [/\b[A-Za-z0-9_-]{48,}\b/g, '[redacted-token]'],
];

function getErrorName(error: unknown): string {
  if (error instanceof Error && error.name) return error.name;
  if (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    typeof error.name === 'string' &&
    error.name.trim()
  ) {
    return error.name.trim();
  }
  return 'Error';
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.trim()
  ) {
    return error.message.trim();
  }
  if (typeof error === 'string' && error.trim()) return error.trim();
  return 'Unexpected error';
}

export function redactSecrets(value: string): string {
  return SECRET_PATTERNS.reduce(
    (message, [pattern, replacement]) => message.replace(pattern, replacement),
    value,
  );
}

export function sanitizeErrorMessage(error: unknown): string {
  const name = getErrorName(error);
  const message = redactSecrets(getErrorMessage(error)).replace(/\s+/g, ' ').trim();
  const formatted = message.startsWith(`${name}:`) ? message : `${name}: ${message}`;
  return formatted.length > MAX_ERROR_MESSAGE_LENGTH
    ? `${formatted.slice(0, MAX_ERROR_MESSAGE_LENGTH - 1)}…`
    : formatted;
}

export function summarizeError(error: unknown): { name: string; message: string } {
  return {
    name: getErrorName(error),
    message: redactSecrets(getErrorMessage(error)).replace(/\s+/g, ' ').trim(),
  };
}
