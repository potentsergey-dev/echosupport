import { describe, expect, it } from 'vitest';
import { csatSubmissionSchema } from '../services/csat.js';

describe('csatSubmissionSchema', () => {
  it('accepts positive and negative ratings and trims a comment', () => {
    expect(csatSubmissionSchema.parse({ rating: 1, comment: '  Helpful  ' })).toEqual({
      rating: 1,
      comment: 'Helpful',
    });
    expect(csatSubmissionSchema.parse({ rating: -1 })).toEqual({ rating: -1 });
  });

  it('rejects ratings outside the public CSAT contract', () => {
    expect(csatSubmissionSchema.safeParse({ rating: 0 }).success).toBe(false);
    expect(csatSubmissionSchema.safeParse({ rating: 5 }).success).toBe(false);
  });

  it('rejects comments longer than 2000 characters', () => {
    expect(csatSubmissionSchema.safeParse({ rating: 1, comment: 'x'.repeat(2001) }).success).toBe(
      false,
    );
  });
});
