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

import type { RealtimeSocket } from '../contracts/infrastructure.js';
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
});
