import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../db/prisma.js';
import { confirmBooking, createBooking, updateBooking } from '../services/booking-mutations.js';

const peers = [0, 1].map(
  () =>
    new PrismaClient({
      adapter: new PrismaPg({
        connectionString: process.env['TEST_DATABASE_URL']!,
        max: 1,
      }),
    }),
);
const tenants: string[] = [];
async function fixture(capacity = 1) {
  const tenant = await prisma.tenant.create({ data: { name: `booking-test-${randomUUID()}` } });
  tenants.push(tenant.id);
  const agent = await prisma.agent.create({
    data: {
      tenantId: tenant.id,
      name: 'Synthetic',
      systemPrompt: 'Synthetic',
      publicKey: randomUUID(),
    },
  });
  const sessions = await Promise.all(
    [0, 1].map(() =>
      prisma.session.create({
        data: {
          agentId: agent.id,
          expiresAt: new Date(Date.now() + 3600000),
        },
      }),
    ),
  );
  const specialist = await prisma.specialist.create({
    data: {
      tenantId: tenant.id,
      name: 'Synthetic',
      workingHours: {
        create: Array.from({ length: 7 }, (_, dayOfWeek) => ({
          dayOfWeek,
          fromMinutes: 0,
          toMinutes: 1440,
        })),
      },
    },
  });
  const service = await prisma.service.create({
    data: {
      tenantId: tenant.id,
      specialistId: specialist.id,
      name: 'Synthetic',
      durationMin: 60,
      isGroup: capacity > 1,
      capacity,
    },
  });
  const input = {
    tenantId: tenant.id,
    specialistId: specialist.id,
    serviceId: service.id,
    visitorName: 'Synthetic visitor',
    visitorPhone: '+000000001',
    startsAt: new Date('2099-12-01T09:00:00Z'),
    endsAt: new Date('2099-12-01T10:00:00Z'),
    source: 'OPERATOR' as const,
  };
  const visitor = (index: number) => ({
    ...input,
    source: 'AGENT' as const,
    agentId: agent.id,
    sessionId: sessions[index]!.id,
  });
  return { tenant, agent, sessions, specialist, service, input, visitor };
}
afterEach(async () => {
  const where = { tenantId: { in: tenants } };
  await prisma.appointment.deleteMany({ where });
  await prisma.service.deleteMany({ where });
  await prisma.specialist.deleteMany({ where });
  await prisma.tenant.deleteMany({ where: { id: { in: tenants } } });
  tenants.length = 0;
});
afterAll(async () => {
  await Promise.all([...peers, prisma].map((db) => db.$disconnect()));
});

describe('shared booking creation with independent PostgreSQL connections', () => {
  it.each([
    ['AGENT', 'AGENT'],
    ['AGENT', 'OPERATOR'],
    ['OPERATOR', 'OPERATOR'],
  ] as const)('serializes %s/%s before reading an empty individual slot', async (left, right) => {
    const f = await fixture();
    const pids = await Promise.all(
      peers.map((db) => db.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`),
    );
    expect(pids[0]![0]!.pid).not.toBe(pids[1]![0]!.pid);
    const results = await Promise.allSettled(
      [left, right].map((source, index) =>
        createBooking(source === 'AGENT' ? f.visitor(index) : f.input, peers[index]),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const failure = results.find((r) => r.status === 'rejected');
    expect(failure?.status === 'rejected' && (failure.reason as Error).message).toBe('SLOT_TAKEN');
    expect(await prisma.appointment.count({ where: { specialistId: f.specialist.id } })).toBe(1);
  });
  it('admits only one request for the final seat in a group', async () => {
    const f = await fixture(2);
    await createBooking({ ...f.input, notes: 'Group participants: 1' });
    const results = await Promise.allSettled(
      peers.map((db, index) =>
        createBooking(
          {
            ...f.visitor(index),
            notes: 'Group participants: 1',
          },
          db,
        ),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find((r) => r.status === 'rejected');
    expect(failure?.status === 'rejected' && (failure.reason as Error).message).toBe('SLOT_FULL');
    expect(await prisma.appointment.count({ where: { specialistId: f.specialist.id } })).toBe(2);
  });
  it('does not let a different session modify a booking with the same phone', async () => {
    const f = await fixture(3);
    const own = await createBooking({ ...f.visitor(0), notes: 'Group participants: 2' });
    const other = await createBooking({
      ...f.visitor(1),
      visitorName: 'Different visitor',
      notes: 'Group participants: 1',
    });
    expect(other.id).not.toBe(own.id);
    expect(await prisma.appointment.findUniqueOrThrow({ where: { id: own.id } })).toMatchObject({
      sessionId: f.sessions[0]!.id,
      visitorName: 'Synthetic visitor',
      notes: 'Group participants: 2',
    });
    expect(other.sessionId).toBe(f.sessions[1]!.id);
  });
  it('cannot take over a full group by supplying the existing phone number', async () => {
    const f = await fixture(2);
    const own = await createBooking({ ...f.visitor(0), notes: 'Group participants: 2' });
    await expect(
      createBooking({ ...f.visitor(1), visitorName: 'Foreign', notes: 'Group participants: 1' }),
    ).rejects.toThrow('SLOT_FULL');
    expect(await prisma.appointment.findUniqueOrThrow({ where: { id: own.id } })).toMatchObject({
      visitorName: 'Synthetic visitor',
    });
  });
  it.each([1, 3])(
    'returns one owned row for concurrent same-session retries (capacity %s)',
    async (capacity) => {
      const f = await fixture(capacity);
      const results = await Promise.all(
        peers.map((db) =>
          createBooking(
            { ...f.visitor(0), notes: capacity > 1 ? 'Group participants: 1' : null },
            db,
          ),
        ),
      );
      expect(results[0]!.id).toBe(results[1]!.id);
      expect(await prisma.appointment.count({ where: { specialistId: f.specialist.id } })).toBe(1);
    },
  );
  it('preserves confirmation on an exact replay and requests confirmation after a change', async () => {
    const f = await fixture(3);
    const row = await createBooking({ ...f.visitor(0), notes: 'Group participants: 1' });
    await prisma.appointment.update({ where: { id: row.id }, data: { status: 'CONFIRMED' } });
    const replay = await createBooking({ ...f.visitor(0), notes: 'Group participants: 1' });
    expect(replay).toMatchObject({ id: row.id, status: 'CONFIRMED' });
    const changed = await createBooking({ ...f.visitor(0), notes: 'Group participants: 2' });
    expect(changed).toMatchObject({ id: row.id, status: 'PENDING' });
  });
  it('rejects a session paired with a different agent', async () => {
    const f = await fixture(2);
    const other = await prisma.agent.create({
      data: {
        tenantId: f.tenant.id,
        name: 'Other',
        systemPrompt: 'Synthetic',
        publicKey: randomUUID(),
      },
    });
    await expect(createBooking({ ...f.visitor(0), agentId: other.id })).rejects.toThrow(
      'BOOKING_UNAVAILABLE',
    );
    expect(await prisma.appointment.count({ where: { specialistId: f.specialist.id } })).toBe(0);
  });
  it('checks tenant and specialist activity again inside the mutation', async () => {
    const f = await fixture();
    await expect(createBooking({ ...f.input, tenantId: 'foreign' })).rejects.toThrow(
      'BOOKING_UNAVAILABLE',
    );
    await prisma.specialist.update({ where: { id: f.specialist.id }, data: { isActive: false } });
    await expect(createBooking(f.input)).rejects.toThrow('BOOKING_UNAVAILABLE');
  });
  it('reads current capacity and rejects a stale service duration', async () => {
    const f = await fixture(3);
    await prisma.service.update({ where: { id: f.service.id }, data: { capacity: 1 } });
    await expect(
      createBooking({ ...f.visitor(0), notes: 'Group participants: 2' }),
    ).rejects.toThrow('SLOT_FULL');
    await prisma.service.update({ where: { id: f.service.id }, data: { durationMin: 30 } });
    await expect(createBooking(f.input)).rejects.toThrow('BOOKING_UNAVAILABLE');
  });
  it('rejects expired sessions without creating a booking', async () => {
    const f = await fixture();
    await prisma.session.update({
      where: { id: f.sessions[0]!.id },
      data: { expiresAt: new Date(0) },
    });
    await expect(createBooking(f.visitor(0))).rejects.toThrow('BOOKING_UNAVAILABLE');
  });
});

describe('booking confirmation admission', () => {
  it('rejects reactivation when another booking occupies the slot', async () => {
    const f = await fixture();
    const old = await prisma.appointment.create({ data: { ...f.input, status: 'CANCELLED' } });
    await createBooking(f.input);
    await expect(confirmBooking(f.tenant.id, old.id)).rejects.toThrow('SLOT_TAKEN');
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: old.id } })).status).toBe(
      'CANCELLED',
    );
  });
  it('counts all participants when reactivating a group', async () => {
    const f = await fixture(3);
    const old = await prisma.appointment.create({
      data: { ...f.input, status: 'CANCELLED', notes: 'Group participants: 2' },
    });
    await createBooking({ ...f.input, notes: 'Group participants: 2' });
    await expect(confirmBooking(f.tenant.id, old.id)).rejects.toThrow('SLOT_FULL');
  });
  it('serializes reactivation against creation on independent connections', async () => {
    const f = await fixture();
    const old = await prisma.appointment.create({ data: { ...f.input, status: 'CANCELLED' } });
    const results = await Promise.allSettled([
      confirmBooking(f.tenant.id, old.id, peers[0]),
      createBooking(f.input, peers[1]),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      await prisma.appointment.count({
        where: { specialistId: f.specialist.id, status: { in: ['PENDING', 'CONFIRMED'] } },
      }),
    ).toBe(1);
  });
  it('does not expose or change another tenant booking', async () => {
    const f = await fixture();
    const old = await prisma.appointment.create({ data: { ...f.input, status: 'CANCELLED' } });
    await expect(confirmBooking(randomUUID(), old.id)).rejects.toThrow('BOOKING_NOT_FOUND');
  });
  it('keeps confirmation idempotent and terminal outcomes protected', async () => {
    const f = await fixture();
    const old = await createBooking(f.input);
    expect((await confirmBooking(f.tenant.id, old.id)).status).toBe('CONFIRMED');
    expect((await confirmBooking(f.tenant.id, old.id)).status).toBe('CONFIRMED');
    await prisma.appointment.update({ where: { id: old.id }, data: { status: 'COMPLETED' } });
    await expect(confirmBooking(f.tenant.id, old.id)).rejects.toThrow('BOOKING_UNAVAILABLE');
  });
});

describe('serialized operator edits', () => {
  it('preserves group seats on notes replacement and cancellation', async () => {
    const f = await fixture(3);
    const booking = await createBooking({ ...f.input, notes: 'Group participants: 2' });
    const edited = await updateBooking(f.tenant.id, booking.id, {
      notes: 'Group participants: 1 new note',
    });
    expect(edited.notes).toBe('Group participants: 2\nnew note');
    const cancelled = await updateBooking(f.tenant.id, booking.id, {
      status: 'CANCELLED',
      notes: 'Reason',
    });
    expect(cancelled.notes).toBe('Group participants: 2\nReason');
  });
  it('rejects generic reactivation into an occupied slot', async () => {
    const f = await fixture();
    const old = await prisma.appointment.create({ data: { ...f.input, status: 'CANCELLED' } });
    await createBooking(f.input);
    await expect(updateBooking(f.tenant.id, old.id, { status: 'PENDING' })).rejects.toThrow(
      'SLOT_TAKEN',
    );
  });
  it('checks the whole group on reschedule and rolls back on rejection', async () => {
    const f = await fixture(3);
    const old = await createBooking({ ...f.input, notes: 'Group participants: 2' });
    const startsAt = new Date('2099-12-02T09:00:00Z');
    await createBooking({
      ...f.input,
      startsAt,
      endsAt: new Date('2099-12-02T10:00:00Z'),
      notes: 'Group participants: 2',
    });
    await expect(updateBooking(f.tenant.id, old.id, { startsAt })).rejects.toThrow('SLOT_FULL');
    expect(
      (await prisma.appointment.findUniqueOrThrow({ where: { id: old.id } })).startsAt,
    ).toEqual(f.input.startsAt);
  });
  it('serializes reschedule against a competing create', async () => {
    const f = await fixture();
    const old = await createBooking(f.input);
    const startsAt = new Date('2099-12-02T09:00:00Z');
    const results = await Promise.allSettled([
      updateBooking(f.tenant.id, old.id, { startsAt }, peers[0]),
      createBooking({ ...f.input, startsAt, endsAt: new Date('2099-12-02T10:00:00Z') }, peers[1]),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
  it('checks working hours inside the mutation', async () => {
    const f = await fixture();
    const old = await createBooking(f.input);
    await prisma.specialistWorkingHours.deleteMany({ where: { specialistId: f.specialist.id } });
    await expect(
      updateBooking(f.tenant.id, old.id, { startsAt: new Date('2099-12-02T09:00:00Z') }),
    ).rejects.toThrow('BOOKING_OUTSIDE_HOURS');
  });
});
