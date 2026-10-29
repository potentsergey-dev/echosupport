import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import authPlugin from '../plugins/auth.js';
import dependenciesPlugin from '../plugins/dependencies.js';
import entitlementsPlugin from '../plugins/entitlements.js';
import operatorRoutes from '../routes/operator/index.js';
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

// Real JWT/auth/entitlement plugins and real PostgreSQL; no external network services.
async function httpFixture(capacity = 1) {
  const f = await fixture(capacity);
  const app = Fastify({ logger: false });
  await app.register(jwt, { secret: 'booking-http-test-secret-at-least-32-characters' });
  await app.register(dependenciesPlugin);
  await app.register(authPlugin);
  await app.register(entitlementsPlugin);
  await app.register(operatorRoutes, { prefix: '/api/v1/operator' });
  await app.ready();
  const token = (role = 'OWNER', tenantId = f.tenant.id) =>
    app.jwt.sign({
      sub: randomUUID(),
      email: 'synthetic@example.com',
      tenantId,
      role,
    });
  const booking = await createBooking(f.input);
  return { ...f, app, token, booking };
}

describe('operator booking HTTP admission', () => {
  it.each(['confirm', 'cancel', 'reschedule', 'edit'])(
    '%s enforces authentication, role and tenant isolation',
    async (action) => {
      const f = await httpFixture();
      const suffix = action === 'edit' ? '' : `/${action}`;
      const url = `/api/v1/operator/appointments/${f.booking.id}${suffix}`;
      const payload =
        action === 'reschedule'
          ? { startsAt: '2099-12-02T09:00:00Z' }
          : { notes: 'Synthetic edit' };
      try {
        expect((await f.app.inject({ method: 'PATCH', url, payload })).statusCode).toBe(401);
        expect(
          (
            await f.app.inject({
              method: 'PATCH',
              url,
              payload,
              headers: { authorization: `Bearer ${f.token('VIEWER')}` },
            })
          ).statusCode,
        ).toBe(403);
        expect(
          (
            await f.app.inject({
              method: 'PATCH',
              url,
              payload,
              headers: { authorization: `Bearer ${f.token('OWNER', randomUUID())}` },
            })
          ).statusCode,
        ).toBe(404);
        const after = await prisma.appointment.findUniqueOrThrow({ where: { id: f.booking.id } });
        expect(after.status).toBe('PENDING');
        expect(after.startsAt).toEqual(f.input.startsAt);
        expect(after.notes).toBeNull();
      } finally {
        await f.app.close();
      }
    },
  );
  it.each(['confirm', 'edit'])(
    '%s returns 409 for reactivation into an occupied slot',
    async (action) => {
      const f = await httpFixture();
      try {
        await updateBooking(f.tenant.id, f.booking.id, { status: 'CANCELLED' });
        await createBooking(f.input);
        const response = await f.app.inject({
          method: 'PATCH',
          url: `/api/v1/operator/appointments/${f.booking.id}${action === 'confirm' ? '/confirm' : ''}`,
          headers: { authorization: `Bearer ${f.token('OPERATOR')}` },
          payload: action === 'edit' ? { status: 'PENDING' } : {},
        });
        expect(response.statusCode).toBe(409);
        expect(
          (await prisma.appointment.findUniqueOrThrow({ where: { id: f.booking.id } })).status,
        ).toBe('CANCELLED');
      } finally {
        await f.app.close();
      }
    },
  );
  it('returns 409 for group reschedule and keeps original dates', async () => {
    const f = await httpFixture(3);
    try {
      await prisma.appointment.update({
        where: { id: f.booking.id },
        data: { participantCount: 2, notes: 'Group participants: 2' },
      });
      await createBooking({
        ...f.input,
        startsAt: new Date('2099-12-02T09:00:00Z'),
        endsAt: new Date('2099-12-02T10:00:00Z'),
        notes: 'Group participants: 2',
      });
      const response = await f.app.inject({
        method: 'PATCH',
        url: `/api/v1/operator/appointments/${f.booking.id}/reschedule`,
        headers: { authorization: `Bearer ${f.token('ADMIN')}` },
        payload: { startsAt: '2099-12-02T09:00:00Z' },
      });
      expect(response.statusCode).toBe(409);
      expect(
        (await prisma.appointment.findUniqueOrThrow({ where: { id: f.booking.id } })).startsAt,
      ).toEqual(f.input.startsAt);
    } finally {
      await f.app.close();
    }
  });
  it('returns 400 for invalid dates and accepts cancellation without losing group size', async () => {
    const f = await httpFixture(3);
    try {
      await prisma.appointment.update({
        where: { id: f.booking.id },
        data: { participantCount: 2, notes: 'Group participants: 2' },
      });
      const headers = { authorization: `Bearer ${f.token()}` };
      const url = `/api/v1/operator/appointments/${f.booking.id}`;
      expect(
        (
          await f.app.inject({
            method: 'PATCH',
            url: `${url}/reschedule`,
            headers,
            payload: { startsAt: 'invalid' },
          })
        ).statusCode,
      ).toBe(400);
      const cancelled = await f.app.inject({
        method: 'PATCH',
        url: `${url}/cancel`,
        headers,
        payload: { reason: 'Synthetic reason' },
      });
      expect(cancelled.statusCode).toBe(200);
      expect(cancelled.json()).toMatchObject({
        status: 'CANCELLED',
        notes: 'Group participants: 2\nSynthetic reason',
      });
    } finally {
      await f.app.close();
    }
  });
  it('accepts authorized edits, confirmation and reschedule; rejects times outside hours', async () => {
    const f = await httpFixture();
    try {
      const headers = { authorization: `Bearer ${f.token('OPERATOR')}` };
      const url = `/api/v1/operator/appointments/${f.booking.id}`;
      const edit = await f.app.inject({
        method: 'PATCH',
        url,
        headers,
        payload: { visitorName: 'Updated visitor' },
      });
      expect(edit.statusCode).toBe(200);
      expect(edit.json()).toMatchObject({ visitorName: 'Updated visitor', status: 'PENDING' });
      expect(
        (await f.app.inject({ method: 'PATCH', url: `${url}/confirm`, headers, payload: {} }))
          .statusCode,
      ).toBe(200);
      const moved = await f.app.inject({
        method: 'PATCH',
        url: `${url}/reschedule`,
        headers,
        payload: { startsAt: '2099-12-02T09:00:00Z' },
      });
      expect(moved.statusCode).toBe(200);
      expect(moved.json()).toMatchObject({
        startsAt: '2099-12-02T09:00:00.000Z',
        endsAt: '2099-12-02T10:00:00.000Z',
        status: 'PENDING',
      });
      await prisma.specialistWorkingHours.deleteMany({ where: { specialistId: f.specialist.id } });
      const denied = await f.app.inject({
        method: 'PATCH',
        url: `${url}/reschedule`,
        headers,
        payload: { startsAt: '2099-12-03T09:00:00Z' },
      });
      expect(denied.statusCode).toBe(400);
      expect(
        (await prisma.appointment.findUniqueOrThrow({ where: { id: f.booking.id } })).startsAt,
      ).toEqual(new Date('2099-12-02T09:00:00Z'));
    } finally {
      await f.app.close();
    }
  });
});

describe('numeric participants and request recovery', () => {
  it('preserves numeric seats through legacy notes-only writes', async () => {
    const f = await fixture(4);
    const a = await createBooking({ ...f.input, participantCount: 3 });
    await prisma.$executeRaw`UPDATE "Appointment" SET notes='changed by old revision' WHERE id=${a.id}`;
    const after = await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } });
    expect(after.participantCount).toBe(3);
    expect(after.notes).toBe('Group participants: 3\nchanged by old revision');
    await expect(createBooking({ ...f.input, participantCount: 2 })).rejects.toThrow('SLOT_FULL');
  });
  it('checks explicit participant edits atomically and does not infer them from notes', async () => {
    const f = await fixture(3);
    const a = await createBooking({ ...f.input, participantCount: 2 });
    await createBooking({ ...f.input, participantCount: 1 });
    await expect(updateBooking(f.tenant.id, a.id, { participantCount: 3 })).rejects.toThrow(
      'SLOT_FULL',
    );
    expect((await updateBooking(f.tenant.id, a.id, { notes: 'free text' })).participantCount).toBe(
      2,
    );
    expect((await updateBooking(f.tenant.id, a.id, { participantCount: 1 })).participantCount).toBe(
      1,
    );
  });
  it('recovers concurrent operator retries and the original result after cancellation', async () => {
    const f = await fixture(4);
    const input = { ...f.input, bookingRequestKey: randomUUID(), participantCount: 1 };
    const [a, b] = await Promise.all(peers.map((db) => createBooking(input, db)));
    expect(a!.id).toBe(b!.id);
    await updateBooking(f.tenant.id, a!.id, { status: 'CANCELLED' });
    expect((await createBooking(input)).status).toBe('CANCELLED');
    await expect(createBooking({ ...input, visitorName: 'Changed' })).rejects.toThrow(
      'BOOKING_REQUEST_CONFLICT',
    );
    expect(await prisma.appointment.count({ where: { tenantId: f.tenant.id } })).toBe(1);
  });
  it('does not permit capacity to fall below committed occupancy', async () => {
    const f = await fixture(4);
    await createBooking({ ...f.input, participantCount: 3 });
    await expect(
      prisma.service.update({ where: { id: f.service.id }, data: { capacity: 2 } }),
    ).rejects.toThrow();
    expect((await prisma.service.findUniqueOrThrow({ where: { id: f.service.id } })).capacity).toBe(
      4,
    );
  });
  it('serializes an old revision INSERT against a modern create', async () => {
    const f = await fixture(2);
    const oldId = randomUUID();
    const results = await Promise.allSettled([
      peers[0]!
        .$executeRaw`INSERT INTO "Appointment" (id,"tenantId","specialistId","serviceId","visitorName","visitorPhone","startsAt","endsAt",status,source,notes,"updatedAt")
        VALUES (${oldId},${f.tenant.id},${f.specialist.id},${f.service.id},'Synthetic','+000000001',${f.input.startsAt},${f.input.endsAt},'PENDING','OPERATOR','Group participants: 2',NOW())`,
      createBooking({ ...f.input, participantCount: 2 }, peers[1]),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rows = await prisma.appointment.findMany({ where: { tenantId: f.tenant.id } });
    expect(rows.reduce((sum, row) => sum + (row.participantCount ?? 999), 0)).toBe(2);
  });
  it('serializes capacity reduction against admission', async () => {
    const f = await fixture(3);
    const results = await Promise.allSettled([
      peers[0]!.service.update({ where: { id: f.service.id }, data: { capacity: 1 } }),
      createBooking({ ...f.input, participantCount: 2 }, peers[1]),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const service = await prisma.service.findUniqueOrThrow({ where: { id: f.service.id } });
    const rows = await prisma.appointment.findMany({ where: { tenantId: f.tenant.id } });
    expect(rows.reduce((sum, row) => sum + (row.participantCount ?? 999), 0)).toBeLessThanOrEqual(
      service.capacity,
    );
  });
  it.each(['working-hours', 'first-timezone'] as const)(
    'waits for concurrent %s configuration before admission',
    async (kind) => {
      const f = await fixture();
      await prisma.specialistWorkingHours.updateMany({
        where: { specialistId: f.specialist.id },
        data: { fromMinutes: 9 * 60, toMinutes: 10 * 60 },
      });
      let ready!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const pid = (await peers[1]!.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!
        .pid;
      const changing = peers[0]!.$transaction(
        async (tx) => {
          if (kind === 'working-hours')
            await tx.specialistWorkingHours.deleteMany({
              where: { specialistId: f.specialist.id },
            });
          else
            await tx.businessHours.create({
              data: { agentId: f.agent.id, timezone: 'America/New_York', schedule: [] },
            });
          ready();
          await gate;
        },
        { timeout: 10000 },
      );
      await entered;
      const admission = createBooking(
        {
          ...f.input,
          startsAt: new Date('2099-12-01T06:00:00Z'),
          endsAt: new Date('2099-12-01T07:00:00Z'),
        },
        peers[1],
      );
      // Attach rejection handler immediately; this operation is expected to be denied.
      const outcome = admission.then(
        () => 'admitted',
        (error: Error) => error.message,
      );
      try {
        let waiting = false;
        for (let attempt = 0; attempt < 50 && !waiting; attempt++) {
          const rows = await prisma.$queryRaw<
            { waiting: boolean }[]
          >`SELECT wait_event_type='Lock' AS waiting FROM pg_stat_activity WHERE pid=${pid}`;
          waiting = rows[0]?.waiting ?? false;
          if (!waiting) await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(waiting).toBe(true);
      } finally {
        release();
        await changing;
      }
      expect(await outcome).toBe('BOOKING_OUTSIDE_HOURS');
    },
  );
  it('uses business timezone inside creation and reschedule', async () => {
    const f = await fixture();
    await prisma.businessHours.create({
      data: { agentId: f.agent.id, timezone: 'America/New_York', schedule: [] },
    });
    await prisma.specialistWorkingHours.updateMany({
      where: { specialistId: f.specialist.id },
      data: { fromMinutes: 9 * 60, toMinutes: 10 * 60 },
    });
    // December: 14:00Z is 09:00 in New York, outside the Minsk range.
    const a = await createBooking({
      ...f.input,
      startsAt: new Date('2099-12-01T14:00:00Z'),
      endsAt: new Date('2099-12-01T15:00:00Z'),
    });
    await expect(createBooking(f.input)).rejects.toThrow('BOOKING_OUTSIDE_HOURS');
    expect(
      (await updateBooking(f.tenant.id, a.id, { startsAt: new Date('2099-12-02T14:00:00Z') }))
        .status,
    ).toBe('PENDING');
  });
  it('lets an operator read only their tenant booking catalog', async () => {
    const f = await httpFixture();
    try {
      const headers = { authorization: `Bearer ${f.token('OPERATOR')}` };
      const specialists = await f.app.inject({
        method: 'GET',
        url: '/api/v1/operator/booking-specialists',
        headers,
      });
      const services = await f.app.inject({
        method: 'GET',
        url: '/api/v1/operator/booking-services',
        headers,
      });
      expect(specialists.statusCode).toBe(200);
      expect(services.statusCode).toBe(200);
      expect(specialists.json()).toEqual([expect.objectContaining({ id: f.specialist.id })]);
      expect(services.json()).toEqual([expect.objectContaining({ id: f.service.id })]);
      for (const path of ['booking-specialists', 'booking-services']) {
        expect(
          (await f.app.inject({ method: 'GET', url: `/api/v1/operator/${path}` })).statusCode,
        ).toBe(401);
        expect(
          (
            await f.app.inject({
              method: 'GET',
              url: `/api/v1/operator/${path}`,
              headers: { authorization: `Bearer ${f.token('VIEWER')}` },
            })
          ).statusCode,
        ).toBe(403);
        expect(
          (
            await f.app.inject({
              method: 'GET',
              url: `/api/v1/operator/${path}`,
              headers: { authorization: `Bearer ${f.token('OPERATOR', randomUUID())}` },
            })
          ).json(),
        ).toEqual([]);
      }
    } finally {
      await f.app.close();
    }
  });
  it('requires an operator request key and recovers HTTP POST retries', async () => {
    const f = await httpFixture(4);
    try {
      const payload = {
        specialistId: f.specialist.id,
        serviceId: f.service.id,
        visitorName: 'Synthetic visitor',
        visitorPhone: '+000000001',
        startsAt: '2099-12-02T09:00:00Z',
        participantCount: 2,
      };
      const url = '/api/v1/operator/appointments';
      const headers = { authorization: `Bearer ${f.token()}`, 'idempotency-key': randomUUID() };
      expect(
        (
          await f.app.inject({
            method: 'POST',
            url,
            payload,
            headers: { authorization: headers.authorization },
          })
        ).statusCode,
      ).toBe(400);
      const a = await f.app.inject({ method: 'POST', url, payload, headers });
      const b = await f.app.inject({ method: 'POST', url, payload, headers });
      expect(a.statusCode).toBe(201);
      expect(b.statusCode).toBe(201);
      expect(a.json<{ id: string }>().id).toBe(b.json<{ id: string }>().id);
      expect(a.json<{ participantCount: number }>().participantCount).toBe(2);
      const lookup = `/api/v1/operator/appointment-requests/${headers['idempotency-key']}`;
      expect((await f.app.inject({ method: 'GET', url: lookup })).statusCode).toBe(401);
      expect(
        (
          await f.app.inject({
            method: 'GET',
            url: lookup,
            headers: { authorization: `Bearer ${f.token('VIEWER')}` },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await f.app.inject({
            method: 'GET',
            url: lookup,
            headers: { authorization: `Bearer ${f.token('OWNER', randomUUID())}` },
          })
        ).statusCode,
      ).toBe(404);
      expect((await f.app.inject({ method: 'GET', url: lookup, headers })).json()).toMatchObject({
        id: a.json<{ id: string }>().id,
      });
    } finally {
      await f.app.close();
    }
  });
});
