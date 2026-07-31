/* eslint-disable @typescript-eslint/unbound-method */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/prisma.js', () => ({
  prisma: {
    agent: { findUnique: vi.fn() },
    specialist: { findMany: vi.fn() },
  },
}));

vi.mock('../services/realtime-hub.js', () => ({
  publishToOperators: vi.fn(),
}));

import { prisma } from '../db/prisma.js';
import { AGENT_TOOLS, executeTool } from '../services/agent-tools.js';

describe('agent tools', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns specialist matching hints for inflected Russian names', async () => {
    vi.mocked(prisma.agent.findUnique).mockResolvedValueOnce({ tenantId: 'tenant-1' } as never);
    vi.mocked(prisma.specialist.findMany).mockResolvedValueOnce([
      {
        id: 'specialist-eva',
        name: 'Ева Король',
        role: 'Эстетист и ведущая Face practice',
        description: 'Skin ritual, Face practice',
      },
    ] as never);

    const toolResult = await executeTool(
      'list_specialists',
      {},
      { sessionId: 'session-1', agentId: 'agent-1', tenantId: 'tenant-1' },
    );

    const payload = JSON.parse(toolResult.result) as {
      specialists: Array<{ matchingHints: string[] }>;
    };
    expect(payload.specialists[0]?.matchingHints).toEqual(
      expect.arrayContaining(['Ева Король', 'Ева', 'Еве', 'Еву', 'Король']),
    );
  });
  it('marks returned group slots as bookable in the create tool contract', () => {
    const createTool = AGENT_TOOLS.find(
      (tool) => tool.type === 'function' && tool.function.name === 'create_appointment_request',
    );
    expect(createTool?.type === 'function' ? createTool.function.description : '').toContain(
      'A group slot returned by find_available_slots is bookable',
    );
  });
});
