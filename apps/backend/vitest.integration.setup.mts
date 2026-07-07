import './scripts/assert-test-database.mjs';

process.env['JWT_SECRET'] ??= 'integration-jwt-secret-at-least-32-characters';
process.env['MASTER_ENCRYPTION_KEY'] ??= 'a'.repeat(64);
process.env['ADMIN_CORS_ORIGINS'] ??= 'https://admin.example';
