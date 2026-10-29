import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { expect, it } from 'vitest';

it('runs the previous Prisma client against the expanded schema without losing group seats', async () => {
  const cache = resolve(
    dirname(createRequire(import.meta.url).resolve('@prisma/client/package.json')),
    '.booking-test-cache',
  );
  await mkdir(cache, { recursive: true });
  const directory = await mkdtemp(resolve(cache, 'booking-legacy-'));
  if (dirname(directory) !== cache || !basename(directory).startsWith('booking-legacy-'))
    throw new Error('Unexpected legacy client directory');
  let legacy: PrismaClient | undefined;
  const current = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env['TEST_DATABASE_URL']! }),
  });
  let tenantId: string | undefined;
  try {
    const schema = await readFile(
      new URL('./fixtures/booking-pre-participants.prisma', import.meta.url),
      'utf8',
    );
    await writeFile(
      resolve(directory, 'schema.prisma'),
      schema.replace(
        'provider = "prisma-client-js"',
        'provider = "prisma-client-js"\n  output = "./client"',
      ),
    );
    await promisify(execFile)(
      process.execPath,
      [
        resolve('node_modules/prisma/build/index.js'),
        'generate',
        '--schema',
        resolve(directory, 'schema.prisma'),
      ],
      { timeout: 60000 },
    );
    const module = (await import(
      /* @vite-ignore */ pathToFileURL(resolve(directory, 'client/index.js')).href
    )) as { PrismaClient: typeof PrismaClient };
    legacy = new module.PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env['TEST_DATABASE_URL']! }),
    });
    const tenant = await legacy.tenant.create({ data: { name: 'Synthetic old client' } });
    tenantId = tenant.id;
    const specialist = await legacy.specialist.create({ data: { tenantId, name: 'Synthetic' } });
    const service = await legacy.service.create({
      data: {
        tenantId,
        specialistId: specialist.id,
        name: 'Synthetic group',
        durationMin: 60,
        isGroup: true,
        capacity: 3,
      },
    });
    const data = {
      tenantId,
      specialistId: specialist.id,
      serviceId: service.id,
      visitorName: 'Synthetic',
      visitorPhone: '+000000001',
      startsAt: new Date('2099-12-01T09:00:00Z'),
      endsAt: new Date('2099-12-01T10:00:00Z'),
      notes: 'Group participants: 2',
      source: 'OPERATOR' as const,
    };
    const row = await legacy.appointment.create({ data });
    expect(row).not.toHaveProperty('participantCount');
    await legacy.appointment.update({
      where: { id: row.id },
      data: { notes: 'Old client edited notes' },
    });
    const numeric = await current.appointment.findUniqueOrThrow({ where: { id: row.id } });
    expect(numeric.participantCount).toBe(2);
    expect(numeric.notes).toBe('Group participants: 2\nOld client edited notes');
    await expect(legacy.appointment.create({ data })).rejects.toThrow();
    expect(await current.appointment.count({ where: { tenantId } })).toBe(1);
  } finally {
    if (tenantId) {
      await current.appointment.deleteMany({ where: { tenantId } });
      await current.service.deleteMany({ where: { tenantId } });
      await current.specialist.deleteMany({ where: { tenantId } });
      await current.tenant.delete({ where: { id: tenantId } });
    }
    await legacy?.$disconnect();
    await current.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
}, 90000);
