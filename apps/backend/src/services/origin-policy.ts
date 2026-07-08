export function isOriginAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (allowedOrigins.length === 0) return true;
  if (!origin) return false;
  return allowedOrigins.some((allowed) => {
    const normalizedAllowed = normalizeOrigin(allowed);
    return normalizedAllowed === '*' || normalizedAllowed === origin;
  });
}

function normalizeOrigin(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '*') return trimmed;

  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}

export function isAdminOriginAllowed(
  origin: string | undefined,
  configuredOrigins: string,
): boolean {
  if (!origin) return true;
  const allowed = configuredOrigins.split(',').map(normalizeOrigin).filter(Boolean);
  return allowed.includes(normalizeOrigin(origin));
}
