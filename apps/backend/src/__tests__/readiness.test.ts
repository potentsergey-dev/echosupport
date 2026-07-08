import { describe, expect, it, vi } from 'vitest';
import { checkReadiness, type ReadinessDependency } from '../services/readiness.js';

function dependencies(
  database: () => Promise<void>,
  qdrant: () => Promise<void>,
): ReadinessDependency[] {
  return [
    { name: 'database', check: database },
    { name: 'qdrant', check: qdrant },
  ];
}

describe('readiness', () => {
  it('is ready only when every required dependency responds', async () => {
    const result = await checkReadiness(
      dependencies(vi.fn().mockResolvedValue(undefined), vi.fn().mockResolvedValue(undefined)),
    );

    expect(result.status).toBe('ready');
    expect(result.checks.database.status).toBe('up');
    expect(result.checks.qdrant.status).toBe('up');
  });

  it('reports each failed dependency without leaking its error message', async () => {
    const result = await checkReadiness(
      dependencies(
        vi.fn().mockRejectedValue(new Error('postgresql://user:secret@db/private')),
        vi.fn().mockRejectedValue(new TypeError('https://qdrant.internal')),
      ),
    );

    expect(result.status).toBe('not_ready');
    expect(result.checks.database).toMatchObject({
      status: 'down',
      error: 'Error',
    });
    expect(result.checks.qdrant).toMatchObject({
      status: 'down',
      error: 'TypeError',
    });
    expect(result.checks.database.hint).toContain('PostgreSQL');
    expect(result.checks.qdrant.hint).toContain('Qdrant');
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(result)).not.toContain('qdrant.internal');
  });

  it('waits for all checks so the response contains a complete diagnosis', async () => {
    const database = vi.fn().mockRejectedValue(new Error('offline'));
    const qdrant = vi.fn().mockResolvedValue(undefined);

    const result = await checkReadiness(dependencies(database, qdrant));

    expect(database).toHaveBeenCalledOnce();
    expect(qdrant).toHaveBeenCalledOnce();
    expect(result.checks.database.status).toBe('down');
    expect(result.checks.qdrant.status).toBe('up');
  });
});
