import { z } from 'zod';

const secretPlaceholderValues = new Set([
  'replace-with-a-strong-database-password',
  'replace-with-at-least-32-random-characters',
  'replace-with-exactly-64-hex-characters',
  'replace-with-a-long-unique-admin-password',
  'change_me_to_a_long_random_string_at_least_32_chars_long',
  'change_me_to_a_long_random_string',
]);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().default('0.0.0.0'),
    DATABASE_URL: z.string().min(1),
    JWT_SECRET: z.string().min(32),
    MASTER_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/, {
      message: 'must be exactly 64 hexadecimal characters',
    }),
    ADMIN_CORS_ORIGINS: z.string().default('http://localhost:5173'),
    UPLOADS_DIR: z.string().default('./uploads'),
    APP_URL: z.string().url().default('http://localhost:3000'),
    PUBLIC_BASE_URL: z.string().url().optional(),
    // Phase 3 — Knowledge Indexing
    OPENAI_API_KEY: z.string().default(''),
    QDRANT_URL: z.string().default('http://localhost:6333'),
    QDRANT_API_KEY: z.string().optional(),
    MAX_DOCUMENT_SIZE_MB: z.coerce.number().int().positive().default(50),
    // Phase 4 — Chat Engine
    OPENROUTER_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
    OPENROUTER_API_KEY: z.string().default(''),
    // Optional dedicated key for embeddings on OpenRouter (allows separate rate-limit/budget)
    OPENROUTER_EMBEDDING_API_KEY: z.string().default(''),
    // Phase 5 — STT
    DEEPGRAM_API_KEY: z.string().default(''),
    // Demo deployment - opt-in marketing copy for the seeded demo agent.
    ECHOSUPPORT_DEMO_MARKETING_SEED: z.enum(['true', 'false']).default('false'),
    // Deployment — cron trigger secret (used by Passenger / external scheduler)
    CRON_SECRET: z.string().min(32).optional(),
  })
  .superRefine((value, ctx) => {
    for (const [key, candidate] of Object.entries({
      JWT_SECRET: value.JWT_SECRET,
      MASTER_ENCRYPTION_KEY: value.MASTER_ENCRYPTION_KEY,
      CRON_SECRET: value.CRON_SECRET,
    })) {
      if (candidate && secretPlaceholderValues.has(candidate)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: 'must be replaced with a unique random value',
        });
      }
    }

    const adminOrigins = value.ADMIN_CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
    if (adminOrigins.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ADMIN_CORS_ORIGINS'],
        message: 'must include at least one trusted admin origin',
      });
    }
    for (const origin of adminOrigins) {
      if (origin === '*') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ADMIN_CORS_ORIGINS'],
          message: 'cannot include wildcard origins',
        });
        continue;
      }
      try {
        const parsed = new URL(origin);
        if (parsed.origin !== origin.replace(/\/+$/, '')) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['ADMIN_CORS_ORIGINS'],
            message: `origin must not include a path: ${origin}`,
          });
        }
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ADMIN_CORS_ORIGINS'],
          message: `invalid URL origin: ${origin}`,
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export function parseEnv(input: NodeJS.ProcessEnv): Env {
  return envSchema.parse(input);
}

export function formatEnvIssues(error: z.ZodError): string[] {
  return Object.entries(error.flatten().fieldErrors).flatMap(([key, errors]) => {
    if (!errors?.length) return [];
    return [`  ${key}: ${errors.join(', ')}`];
  });
}
