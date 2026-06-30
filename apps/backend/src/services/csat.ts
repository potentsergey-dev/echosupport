import { z } from 'zod';

export const csatSubmissionSchema = z.object({
  rating: z.union([z.literal(-1), z.literal(1)]),
  comment: z.string().trim().max(2000).optional(),
});
