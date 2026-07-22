import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);

function read(path) {
  return readFileSync(new URL(path, root), 'utf8');
}

const manifests = [
  'package.json',
  'apps/backend/package.json',
  'apps/admin/package.json',
  'apps/widget/package.json',
  'packages/shared/package.json',
];
const versions = new Map(manifests.map((path) => [path, JSON.parse(read(path)).version]));
const expectedVersion = versions.get('package.json');
const failures = [];
const releaseTag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined;

if (releaseTag && releaseTag !== `v${expectedVersion}`) {
  failures.push(`release tag ${releaseTag} does not match workspace version v${expectedVersion}`);
}

for (const [path, version] of versions) {
  if (version !== expectedVersion) {
    failures.push(`${path} has version ${version}; expected ${expectedVersion}`);
  }
}

if (!read('CHANGELOG.md').includes(`## [${expectedVersion}]`)) {
  failures.push(`CHANGELOG.md has no section for version ${expectedVersion}`);
}

const schemaKeys = new Set(
  [
    ...read('apps/backend/src/config/env-validation.ts').matchAll(
      /^\s{4}([A-Z][A-Z0-9_]+):\s*z\./gm,
    ),
  ].map((match) => match[1]),
);
const exampleKeys = new Set(
  [...read('.env.example').matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]),
);
const documentedKeys = new Set(
  [...read('docs/configuration.md').matchAll(/^\|\s*`([A-Z][A-Z0-9_]*)`/gm)].map(
    (match) => match[1],
  ),
);
const composeKeys = new Set(
  [...read('docker-compose.yml').matchAll(/^\s{6}([A-Z][A-Z0-9_]+):/gm)].map((match) => match[1]),
);
const composeGeneratedKeys = new Set([
  'NODE_ENV',
  'PORT',
  'HOST',
  'DATABASE_URL',
  'DIRECT_URL',
  'APP_URL',
  'UPLOADS_DIR',
  'QDRANT_URL',
]);
const composeOnlyKeys = new Set([
  'POSTGRES_DB',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'ADMIN_EMAIL',
  'ADMIN_PASSWORD',
  'HTTP_PORT',
  'APP_EDITION',
]);

for (const key of schemaKeys) {
  if (!composeGeneratedKeys.has(key) && !exampleKeys.has(key)) {
    failures.push(`${key} is validated at runtime but missing from .env.example`);
  }
  if (!documentedKeys.has(key)) {
    failures.push(`${key} is validated at runtime but missing from docs/configuration.md`);
  }
  if (!composeKeys.has(key)) {
    failures.push(`${key} is validated at runtime but missing from docker-compose.yml`);
  }
}

for (const key of exampleKeys) {
  if (!schemaKeys.has(key) && !composeOnlyKeys.has(key)) {
    failures.push(`${key} exists in .env.example but is not consumed`);
  }
}

if (failures.length > 0) {
  console.error('Release consistency check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Release consistency check passed for ${expectedVersion} (${schemaKeys.size} runtime variables).`,
);
