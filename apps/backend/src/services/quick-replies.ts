export function normalizeQuickReplies(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const replies = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, 100))
    .filter(Boolean);
  return [...new Set(replies)].slice(0, 4);
}
