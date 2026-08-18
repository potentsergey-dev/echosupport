import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/env.js', () => ({
  env: {
    OPENAI_API_KEY: '',
    OPENROUTER_API_KEY: '',
    OPENROUTER_EMBEDDING_API_KEY: '',
    OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
  },
}));

vi.mock('../services/agent-secrets.js', () => ({
  getAgentSecrets: vi.fn().mockResolvedValue({
    openaiEmbeddingKey: 'openai-embeddings-lite',
    openaiKey: 'openai-whisper-pro',
  }),
}));

import { resolveEmbeddingConfig } from '../services/resolve-embedding.js';

describe('resolveEmbeddingConfig', () => {
  it('uses the dedicated OpenAI embeddings key without requiring the Whisper/OpenAI key', async () => {
    await expect(resolveEmbeddingConfig('agent-lite', 'text-embedding-3-small')).resolves.toEqual({
      apiKey: 'openai-embeddings-lite',
      model: 'text-embedding-3-small',
    });
  });
});
