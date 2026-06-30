import { getAgentSecrets } from './agent-secrets.js';
import { env } from '../config/env.js';

export interface EmbeddingConfig {
  apiKey: string;
  model: string;
  baseURL?: string;
}

/**
 * Resolves the embedding provider configuration for an agent.
 *
 * Priority (highest → lowest):
 * 1. Agent secret `openaiEmbeddingKey`       → OpenAI direct (dedicated embedding key)
 * 2. Agent secret `openrouterEmbeddingKey`   → OpenRouter    (dedicated embedding key)
 * 3. Agent secret `openaiKey`                → OpenAI direct (shared with LLM)
 * 4. Global OPENAI_API_KEY                   → OpenAI direct
 * 5. Global OPENROUTER_EMBEDDING_API_KEY     → OpenRouter    (dedicated embedding key)
 * 6. Global OPENROUTER_API_KEY               → OpenRouter    (shared key, last resort)
 *
 * Using separate keys for embeddings vs. chat completions on OpenRouter allows
 * independent rate-limit and budget control per key.
 */
export async function resolveEmbeddingConfig(
  agentId: string,
  embeddingModel: string,
): Promise<EmbeddingConfig> {
  let secrets: Record<string, string> = {};
  try {
    secrets = await getAgentSecrets(agentId);
  } catch {
    // No secrets configured — fall through to global env
  }

  // 1. Agent: dedicated OpenAI embedding key
  if (secrets.openaiEmbeddingKey) {
    return { apiKey: secrets.openaiEmbeddingKey, model: embeddingModel };
  }

  // 2. Agent: dedicated OpenRouter embedding key
  if (secrets.openrouterEmbeddingKey) {
    return {
      apiKey: secrets.openrouterEmbeddingKey,
      model: toOpenRouterModel(embeddingModel),
      baseURL: env.OPENROUTER_BASE_URL,
    };
  }

  // 3. Agent: shared OpenAI key (also used for STT/Whisper)
  if (secrets.openaiKey) {
    return { apiKey: secrets.openaiKey, model: embeddingModel };
  }

  // 4. Global: direct OpenAI key
  if (env.OPENAI_API_KEY) {
    return { apiKey: env.OPENAI_API_KEY, model: embeddingModel };
  }

  // 5. Global: dedicated OpenRouter embedding key
  if (env.OPENROUTER_EMBEDDING_API_KEY) {
    return {
      apiKey: env.OPENROUTER_EMBEDDING_API_KEY,
      model: toOpenRouterModel(embeddingModel),
      baseURL: env.OPENROUTER_BASE_URL,
    };
  }

  // 6. Global: shared OpenRouter key (fallback)
  return {
    apiKey: env.OPENROUTER_API_KEY,
    model: toOpenRouterModel(embeddingModel),
    baseURL: env.OPENROUTER_BASE_URL,
  };
}

/**
 * Ensures the model name has a provider prefix required by OpenRouter.
 * "text-embedding-3-small"        → "openai/text-embedding-3-small"
 * "openai/text-embedding-3-small" → unchanged (already prefixed)
 */
function toOpenRouterModel(model: string): string {
  return model.includes('/') ? model : `openai/${model}`;
}
