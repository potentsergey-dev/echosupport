import { prisma } from './prisma.js';
import { hash } from 'bcryptjs';
import { randomBytes } from 'node:crypto';

const demoMarketingSeedEnabled = process.env['ECHOSUPPORT_DEMO_MARKETING_SEED'] === 'true';

function getMarketingAllowedOrigins() {
  const publicBaseUrl = process.env['PUBLIC_BASE_URL'];
  if (!publicBaseUrl) return [];

  try {
    return [new URL(publicBaseUrl).origin];
  } catch {
    console.warn('Ignoring invalid PUBLIC_BASE_URL while preparing demo marketing seed');
    return [];
  }
}

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

  const baseAgentData = {
    tenantId: tenant.id,
    name: 'Demo Agent',
    role: 'Customer Support Assistant',
    systemPrompt:
      'You are a helpful customer support assistant. Answer questions clearly and concisely.',
  };
  const marketingAgentData = {
    name: 'EchoSupport Demo Assistant',
    role: 'AI support concierge',
    systemPrompt:
      'You are the EchoSupport demo assistant. Show how EchoSupport helps teams answer customer questions, escalate to operators, collect CSAT, and prepare bookings. Be concise, practical, and transparent when a real provider key or knowledge source is missing.',
    greetingMessage:
      'Hi! I can show how EchoSupport handles AI support, operator handoff, CSAT, and booking workflows.',
    proactiveMessageDelay: 8,
    proactiveMessageText: 'Want to see how EchoSupport answers before a human joins?',
    allowedOrigins: getMarketingAllowedOrigins(),
  };
  const optInAgentData = demoMarketingSeedEnabled ? marketingAgentData : {};

  const agent = await prisma.agent.upsert({
    where: { id: 'demo-agent-0001' },
    update: optInAgentData,
    create: {
      id: 'demo-agent-0001',
      ...baseAgentData,
      ...optInAgentData,
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
