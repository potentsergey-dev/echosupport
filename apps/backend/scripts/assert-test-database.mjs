const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

if (!testDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL is required for integration tests');
}

if (process.env['NODE_ENV'] === 'production') {
  throw new Error('Integration tests must not run with NODE_ENV=production');
}

let parsedDatabaseUrl;
try {
  parsedDatabaseUrl = new URL(testDatabaseUrl);
} catch {
  throw new Error('TEST_DATABASE_URL must be a valid URL');
}

if (!['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol)) {
  throw new Error('TEST_DATABASE_URL must use the PostgreSQL protocol');
}

const databaseName = decodeURIComponent(parsedDatabaseUrl.pathname.slice(1));
if (!/(^|[_-])test($|[_-])/i.test(databaseName)) {
  throw new Error('TEST_DATABASE_URL must identify a database whose name contains a test marker');
}

const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
if (
  !localHosts.has(parsedDatabaseUrl.hostname) &&
  process.env['ALLOW_REMOTE_TEST_DATABASE'] !== 'true'
) {
  throw new Error(
    'Remote TEST_DATABASE_URL requires the explicit ALLOW_REMOTE_TEST_DATABASE=true opt-in',
  );
}

// Never inherit DATABASE_URL or DIRECT_URL: Prisma must use the explicitly reviewed test target.
process.env['DATABASE_URL'] = testDatabaseUrl;
process.env['DIRECT_URL'] = testDatabaseUrl;
