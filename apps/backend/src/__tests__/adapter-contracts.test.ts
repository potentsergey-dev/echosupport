import fs from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { uploadsDir } = vi.hoisted(() => ({
  uploadsDir: `${process.env['TEMP'] ?? process.env['TMP'] ?? 'C:\\tmp'}\\echosupport-storage-${process.pid}`,
}));

vi.mock('../config/env.js', () => ({
  env: {
    UPLOADS_DIR: uploadsDir,
  },
}));

import type {
  AuthWorkspaceAdapter,
  RealtimeSocket,
  StorageAdapter,
} from '../contracts/infrastructure.js';
import { localFileStorageAdapter } from '../adapters/storage/local-fs.js';
import { noopMeteringSink } from '../services/metering.js';
import {
  inMemoryRealtimeEventBus,
  registerOperator,
  unregisterOperator,
} from '../services/realtime-hub.js';

describe('Community adapter contracts', () => {
  afterEach(async () => {
    await fs.rm(uploadsDir, { recursive: true, force: true });
  });

  it('stores, reads and deletes files through the StorageAdapter contract', async () => {
    const storagePath = await localFileStorageAdapter.saveFile(
      'agent-1',
      'doc.txt',
      Buffer.from('hello'),
    );

    await expect(localFileStorageAdapter.readFile(storagePath)).resolves.toEqual(
      Buffer.from('hello'),
    );
    await localFileStorageAdapter.deleteFile(storagePath);
    await expect(localFileStorageAdapter.readFile(storagePath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('publishes operator events through the RealtimeEventBus contract', () => {
    const sent: string[] = [];
    const socket: RealtimeSocket = {
      readyState: 1,
      send(payload) {
        sent.push(payload);
      },
    };

    inMemoryRealtimeEventBus.registerOperator('tenant-1', socket);
    inMemoryRealtimeEventBus.publishToOperators('tenant-1', {
      type: 'session:status',
      tenantId: 'tenant-1',
      sessionId: 'session-1',
      status: 'WAITING_OPERATOR',
    });
    inMemoryRealtimeEventBus.unregisterOperator('tenant-1', socket);

    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!) as unknown).toMatchObject({
      type: 'session:status',
      tenantId: 'tenant-1',
    });
  });

  it('keeps direct realtime functions compatible with the bus implementation', () => {
    const send = vi.fn();
    const socket: RealtimeSocket = { readyState: 1, send };
    registerOperator('tenant-direct', socket);
    unregisterOperator('tenant-direct', socket);
    expect(send).not.toHaveBeenCalled();
  });

  it('accepts metering records through the MeteringSink contract', async () => {
    await expect(
      noopMeteringSink.record({
        tenantId: 'tenant-1',
        feature: 'operator.inbox',
        quantity: 1,
        occurredAt: new Date(),
      }),
    ).resolves.toBeUndefined();
  });

  it('supports fake Cloud-style storage without local file paths', async () => {
    const blobs = new Map<string, Buffer>();
    const storage: StorageAdapter = {
      async saveFile(namespaceId, filename, buffer) {
        const key = `gcs://${namespaceId}/${filename}`;
        blobs.set(key, buffer);
        return key;
      },
      async readFile(storagePath) {
        const buffer = blobs.get(storagePath);
        if (!buffer) throw new Error('blob not found');
        return buffer;
      },
      async deleteFile(storagePath) {
        blobs.delete(storagePath);
      },
    };

    const storagePath = await storage.saveFile('agent-1', 'doc.txt', Buffer.from('cloud bytes'));
    expect(storagePath).toBe('gcs://agent-1/doc.txt');
    await expect(storage.readFile(storagePath)).resolves.toEqual(Buffer.from('cloud bytes'));
  });

  it('supports fake realtime and auth-workspace adapters through their contracts', async () => {
    const published: unknown[] = [];
    const realtime = {
      registerOperator: vi.fn(),
      unregisterOperator: vi.fn(),
      registerVisitor: vi.fn(),
      unregisterVisitor: vi.fn(),
      publishToOperators: vi.fn((_tenantId: string, event: unknown) => published.push(event)),
      publishToVisitor: vi.fn(),
    };
    const authWorkspace: AuthWorkspaceAdapter = {
      async authenticateRequest() {
        return {
          userId: 'user-1',
          email: 'owner@example.com',
          tenantId: 'tenant-1',
          role: 'OWNER',
        };
      },
      async assertWorkspaceAccess(context, workspaceId) {
        expect(context.tenantId).toBe(workspaceId);
      },
    };

    realtime.publishToOperators('tenant-1', { type: 'session:new' });
    const context = await authWorkspace.authenticateRequest({} as never);
    await expect(authWorkspace.assertWorkspaceAccess(context, 'tenant-1')).resolves.toBeUndefined();
    expect(published).toEqual([{ type: 'session:new' }]);
  });
});
