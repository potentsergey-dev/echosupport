import { describe, expect, it } from 'vitest';
import { buildMessages } from '../services/prompt-builder.js';

describe('prompt builder', () => {
  it('requires explicit slot confirmation before creating bookings', () => {
    const messages = buildMessages({
      agentSystemPrompt: 'You are a salon assistant.',
      chunks: [],
      history: [],
      summary: null,
      userText: 'Хочу записаться к Анне на Signature cut на этой неделе.',
    });

    const systemPrompt = String(messages[0]?.content ?? '');
    expect(systemPrompt).toContain(
      'Create an appointment only after the visitor has explicitly chosen or confirmed one exact local date and start time.',
    );
    expect(systemPrompt).toContain(
      'call find_available_slots, offer 2 to 4 concrete local options',
    );
    expect(systemPrompt).toContain('do not choose a slot or create the booking yourself');
  });
});
