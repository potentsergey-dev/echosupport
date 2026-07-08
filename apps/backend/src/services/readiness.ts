import { summarizeError } from './error-sanitizer.js';

export type DependencyName = 'database' | 'qdrant';

export interface ReadinessDependency {
  name: DependencyName;
  check: () => Promise<void>;
}

export interface DependencyStatus {
  status: 'up' | 'down';
  latencyMs: number;
  hint?: string;
  error?: string;
}

export interface ReadinessResult {
  status: 'ready' | 'not_ready';
  checks: Record<DependencyName, DependencyStatus>;
}

function publicError(error: unknown): string {
  return summarizeError(error).name || 'DependencyError';
}

function dependencyHint(name: DependencyName): string {
  if (name === 'database') {
    return 'Check DATABASE_URL and PostgreSQL connectivity; in Docker run docker compose logs postgres backend.';
  }
  return 'Check QDRANT_URL, QDRANT_API_KEY if used, and Qdrant connectivity; in Docker run docker compose logs qdrant backend.';
}

export async function checkReadiness(
  dependencies: ReadinessDependency[],
): Promise<ReadinessResult> {
  const entries = await Promise.all(
    dependencies.map(async ({ name, check }) => {
      const startedAt = performance.now();
      try {
        await check();
        return [
          name,
          {
            status: 'up',
            latencyMs: Math.round(performance.now() - startedAt),
          },
        ] as const;
      } catch (error) {
        return [
          name,
          {
            status: 'down',
            latencyMs: Math.round(performance.now() - startedAt),
            error: publicError(error),
            hint: dependencyHint(name),
          },
        ] as const;
      }
    }),
  );

  const checks = Object.fromEntries(entries) as Record<DependencyName, DependencyStatus>;
  const ready = entries.every(([, result]) => result.status === 'up');

  return {
    status: ready ? 'ready' : 'not_ready',
    checks,
  };
}
