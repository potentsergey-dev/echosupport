import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  MASTER_ENCRYPTION_KEY: z.string().length(64),
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
  // Deployment — cron trigger secret (used by Passenger / external scheduler)
  CRON_SECRET: z.string().min(32).optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  for (const [key, errors] of Object.entries(parsed.error.flatten().fieldErrors)) {
    console.error(`  ${key}: ${errors?.join(', ')}`);
  }
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
