import { prisma } from './prisma.js';
import { hash } from 'bcryptjs';
import { randomBytes } from 'node:crypto';

async function main() {
  console.log('🌱 Seeding database...');
  const adminEmail = process.env['ADMIN_EMAIL'];
  const adminPassword = process.env['ADMIN_PASSWORD'];
  if (!adminEmail || !adminPassword || adminPassword.length < 12) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD (minimum 12 characters) are required');
  }

  const tenant = await prisma.tenant.upsert({
    where: { id: 'demo-tenant-0001' },
    update: {},
    create: { id: 'demo-tenant-0001', name: 'Demo Tenant' },
  });

  console.log(`✅ Tenant: ${tenant.id}`);

  const passwordHash = await hash(adminPassword, 12);

  const user = await prisma.user.upsert({
    where: { email: adminEmail },
    // ADMIN_PASSWORD is the source of truth for the initial owner. Updating the
    // environment and restarting the container intentionally rotates the password.
    update: { passwordHash },
    create: {
      tenantId: tenant.id,
      email: adminEmail,
      passwordHash,
      role: 'OWNER',
    },
  });

  console.log(`✅ User: ${user.email}`);

  const agent = await prisma.agent.upsert({
    where: { id: 'demo-agent-0001' },
    update: {},
    create: {
      id: 'demo-agent-0001',
      tenantId: tenant.id,
      name: 'Demo Agent',
      role: 'Customer Support Assistant',
      systemPrompt:
        'You are a helpful customer support assistant. Answer questions clearly and concisely.',
      publicKey: `pk_${randomBytes(16).toString('hex')}`,
    },
  });

  console.log(`✅ Agent: ${agent.name} (${agent.id})`);
  console.log('🎉 Seed complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
