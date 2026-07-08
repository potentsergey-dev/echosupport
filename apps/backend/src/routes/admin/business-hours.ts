/**
 * Admin routes: Business Hours
 *   GET  /admin/agents/:id/business-hours
 *   PUT  /admin/agents/:id/business-hours
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { timeStringSchema } from '../../services/booking.js';

const ScheduleEntrySchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  from: timeStringSchema,
  to: timeStringSchema,
});

const BusinessHoursSchema = z.object({
  timezone: z.string().default('Europe/Minsk'),
  schedule: z.array(ScheduleEntrySchema).min(0),
  holidays: z.array(z.string()).optional(),
  outOfHoursMessage: z.string().max(1000).optional().nullable(),
  enabled: z.boolean().default(false),
});

const businessHoursRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /admin/agents/:id/business-hours
  fastify.get(
    '/agents/:id/business-hours',
    { preHandler: [fastify.requireRole(['OWNER', 'ADMIN'])] },
    async (req, reply) => {
      const { id } = req.params as { id: string };

      // Verify agent belongs to tenant
      const agent = await prisma.agent.findFirst({
        where: { id, tenantId: req.user.tenantId },
        select: { id: true },
      });
      if (!agent) return reply.status(404).send({ error: 'Agent not found' });

      const bh = await prisma.businessHours.findUnique({ where: { agentId: id } });
      if (!bh) {
        return reply.send({
          agentId: id,
          timezone: 'Europe/Minsk',
          schedule: [],
          holidays: [],
          outOfHoursMessage: null,
          enabled: false,
        });
      }
      return reply.send(bh);
    },
  );

  // PUT /admin/agents/:id/business-hours (upsert)
  fastify.put(
    '/agents/:id/business-hours',
    { preHandler: [fastify.requireRole(['OWNER', 'ADMIN'])] },
    async (req, reply) => {
      const { id } = req.params as { id: string };

      const agent = await prisma.agent.findFirst({
        where: { id, tenantId: req.user.tenantId },
        select: { id: true },
      });
      if (!agent) return reply.status(404).send({ error: 'Agent not found' });

      const result = BusinessHoursSchema.safeParse(req.body);
      if (!result.success) {
        return reply.status(400).send({ error: result.error.flatten().fieldErrors });
      }

      const { timezone, schedule, holidays, outOfHoursMessage, enabled } = result.data;
      for (const entry of schedule) {
        if (entry.from >= entry.to) {
          return reply.status(400).send({
            error: `Invalid range for dayOfWeek=${entry.dayOfWeek}: from must be before to`,
          });
        }
      }

      const bh = await prisma.businessHours.upsert({
        where: { agentId: id },
        create: {
          agentId: id,
          timezone,
          schedule,
          holidays: holidays ?? [],
          outOfHoursMessage: outOfHoursMessage ?? null,
          enabled,
        },
        update: {
          timezone,
          schedule,
          holidays: holidays ?? [],
          outOfHoursMessage: outOfHoursMessage ?? null,
          enabled,
        },
      });

      return reply.send(bh);
    },
  );
};

export default businessHoursRoutes;
