/**
 * Admin routes for Specialists (Phase 10.6 Booking).
 *
 * Accessible by OWNER and ADMIN only.
 *
 *   GET    /admin/specialists                      — list all specialists for tenant
 *   POST   /admin/specialists                      — create specialist
 *   GET    /admin/specialists/:id                  — get specialist detail
 *   PATCH  /admin/specialists/:id                  — update specialist
 *   DELETE /admin/specialists/:id                  — delete specialist
 *   GET    /admin/specialists/:id/working-hours    — get working hours
 *   PUT    /admin/specialists/:id/working-hours    — replace working hours (full set)
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';

const ADMIN_ROLES = ['OWNER', 'ADMIN'];

const CreateSpecialistSchema = z.object({
  name: z.string().min(1).max(100),
  role: z.string().max(100).optional(),
  description: z.string().max(1000).optional(),
  avatarUrl: z.string().url().optional(),
  agentId: z.string().optional(), // null = available for all agents of tenant
  isActive: z.boolean().optional(),
});

const WorkingHoursEntrySchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  fromMinutes: z.number().int().min(0).max(1439),
  toMinutes: z.number().int().min(1).max(1440),
});

const specialistsRoutes: FastifyPluginAsync = async (fastify) => {
  const adminAuth = fastify.requireRole(ADMIN_ROLES);

  // ── GET /admin/specialists ────────────────────────────────────────────────
  fastify.get('/specialists', { preHandler: [adminAuth] }, async (req) => {
    const query = req.query as Record<string, string | undefined>;
    const agentId = query['agentId'];

    const where: Record<string, unknown> = { tenantId: req.user.tenantId };
    if (agentId) where['agentId'] = agentId;

    const specialists = await prisma.specialist.findMany({
      where: where as NonNullable<NonNullable<Parameters<typeof prisma.specialist.findMany>[0]>['where']>,
      include: {
        workingHours: { orderBy: [{ dayOfWeek: 'asc' }, { fromMinutes: 'asc' }] },
        _count: { select: { services: true, appointments: true } },
      },
      orderBy: { name: 'asc' },
    });

    return specialists;
  });

  // ── POST /admin/specialists ───────────────────────────────────────────────
  fastify.post('/specialists', { preHandler: [adminAuth] }, async (req, reply) => {
    const body = CreateSpecialistSchema.parse(req.body);

    // Validate agentId belongs to tenant
    if (body.agentId) {
      const agent = await prisma.agent.findFirst({
        where: { id: body.agentId, tenantId: req.user.tenantId },
        select: { id: true },
      });
      if (!agent) return reply.code(400).send({ error: 'Agent not found or not in your tenant' });
    }

    const specialist = await prisma.specialist.create({
      data: {
        tenantId: req.user.tenantId,
        name: body.name,
        role: body.role ?? null,
        description: body.description ?? null,
        avatarUrl: body.avatarUrl ?? null,
        agentId: body.agentId ?? null,
        isActive: body.isActive ?? true,
      },
    });

    return reply.code(201).send(specialist);
  });

  // ── GET /admin/specialists/:id ────────────────────────────────────────────
  fastify.get('/specialists/:id', { preHandler: [adminAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const specialist = await prisma.specialist.findFirst({
      where: { id, tenantId: req.user.tenantId },
      include: {
        workingHours: { orderBy: [{ dayOfWeek: 'asc' }, { fromMinutes: 'asc' }] },
        services: { where: { isActive: true }, orderBy: { name: 'asc' } },
      },
    });

    if (!specialist) return reply.code(404).send({ error: 'Specialist not found' });
    return specialist;
  });

  // ── PATCH /admin/specialists/:id ──────────────────────────────────────────
  fastify.patch('/specialists/:id', { preHandler: [adminAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = CreateSpecialistSchema.partial().parse(req.body);

    const existing = await prisma.specialist.findFirst({
      where: { id, tenantId: req.user.tenantId },
      select: { id: true },
    });
    if (!existing) return reply.code(404).send({ error: 'Specialist not found' });

    if (body.agentId) {
      const agent = await prisma.agent.findFirst({
        where: { id: body.agentId, tenantId: req.user.tenantId },
        select: { id: true },
      });
      if (!agent) return reply.code(400).send({ error: 'Agent not found or not in your tenant' });
    }

    const specialist = await prisma.specialist.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.role !== undefined && { role: body.role }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.avatarUrl !== undefined && { avatarUrl: body.avatarUrl }),
        ...(body.agentId !== undefined && { agentId: body.agentId }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
      },
    });

    return specialist;
  });

  // ── DELETE /admin/specialists/:id ─────────────────────────────────────────
  fastify.delete('/specialists/:id', { preHandler: [adminAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const existing = await prisma.specialist.findFirst({
      where: { id, tenantId: req.user.tenantId },
      select: { id: true },
    });
    if (!existing) return reply.code(404).send({ error: 'Specialist not found' });

    // Soft-delete: mark as inactive (preserve appointment history)
    await prisma.specialist.update({ where: { id }, data: { isActive: false } });
    return reply.code(204).send();
  });

  // ── GET /admin/specialists/:id/working-hours ──────────────────────────────
  fastify.get('/specialists/:id/working-hours', { preHandler: [adminAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const specialist = await prisma.specialist.findFirst({
      where: { id, tenantId: req.user.tenantId },
      select: { id: true },
    });
    if (!specialist) return reply.code(404).send({ error: 'Specialist not found' });

    const hours = await prisma.specialistWorkingHours.findMany({
      where: { specialistId: id },
      orderBy: [{ dayOfWeek: 'asc' }, { fromMinutes: 'asc' }],
    });
    return hours;
  });

  // ── PUT /admin/specialists/:id/working-hours ──────────────────────────────
  // Replaces the entire working hours schedule for the specialist.
  fastify.put('/specialists/:id/working-hours', { preHandler: [adminAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const entries = z.array(WorkingHoursEntrySchema).parse(req.body);

    const specialist = await prisma.specialist.findFirst({
      where: { id, tenantId: req.user.tenantId },
      select: { id: true },
    });
    if (!specialist) return reply.code(404).send({ error: 'Specialist not found' });

    // Validate: fromMinutes < toMinutes
    for (const e of entries) {
      if (e.fromMinutes >= e.toMinutes) {
        return reply
          .code(400)
          .send({ error: `Invalid range for dayOfWeek=${e.dayOfWeek}: from must be before to` });
      }
    }

    await prisma.$transaction([
      prisma.specialistWorkingHours.deleteMany({ where: { specialistId: id } }),
      prisma.specialistWorkingHours.createMany({
        data: entries.map((e) => ({ specialistId: id, ...e })),
        skipDuplicates: true,
      }),
    ]);

    const hours = await prisma.specialistWorkingHours.findMany({
      where: { specialistId: id },
      orderBy: [{ dayOfWeek: 'asc' }, { fromMinutes: 'asc' }],
    });
    return hours;
  });
};

export default specialistsRoutes;
