import { describe, expect, it } from 'vitest';
import { isExplicitHandoffRequest } from '../services/handoff-intent.js';

describe('explicit handoff intent detection', () => {
  it('does not escalate ordinary product or agent questions', () => {
    expect(isExplicitHandoffRequest('Что может EchoSupport?')).toBe(false);
    expect(isExplicitHandoffRequest('Что может AI агент?')).toBe(false);
    expect(isExplicitHandoffRequest('How does the support agent answer questions?')).toBe(false);
    expect(isExplicitHandoffRequest('Tell me about human support when needed.')).toBe(false);
  });

  it('detects explicit requests for a human operator', () => {
    expect(isExplicitHandoffRequest('Позовите оператора')).toBe(true);
    expect(isExplicitHandoffRequest('Хочу поговорить с живым человеком')).toBe(true);
    expect(isExplicitHandoffRequest('Соедините меня со специалистом')).toBe(true);
    expect(isExplicitHandoffRequest('Please connect me to a human operator')).toBe(true);
    expect(isExplicitHandoffRequest('I want to talk to a real person')).toBe(true);
  });
});
