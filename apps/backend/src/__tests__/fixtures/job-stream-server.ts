import Fastify from 'fastify';
import { prisma } from '../../db/prisma.js';
import authPlugin from '../../plugins/auth.js';
import jobRoutes from '../../routes/admin/jobs.js';
import { PrismaSessionAuthWorkspaceAdapter } from '../../services/session-auth.js';

if (
  !process.env['TEST_DATABASE_URL'] ||
  process.env['DATABASE_URL'] !== process.env['TEST_DATABASE_URL']
) {
  throw new Error('Job stream fixture requires the isolated integration database');
}
const app = Fastify();
app.decorate('deps', {
  authWorkspace: new PrismaSessionAuthWorkspaceAdapter(prisma, {
    cookieName: 'test_session',
    idleTtlMs: 30_000,
  }),
} as never);
await app.register(authPlugin);
await app.register(jobRoutes);
app.post<{
  Body: {
    sessionId: string;
    action: string;
    alternateMembershipId: string;
    alternateTenantId: string;
  };
}>(
  '/fixture/revoke',
  { preHandler: app.requireRole(['OWNER', 'ADMIN'], { touchSession: false }) },
  async (req, reply) => {
    const session = await prisma.authSession.findFirst({
      where: { id: req.body.sessionId, userId: req.user.sub, tenantId: req.user.tenantId },
    });
    if (!session?.selectedMembershipId) return reply.code(404).send();
    switch (req.body.action) {
      case 'logout':
        await prisma.authSession.update({
          where: { id: session.id },
          data: { revokedAt: new Date() },
        });
        break;
      case 'removed':
      case 'suspended':
        await prisma.membership.update({
          where: { id: session.selectedMembershipId },
          data: { status: req.body.action === 'removed' ? 'REMOVED' : 'SUSPENDED' },
        });
        break;
      case 'role':
        await prisma.membership.update({
          where: { id: session.selectedMembershipId },
          data: { role: 'OPERATOR' },
        });
        break;
      case 'disabled':
        await prisma.user.update({ where: { id: req.user.sub }, data: { status: 'DISABLED' } });
        break;
      case 'expiry':
        await prisma.authSession.update({
          where: { id: session.id },
          data: { expiresAt: new Date(Date.now() - 1) },
        });
        break;
      case 'idle':
        await prisma.authSession.update({
          where: { id: session.id },
          data: { lastSeenAt: new Date(Date.now() - 60_000) },
        });
        break;
      case 'switch':
        await prisma.authSession.update({
          where: { id: session.id },
          data: {
            tenantId: req.body.alternateTenantId,
            selectedMembershipId: req.body.alternateMembershipId,
          },
        });
        break;
      default:
        return reply.code(400).send();
    }
    return reply.code(204).send();
  },
);
const address = await app.listen({ host: '127.0.0.1', port: 0 });
process.send?.({ address });
