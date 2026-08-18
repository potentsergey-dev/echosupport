import { prisma } from './db/prisma.js';
import { startCleanupRunner } from './services/cleanup.js';
import { startJobRunner } from './services/job-runner.js';
import { startOperatorNotifier, stopOperatorNotifier } from './services/operator-notifier.js';

async function main() {
  const runners = [startJobRunner(), startCleanupRunner()];
  await startOperatorNotifier();

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info({ signal }, 'Worker shutdown started');
    for (const runner of runners) clearInterval(runner);
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
