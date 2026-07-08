import 'dotenv/config';
import { envSchema, formatEnvIssues, type Env } from './env-validation.js';

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:');
  for (const line of formatEnvIssues(parsed.error)) {
    console.error(line);
  }
  process.exit(1);
}

export const env: Env = parsed.data;
export type { Env };
