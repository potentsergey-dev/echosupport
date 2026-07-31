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
      'call find_available_slots for the selected specialist/service, offer 2 to 4 concrete local options',
    );
    expect(systemPrompt).toContain('do not choose a slot or create the booking yourself');
  });

  it('preserves the selected specialist and service during booking', () => {
    const messages = buildMessages({
      agentSystemPrompt: 'You are a salon assistant.',
      chunks: [],
      history: [
        {
          role: 'USER',
          content: 'Хочу записаться к Анне на Signature cut на этой неделе.',
        },
        {
          role: 'ASSISTANT',
          content: 'У Анны есть несколько вариантов. Какой подходит?',
        },
      ],
      summary: null,
      userText: 'А что насчет Анны?',
    });

    const systemPrompt = String(messages[0]?.content ?? '');
    expect(systemPrompt).toContain(
      "Preserve the visitor's selected specialist and service throughout the booking conversation",
    );
    expect(systemPrompt).toContain('never silently switch to another specialist');
    expect(systemPrompt).toContain(
      'keep the same specialist/service and search or offer other slots for them',
    );
  });
});
