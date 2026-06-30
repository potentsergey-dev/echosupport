import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../config/env.js';

function knowledgeDir(agentId: string): string {
  return path.join(env.UPLOADS_DIR, 'knowledge', agentId);
}

export async function saveFile(agentId: string, filename: string, buffer: Buffer): Promise<string> {
  const dir = knowledgeDir(agentId);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

export async function readFile(storagePath: string): Promise<Buffer> {
  return fs.readFile(storagePath);
}

export async function deleteFile(storagePath: string): Promise<void> {
  try {
    await fs.unlink(storagePath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}
