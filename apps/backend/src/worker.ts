import { prisma } from './db/prisma.js';
import { startCleanupRunner } from './services/cleanup.js';
import { createCommunityDependencies } from './services/dependencies.js';
import { createPrismaJobWorkerRunner } from './services/job-runner.js';
import { startOperatorNotifier, stopOperatorNotifier } from './services/operator-notifier.js';

async function main() {
  const deps = createCommunityDependencies();
  const jobRunner = await createPrismaJobWorkerRunner(deps.storage).start();
  const cleanupRunner = startCleanupRunner();
  await startOperatorNotifier();

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info({ signal }, 'Worker shutdown started');
    await jobRunner.stop();
    clearInterval(cleanupRunner);
    stopOperatorNotifier();
    await prisma.$disconnect();
    console.info('Worker shutdown completed');
  };

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
  console.info('EchoSupport worker started');
}

void main().catch(async (err) => {
  console.error('Worker failed to start', err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
