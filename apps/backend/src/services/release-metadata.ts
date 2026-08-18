import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ReleaseMetadata {
  version: string;
  packageName: string;
}

let cachedMetadata: ReleaseMetadata | null = null;

export function getReleaseMetadata(): ReleaseMetadata {
  if (cachedMetadata) return cachedMetadata;

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const packagePath = path.resolve(currentDir, '..', '..', 'package.json');
  const raw = JSON.parse(fs.readFileSync(packagePath, 'utf-8')) as {
    name?: unknown;
    version?: unknown;
  };

  if (typeof raw.version !== 'string' || !raw.version.trim()) {
    throw new Error('Backend package.json version is required for release metadata');
  }

  cachedMetadata = {
    version: raw.version,
    packageName: typeof raw.name === 'string' ? raw.name : '@echosupport/backend',
  };
  return cachedMetadata;
}
