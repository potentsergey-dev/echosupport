export function isOriginAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (allowedOrigins.length === 0) return true;
  if (!origin) return false;
  return allowedOrigins.some((allowed) => allowed === origin || allowed === '*');
}

export function isAdminOriginAllowed(
  origin: string | undefined,
  configuredOrigins: string,
): boolean {
  if (!origin) return true;
  const allowed = configuredOrigins
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return allowed.includes(origin);
}
