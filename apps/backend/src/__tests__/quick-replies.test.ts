import { describe, expect, it } from 'vitest';
import { normalizeQuickReplies } from '../services/quick-replies.js';

describe('normalizeQuickReplies', () => {
  it('trims, deduplicates, and limits replies', () => {
    expect(normalizeQuickReplies([' Yes ', 'No', 'Yes', '', 'Maybe', 'Later', 'Extra'])).toEqual([
      'Yes',
      'No',
      'Maybe',
      'Later',
    ]);
  });

  it('ignores non-string values and truncates long replies', () => {
    expect(normalizeQuickReplies([null, 42, 'x'.repeat(120)])).toEqual(['x'.repeat(100)]);
  });
});
