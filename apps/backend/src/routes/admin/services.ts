/**
 * Admin routes for Services (Phase 10.6 Booking).
 *
 * Accessible by OWNER and ADMIN only.
 *
 *   GET    /admin/services           — list all services for tenant
 *   POST   /admin/services           — create service
 *   GET    /admin/services/:id       — get service detail
 *   PATCH  /admin/services/:id       — update service
 *   DELETE /admin/services/:id       — soft-delete service
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';

const ADMIN_ROLES = ['OWNER', 'ADMIN'];

const CreateServiceSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  durationMin: z.number().int().min(5).max(480),
  priceLabel: z.string().max(100).nullable().optional(),
  specialistId: z.string().nullable().optional(), // null = available for any specialist
  isActive: z.boolean().optional(),
});

const servicesRoutes: FastifyPluginAsync = async (fastify) => {
  const adminAuth = fastify.requireRole(ADMIN_ROLES);

  // ── GET /admin/services ───────────────────────────────────────────────────
  fastify.get('/services', { preHandler: [adminAuth] }, async (req) => {
    const query = req.query as Record<string, string | undefined>;
    const specialistId = query['specialistId'];

    const where: Record<string, unknown> = { tenantId: req.user.tenantId };
    if (specialistId) where['specialistId'] = specialistId;

    const services = await prisma.service.findMany({
      where: where as NonNullable<
        NonNullable<Parameters<typeof prisma.service.findMany>[0]>['where']
      >,
      include: {
        specialist: { select: { id: true, name: true, role: true } },
        _count: { select: { appointments: true } },
      },
      orderBy: { name: 'asc' },
    });

    return services;
  });

  // ── POST /admin/services ──────────────────────────────────────────────────
  fastify.post('/services', { preHandler: [adminAuth] }, async (req, reply) => {
    const body = CreateServiceSchema.parse(req.body);

    // Validate specialistId belongs to tenant
    if (body.specialistId) {
      const specialist = await prisma.specialist.findFirst({
        where: { id: body.specialistId, tenantId: req.user.tenantId },
        select: { id: true },
      });
      if (!specialist)
        return reply.code(400).send({ error: 'Specialist not found or not in your tenant' });
    }

    const service = await prisma.service.create({
      data: {
        tenantId: req.user.tenantId,
        name: body.name,
        description: body.description ?? null,
        durationMin: body.durationMin,
        priceLabel: body.priceLabel ?? null,
        specialistId: body.specialistId ?? null,
        isActive: body.isActive ?? true,
      },
      include: {
        specialist: { select: { id: true, name: true } },
      },
    });

    return reply.code(201).send(service);
  });

  // ── GET /admin/services/:id ───────────────────────────────────────────────
  fastify.get('/services/:id', { preHandler: [adminAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const service = await prisma.service.findFirst({
      where: { id, tenantId: req.user.tenantId },
      include: { specialist: { select: { id: true, name: true, role: true } } },
    });

    if (!service) return reply.code(404).send({ error: 'Service not found' });
    return service;
  });

  // ── PATCH /admin/services/:id ─────────────────────────────────────────────
  fastify.patch('/services/:id', { preHandler: [adminAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = CreateServiceSchema.partial().parse(req.body);

    const existing = await prisma.service.findFirst({
      where: { id, tenantId: req.user.tenantId },
      select: { id: true },
    });
    if (!existing) return reply.code(404).send({ error: 'Service not found' });

    if (body.specialistId) {
      const specialist = await prisma.specialist.findFirst({
        where: { id: body.specialistId, tenantId: req.user.tenantId },
        select: { id: true },
      });
      if (!specialist)
        return reply.code(400).send({ error: 'Specialist not found or not in your tenant' });
    }

    const service = await prisma.service.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.durationMin !== undefined && { durationMin: body.durationMin }),
        ...(body.priceLabel !== undefined && { priceLabel: body.priceLabel }),
        ...(body.specialistId !== undefined && { specialistId: body.specialistId }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
      },
      include: { specialist: { select: { id: true, name: true } } },
    });

    return service;
  });

  // ── DELETE /admin/services/:id ────────────────────────────────────────────
  fastify.delete('/services/:id', { preHandler: [adminAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const existing = await prisma.service.findFirst({
      where: { id, tenantId: req.user.tenantId },
      select: { id: true },
    });
    if (!existing) return reply.code(404).send({ error: 'Service not found' });

    // Soft-delete
    await prisma.service.update({ where: { id }, data: { isActive: false } });
    return reply.code(204).send();
  });
};

export default servicesRoutes;
