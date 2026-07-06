export type DependencyName = 'database' | 'qdrant';

export interface ReadinessDependency {
  name: DependencyName;
  check: () => Promise<void>;
}

export interface DependencyStatus {
  status: 'up' | 'down';
  latencyMs: number;
  error?: string;
}

export interface ReadinessResult {
  status: 'ready' | 'not_ready';
  checks: Record<DependencyName, DependencyStatus>;
}

function publicError(error: unknown): string {
  if (error instanceof Error && error.name) return error.name;
  return 'DependencyError';
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
