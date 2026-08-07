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
    create: { id: 'demo-tenant-0001', name: 'Default workspace' },
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

  const initialOperatorEmail = process.env['INITIAL_OPERATOR_EMAIL']?.trim();
  const initialOperatorPassword = process.env['INITIAL_OPERATOR_PASSWORD'];
  if (
    (initialOperatorEmail && !initialOperatorPassword) ||
    (!initialOperatorEmail && initialOperatorPassword)
  ) {
    throw new Error('INITIAL_OPERATOR_EMAIL and INITIAL_OPERATOR_PASSWORD must be set together');
  }
  if (initialOperatorEmail && initialOperatorPassword) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(initialOperatorEmail)) {
      throw new Error('INITIAL_OPERATOR_EMAIL must be a valid email address');
    }
    if (initialOperatorPassword.length < 12) {
      throw new Error('INITIAL_OPERATOR_PASSWORD must contain at least 12 characters');
    }
    if (initialOperatorPassword === 'replace-with-a-long-unique-operator-password') {
      throw new Error('INITIAL_OPERATOR_PASSWORD must be replaced with a unique value');
    }
    const existingOperator = await prisma.user.findUnique({
      where: { email: initialOperatorEmail },
    });
    if (
      existingOperator &&
      (existingOperator.tenantId !== tenant.id || existingOperator.role !== 'OPERATOR')
    ) {
      throw new Error('INITIAL_OPERATOR_EMAIL is already assigned to a different tenant or role');
    }
    const operatorPasswordHash = await hash(initialOperatorPassword, 12);
    const operator = existingOperator
      ? await prisma.user.update({
          where: { id: existingOperator.id },
          data: { passwordHash: operatorPasswordHash },
        })
      : await prisma.user.create({
          data: {
            tenantId: tenant.id,
            email: initialOperatorEmail,
            passwordHash: operatorPasswordHash,
            role: 'OPERATOR',
          },
        });
    console.log(`✅ Initial operator: ${operator.email}`);
  }

  const baseAgentData = {
    tenantId: tenant.id,
    name: 'Starter Agent',
    role: 'Customer Support Assistant',
    systemPrompt:
      'You are a helpful customer support assistant. Answer questions clearly and concisely.',
  };

  const agent = await prisma.agent.upsert({
    where: { id: 'demo-agent-0001' },
    update: {},
    create: {
      id: 'demo-agent-0001',
      ...baseAgentData,
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
