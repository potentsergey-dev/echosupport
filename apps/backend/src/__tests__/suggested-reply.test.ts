import { describe, expect, it } from 'vitest';
import { buildSuggestedReplyTranscript } from '../services/suggested-reply.js';

describe('buildSuggestedReplyTranscript', () => {
  it('keeps chronological messages and labels their authors', () => {
    expect(
      buildSuggestedReplyTranscript([
        { authorType: 'VISITOR', content: '  Hello  ', isInternal: false },
        { authorType: 'AGENT', content: 'How can I help?', isInternal: false },
        { authorType: 'OPERATOR', content: 'I can take this.', isInternal: false },
      ]),
    ).toBe('Visitor: Hello\nAgent: How can I help?\nOperator: I can take this.');
  });

  it('excludes internal and empty messages', () => {
    expect(
      buildSuggestedReplyTranscript([
        { authorType: 'OPERATOR', content: 'Internal note', isInternal: true },
        { authorType: 'VISITOR', content: '   ', isInternal: false },
        { authorType: 'VISITOR', content: 'Visible', isInternal: false },
      ]),
    ).toBe('Visitor: Visible');
  });
});
