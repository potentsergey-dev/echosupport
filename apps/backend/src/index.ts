import { buildServer } from './server.js';
import { env } from './config/env.js';
import { prisma } from './db/prisma.js';

async function main() {
  const server = await buildServer();
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.log.info({ signal }, 'Graceful shutdown started');
    try {
      await server.close();
      server.log.info('Graceful shutdown completed');
    } catch (err) {
      server.log.error(err, 'Graceful shutdown failed');
      process.exitCode = 1;
    }
  };

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
  try {
    await server.listen({ port: env.PORT, host: env.HOST });
  } catch (err) {
    server.log.error(err);
    await server.close().catch(() => prisma.$disconnect());
    process.exit(1);
  }
}

void main();
