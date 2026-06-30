import { prisma } from '../db/prisma.js';
import { decrypt } from './crypto.js';

interface CacheEntry {
  secrets: Record<string, string>;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Returns decrypted secrets for an agent, using an in-memory cache (TTL: 5 min).
 */
export async function getAgentSecrets(agentId: string): Promise<Record<string, string>> {
  const now = Date.now();
  const cached = cache.get(agentId);
  if (cached && cached.expiresAt > now) {
    return cached.secrets;
  }

  const agent = await prisma.agent.findUniqueOrThrow({
    where: { id: agentId },
    select: { encryptedSecrets: true },
  });

  if (!agent.encryptedSecrets) {
    return {};
  }

  const encrypted = agent.encryptedSecrets as Record<string, string>;
  const secrets: Record<string, string> = {};
  for (const [key, value] of Object.entries(encrypted)) {
    secrets[key] = decrypt(value);
  }

  cache.set(agentId, { secrets, expiresAt: now + TTL_MS });
  return secrets;
}

/**
 * Invalidates the cached secrets for an agent (call after updating secrets).
 */
export function clearAgentSecretsCache(agentId: string): void {
  cache.delete(agentId);
}
