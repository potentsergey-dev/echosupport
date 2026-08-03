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

  it('requires clarification when specialist names or surnames are ambiguous', () => {
    const messages = buildMessages({
      agentSystemPrompt: 'You are a salon assistant.',
      chunks: [],
      history: [],
      summary: null,
      userText: 'Хочу записаться к Анне.',
    });

    const systemPrompt = String(messages[0]?.content ?? '');
    expect(systemPrompt).toContain(
      'If a provided name or surname matches more than one active specialist',
    );
    expect(systemPrompt).toContain('do not guess by first name or surname');
    expect(systemPrompt).toContain('ask a clarifying question');
  });

  it('handles inflected specialist names and asks for service after specialist changes', () => {
    const messages = buildMessages({
      agentSystemPrompt: 'You are a salon assistant.',
      chunks: [],
      history: [
        {
          role: 'USER',
          content: 'Хочу записаться к Анне на Signature cut на этой неделе.',
        },
      ],
      summary: null,
      userText: 'А к Еве на 2 августа можно записаться?',
    });

    const systemPrompt = String(messages[0]?.content ?? '');
    expect(systemPrompt).toContain(
      'Match specialist names flexibly across normal inflected forms and nicknames',
    );
    expect(systemPrompt).toContain('using the matchingHints returned by list_specialists');
    expect(systemPrompt).toContain('Russian "к Еве" should be treated as "Ева"');
    expect(systemPrompt).toContain(
      'If the visitor explicitly changes the specialist but does not specify a service',
    );
    expect(systemPrompt).toContain('ask which service they want before checking slots');
  });
  it('treats returned group slots as authoritative on confirmation', () => {
    const messages = buildMessages({
      agentSystemPrompt: 'You are a salon assistant.',
      chunks: [
        {
          content: 'Group classes are available only in separately pre-created sessions.',
          sourceType: 'FILE',
          sourceLabel: 'booking-rules.md',
          score: 0.9,
        },
      ],
      history: [
        { role: 'USER', content: 'Меня зовут Сергей, телефон +375290000099.' },
        { role: 'ASSISTANT', content: 'Доступно 2 августа с 11:00 до 12:00.' },
      ],
      summary: null,
      userText: 'Да, это время подойдет, запиши.',
    });

    const systemPrompt = String(messages[0]?.content ?? '');
    expect(systemPrompt).toContain('Every slot returned by find_available_slots is authoritative');
    expect(systemPrompt).toContain('including group services');
    expect(systemPrompt).toContain(
      'call create_appointment_request using contact details already supplied earlier',
    );
    expect(systemPrompt).toContain('override conflicting general Knowledge Base text');
  });
  it('guides group booking with participant count and neutral slot wording', () => {
    const messages = buildMessages({
      agentSystemPrompt: 'You are a salon assistant.',
      chunks: [],
      history: [],
      summary: null,
      userText: 'Могу я записаться к Еве на Face practice?',
    });

    const systemPrompt = String(messages[0]?.content ?? '');
    expect(systemPrompt).toContain('do not start with apologetic phrases like "К сожалению"');
    expect(systemPrompt).toContain(
      'ask whether the visitor is booking only themselves or several people',
    );
    expect(systemPrompt).toContain('pass the total count as group_participants');
    expect(systemPrompt).toContain('requested group_participants is greater than remainingSeats');
    expect(systemPrompt).toContain('Every appointment must include the selected service');
  });
  it('resets an earlier date when the visitor switches services', () => {
    const messages = buildMessages({
      agentSystemPrompt: 'You are a salon assistant.',
      chunks: [],
      history: [
        { role: 'USER', content: 'На завтра есть Dimensional color?' },
        { role: 'ASSISTANT', content: 'На завтра есть варианты у Марии.' },
      ],
      summary: null,
      userText: 'Хочу записаться к Еве на Face practice.',
    });
    const systemPrompt = String(messages[0]?.content ?? '');
    expect(systemPrompt).toContain(
      'discard the previous specialist, date, slot, and group-participant context',
    );
    expect(systemPrompt).toContain('Do not reuse an earlier “tomorrow”, weekday, or date');
    expect(systemPrompt).toContain(
      'do not claim availability, working days, or unavailable slots without a booking-tool result',
    );
  });
});
