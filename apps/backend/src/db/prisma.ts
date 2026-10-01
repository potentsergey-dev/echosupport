import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../config/env.js';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  const connectionString = new URL(env.DATABASE_URL);
  const ssl = env.DB_SSL_CA_PEM
    ? { ca: env.DB_SSL_CA_PEM, servername: env.DB_SSL_SERVERNAME, rejectUnauthorized: true }
    : undefined;
  if (ssl) connectionString.searchParams.delete('sslmode');
  const adapter = new PrismaPg({
    connectionString: connectionString.toString(),
    max: env.DB_POOL_MAX,
    ...(ssl ? { ssl } : {}),
  });
  return new PrismaClient({
    adapter,
    log: env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
