import { describe, expect, it } from 'vitest';
import { visibleSecretFieldsForPlan } from './AgentSettingsPage';

describe('agent secret feature gates', () => {
  it('keeps dedicated OpenAI embeddings available in Lite without voice.stt', () => {
    const liteKeys = visibleSecretFieldsForPlan(false).map((field) => field.key);
    const liteLabels = visibleSecretFieldsForPlan(false).map((field) => field.label);

    expect(liteKeys).toEqual(['openrouterKey', 'openrouterEmbeddingKey', 'openaiEmbeddingKey']);
    expect(liteLabels.join('\n')).toContain('OpenRouter / compatible API Key (чат)');
    expect(liteLabels.join('\n')).toContain('OpenRouter / compatible API Key (embeddings)');
    expect(liteLabels.join('\n')).toContain('OpenAI API Key (только embeddings)');
    expect(liteKeys).not.toContain('openaiKey');
    expect(liteKeys).not.toContain('deepgramKey');
  });

  it('shows Whisper/OpenAI STT keys only when voice.stt is available', () => {
    const proKeys = visibleSecretFieldsForPlan(true).map((field) => field.key);

    expect(proKeys).toContain('openaiKey');
    expect(proKeys).toContain('deepgramKey');
    expect(proKeys).toContain('openaiEmbeddingKey');
  });
});
