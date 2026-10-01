import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../db/prisma.js';
import { hashOpaqueToken } from '../services/identity-foundation.js';

const children: ChildProcess[] = [];
const tenantIds: string[] = [];
const userIds: string[] = [];
const jobIds: string[] = [];
let serverA: string;
let serverB: string;
async function startServer(): Promise<string> {
  const child = fork(new URL('./fixtures/job-stream-server.ts', import.meta.url), [], {
    execArgv: ['--import', 'tsx'],
    env: { ...process.env, DB_POOL_MAX: '2' },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  children.push(child);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('SSE fixture did not become ready'));
    }, 30_000);
    child.once('message', (message) => {
      clearTimeout(timer);
      resolve((message as { address: string }).address);
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`SSE fixture exited (${code})`));
    });
  });
}

describe('SSE revocation across separate API processes (PostgreSQL)', () => {
  beforeAll(async () => {
    [serverA, serverB] = await Promise.all([startServer(), startServer()]);
  }, 60_000);
  afterEach(async () => {
    await prisma.job.deleteMany({ where: { id: { in: jobIds.splice(0) } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds.splice(0) } } });
  });
  afterAll(async () => {
    for (const child of children) child.kill();
    await prisma.$disconnect();
  });

  it.each(['logout', 'removed', 'suspended', 'role', 'disabled', 'expiry', 'idle', 'switch'])(
    'closes A without disclosing job errors after %s on B',
    async (action) => {
      const tenant = await prisma.tenant.create({ data: { name: 'SSE isolated fixture' } });
      const alternateTenant = await prisma.tenant.create({
        data: { name: 'SSE alternate fixture' },
      });
      tenantIds.push(tenant.id, alternateTenant.id);
      const email = `${randomUUID()}@example.com`;
      const user = await prisma.user.create({
        data: { tenantId: tenant.id, email, normalizedEmail: email },
      });
      userIds.push(user.id);
      const membership = await prisma.membership.create({
        data: { userId: user.id, tenantId: tenant.id, role: 'OWNER' },
      });
      const alternate = await prisma.membership.create({
        data: { userId: user.id, tenantId: alternateTenant.id, role: 'ADMIN' },
      });
      const agent = await prisma.agent.create({
        data: {
          tenantId: tenant.id,
          name: 'SSE fixture',
          systemPrompt: 'Fixture',
          publicKey: randomUUID(),
        },
      });
      const job = await prisma.job.create({
        data: {
          agentId: agent.id,
          type: 'REINDEX_AGENT',
          payload: { agentId: agent.id },
          status: 'RUNNING',
          progress: 37,
        },
      });
      jobIds.push(job.id);
      const token = randomUUID();
      const lastSeenAt = new Date();
      const session = await prisma.authSession.create({
        data: {
          tokenHash: hashOpaqueToken(token),
          userId: user.id,
          tenantId: tenant.id,
          selectedMembershipId: membership.id,
          expiresAt: new Date(Date.now() + 60_000),
          lastSeenAt,
        },
      });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch(`${serverA}/jobs/${job.id}/stream`, {
          headers: { cookie: `test_session=${token}` },
          signal: controller.signal,
        });
        expect(response.status).toBe(200);
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let initial = '';
        while (!initial.includes('event: progress')) {
          const chunk = await reader.read();
          if (chunk.done) throw new Error('SSE closed before first progress');
          initial += decoder.decode(chunk.value);
        }
        expect(
          (await prisma.authSession.findUniqueOrThrow({ where: { id: session.id } })).lastSeenAt,
        ).toEqual(lastSeenAt);
        const revoked = await fetch(`${serverB}/fixture/revoke`, {
          method: 'POST',
          headers: { cookie: `test_session=${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            sessionId: session.id,
            action,
            alternateMembershipId: alternate.id,
            alternateTenantId: alternateTenant.id,
          }),
        });
        expect(revoked.status).toBe(204);
        await prisma.job.update({
          where: { id: job.id },
          data: { status: 'FAILED', errorMessage: 'protected-after-revoke' },
        });
        let afterRevoke = '';
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          afterRevoke += decoder.decode(chunk.value);
        }
        expect(afterRevoke).not.toContain('protected-after-revoke');
        expect(afterRevoke).not.toContain('event: done');
      } finally {
        clearTimeout(timeout);
        controller.abort();
      }
    },
    15_000,
  );
});
