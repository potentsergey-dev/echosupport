import { prisma } from './db/prisma.js';
import { createCommunityDependencies } from './services/dependencies.js';
import { sanitizeErrorMessage } from './services/error-sanitizer.js';
import { runJobOnce } from './services/job-runner.js';

async function main() {
  const jobId = process.env['JOB_ID']?.trim();
  if (!jobId) throw new Error('JOB_ID is required');

  const deps = createCommunityDependencies();
  try {
    await runJobOnce(jobId, deps.storage);
    console.info('One-shot job completed');
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error('One-shot job failed', sanitizeErrorMessage(error));
  process.exitCode = 1;
});
