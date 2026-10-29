import { readFile } from 'node:fs/promises';
import { PrismaPg } from '@prisma/adapter-pg';
import { expect, it } from 'vitest';

it('upgrades old rows, quarantines ambiguous counts and preserves old revision writes', async () => {
  const db = await new PrismaPg({
    connectionString: process.env['TEST_DATABASE_URL']!,
    max: 1,
  }).connect();
  try {
    const fixture = await readFile(
      new URL('./fixtures/booking-participants-upgrade.sql', import.meta.url),
      'utf8',
    );
    const migration = await readFile(
      new URL(
        '../../prisma/migrations/20261029160000_booking_participant_count/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
    await expect(
      db.underlyingDriver().query(fixture.replace('-- MIGRATION_HERE', () => migration)),
    ).resolves.toBeDefined();
  } finally {
    await db.dispose();
  }
});
